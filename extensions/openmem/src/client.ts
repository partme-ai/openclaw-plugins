/**
 * @fileoverview OpenMem Sidecar 的可靠 HTTP 客户端。
 *
 * 统一处理 API Key Header、请求超时、调用方取消、响应体上限和可重试状态码；只有显式标记
 * retrySafe 的操作才执行指数退避，避免非幂等写入被自动重复。`close` 会中止所有在途请求，
 * 保证 OpenClaw 插件停止后不再有后台网络活动。
 */
import type { OpenMemConfig } from "./config.js";
import { redactOpenMemError } from "./redact.js";

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * OpenMem HTTP 边界的结构化错误。
 *
 * `retryable` 只表示当前操作在协议层可能重试，客户端仍会结合调用方传入的 `retrySafe`
 * 决定是否真正重放请求，避免把非幂等写入意外执行两次。
 */
export class OpenMemHttpError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
    this.name = "OpenMemHttpError";
  }
}

/** 封装 OpenMem REST 调用、有限重试和生命周期取消的客户端。 */
export class OpenMemClient {
  private readonly controllers = new Set<AbortController>();
  /** 同时取消 fetch 与重试退避；只中止 fetch 不足以保证 stop 后没有后台任务。 */
  private readonly lifecycleController = new AbortController();
  private closed = false;

  constructor(readonly config: OpenMemConfig) {}

  async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, { method: "GET", retrySafe: true, signal });
  }

  async post<T>(path: string, body: unknown, options: { retrySafe?: boolean; signal?: AbortSignal } = {}): Promise<T> {
    return this.request<T>(path, { method: "POST", body, ...options });
  }

  close(): void {
    this.closed = true;
    this.lifecycleController.abort(new Error("OpenMem client closed"));
    for (const controller of this.controllers) controller.abort(new Error("OpenMem client closed"));
    this.controllers.clear();
  }

  private async request<T>(
    pathName: string,
    options: { method: "GET" | "POST"; body?: unknown; retrySafe?: boolean; signal?: AbortSignal },
  ): Promise<T> {
    if (this.closed) throw new OpenMemHttpError("OpenMem client is closed");
    const signal = options.signal
      ? AbortSignal.any([options.signal, this.lifecycleController.signal])
      : this.lifecycleController.signal;
    const effectiveOptions = { ...options, signal };
    const attempts = options.retrySafe ? this.config.maxAttempts : 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        if (this.closed) throw new OpenMemHttpError("OpenMem client is closed");
        return await this.requestOnce<T>(pathName, effectiveOptions);
      } catch (error) {
        lastError = error;
        const retryable = error instanceof OpenMemHttpError && error.retryable;
        if (!retryable || attempt >= attempts || signal.aborted) throw error;
        await this.delay(this.config.retryBaseDelayMs * 2 ** (attempt - 1), signal);
      }
    }
    throw lastError;
  }

  private async requestOnce<T>(
    pathName: string,
    options: { method: "GET" | "POST"; body?: unknown; signal?: AbortSignal },
  ): Promise<T> {
    const controller = new AbortController();
    this.controllers.add(controller);
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(new Error(`OpenMem request timed out after ${this.config.timeoutMs}ms`)), this.config.timeoutMs);
    timer.unref();
    try {
      const url = this.resolveUrl(pathName);
      const headers: Record<string, string> = { Accept: "application/json" };
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (this.config.apiKeyEnv) {
        const secret = process.env[this.config.apiKeyEnv] as string;
        headers[this.config.authHeader] = this.config.authScheme ? `${this.config.authScheme} ${secret}` : secret;
      }
      const response = await fetch(url, {
        method: options.method,
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
      });
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > this.config.maxResponseBytes) {
        throw new OpenMemHttpError(`OpenMem response exceeds ${this.config.maxResponseBytes} bytes`, response.status);
      }
      const buffer = await this.readResponse(response);
      const text = buffer.toString("utf8");
      if (!response.ok) {
        throw new OpenMemHttpError(
          `OpenMem ${response.status}: ${this.safeDetail(text || response.statusText)}`,
          response.status,
          RETRYABLE_STATUS.has(response.status),
        );
      }
      if (!text) return undefined as T;
      try { return JSON.parse(text) as T; }
      catch { throw new OpenMemHttpError(`OpenMem returned invalid JSON (HTTP ${response.status})`, response.status); }
    } catch (error) {
      if (error instanceof OpenMemHttpError) throw error;
      const timedOut = controller.signal.aborted && !options.signal?.aborted;
      throw new OpenMemHttpError(
        timedOut
          ? `OpenMem request timed out after ${this.config.timeoutMs}ms`
          : `OpenMem request failed: ${this.safeDetail(String(error))}`,
        undefined,
        timedOut || !options.signal?.aborted,
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortFromCaller);
      this.controllers.delete(controller);
    }
  }

  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(signal?.reason);
      };
      const timer = setTimeout(finish, ms);
      timer.unref();
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  }

  /**
   * 把插件内部的相对 API 路径限制在配置的 Sidecar origin 与路径前缀下。
   * 这道检查可以防止未来新增调用点误把绝对 URL 传入客户端，绕过鉴权目标边界。
   */
  private resolveUrl(pathName: string): URL {
    const relative = pathName.trim().replace(/^\/+/, "");
    if (!relative || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(relative) || relative.includes("\\")) {
      throw new OpenMemHttpError("OpenMem request path must be a relative API path");
    }
    const base = new URL(`${this.config.baseUrl}/`);
    const url = new URL(relative, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.username || url.password || url.hash) {
      throw new OpenMemHttpError("OpenMem request path escapes the configured endpoint");
    }
    return url;
  }

  /**
   * 流式读取响应并在越过上限的第一时间取消 reader。
   * 不能只依赖 Content-Length：分块响应通常没有该 Header，先 `arrayBuffer()` 再检查会让
   * 恶意或异常 Sidecar 在校验发生前占满 Gateway 内存。
   */
  private async readResponse(response: Response): Promise<Buffer> {
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > this.config.maxResponseBytes) {
          await reader.cancel("OpenMem response too large");
          throw new OpenMemHttpError(`OpenMem response exceeds ${this.config.maxResponseBytes} bytes`, response.status);
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, total);
    } finally {
      reader.releaseLock();
    }
  }

  /** 清理控制字符并遮蔽当前 API Key，避免远端错误正文污染日志或泄露凭据。 */
  private safeDetail(value: string): string {
    const secret = this.config.apiKeyEnv ? process.env[this.config.apiKeyEnv] : undefined;
    return redactOpenMemError(value, secret);
  }
}
