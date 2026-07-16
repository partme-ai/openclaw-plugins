/**
 * @fileoverview OpenMem Sidecar 的可靠 HTTP 客户端。
 *
 * 统一处理 API Key Header、请求超时、调用方取消、响应体上限和可重试状态码；只有显式标记
 * retrySafe 的操作才执行指数退避，避免非幂等写入被自动重复。`close` 会中止所有在途请求，
 * 保证 OpenClaw 插件停止后不再有后台网络活动。
 */
import type { OpenMemConfig } from "./config.js";

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class OpenMemHttpError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
    this.name = "OpenMemHttpError";
  }
}

/** 封装 OpenMem REST 调用、有限重试和生命周期取消的客户端。 */
export class OpenMemClient {
  private readonly controllers = new Set<AbortController>();
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
    for (const controller of this.controllers) controller.abort(new Error("OpenMem client closed"));
    this.controllers.clear();
  }

  private async request<T>(
    pathName: string,
    options: { method: "GET" | "POST"; body?: unknown; retrySafe?: boolean; signal?: AbortSignal },
  ): Promise<T> {
    if (this.closed) throw new OpenMemHttpError("OpenMem client is closed");
    const attempts = options.retrySafe ? this.config.maxAttempts : 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.requestOnce<T>(pathName, options);
      } catch (error) {
        lastError = error;
        const retryable = error instanceof OpenMemHttpError && error.retryable;
        if (!retryable || attempt >= attempts || options.signal?.aborted) throw error;
        await this.delay(this.config.retryBaseDelayMs * 2 ** (attempt - 1), options.signal);
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
      const url = new URL(pathName.replace(/^\/+/, ""), `${this.config.baseUrl}/`);
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
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > this.config.maxResponseBytes) {
        throw new OpenMemHttpError(`OpenMem response exceeds ${this.config.maxResponseBytes} bytes`, response.status);
      }
      const text = buffer.toString("utf8");
      if (!response.ok) {
        throw new OpenMemHttpError(
          `OpenMem ${response.status}: ${(text || response.statusText).slice(0, 500)}`,
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
        timedOut ? `OpenMem request timed out after ${this.config.timeoutMs}ms` : `OpenMem request failed: ${String(error)}`,
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
      const timer = setTimeout(resolve, ms);
      timer.unref();
      signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
  }
}
