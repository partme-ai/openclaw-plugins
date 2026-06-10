/**
 * @module http/undici-fetch
 *
 * 出站 HTTP（undici + ProxyAgent + 超时 + 限流读 body）。
 *
 * **职责**：企微等通道插件 API 调用的统一 fetch 封装；与 wecom/wecom-kf `http-client` 对齐。
 *
 * **关键导出**：`undiciFetch`、`readResponseBodyAsBuffer`、`UndiciFetchOptions`
 */

import type { Dispatcher } from "undici";
import { ProxyAgent, fetch as undiciFetchImpl } from "undici";

const proxyDispatchers = new Map<string, ProxyDispatcher>();

type ProxyDispatcher = Dispatcher;

/**
 * 缓存并复用 ProxyAgent，避免重复创建连接池。
 */
function getProxyDispatcher(proxyUrl: string): ProxyDispatcher {
  const existing = proxyDispatchers.get(proxyUrl);
  if (existing) return existing;
  const created = new ProxyAgent(proxyUrl);
  proxyDispatchers.set(proxyUrl, created);
  return created;
}

function mergeAbortSignal(params: {
  signal?: AbortSignal;
  timeoutMs?: number;
}): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (params.signal) signals.push(params.signal);
  if (params.timeoutMs && Number.isFinite(params.timeoutMs) && params.timeoutMs > 0) {
    signals.push(AbortSignal.timeout(params.timeoutMs));
  }
  if (!signals.length) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

/**
 * undici fetch 选项。
 */
export type UndiciFetchOptions = {
  proxyUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 默认 `OpenClaw/2.0 (Message-SDK)` */
  userAgent?: string;
};

/**
 * 统一 HTTP 请求（undici fetch + 代理 + 超时 + User-Agent）。
 */
export async function undiciFetch(
  input: string | URL,
  init?: RequestInit,
  opts?: UndiciFetchOptions,
): Promise<Response> {
  const proxyUrl = opts?.proxyUrl?.trim() ?? "";
  const dispatcher = proxyUrl ? getProxyDispatcher(proxyUrl) : undefined;

  const initSignal = init?.signal ?? undefined;
  const signal = mergeAbortSignal({ signal: opts?.signal ?? initSignal, timeoutMs: opts?.timeoutMs });

  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", opts?.userAgent?.trim() || "OpenClaw/2.0 (Message-SDK)");
  }

  const nextInit = {
    ...(init ?? {}),
    ...(signal ? { signal } : {}),
    ...(dispatcher ? { dispatcher } : {}),
    headers,
  };

  try {
    return (await undiciFetchImpl(
      input,
      nextInit as Parameters<typeof undiciFetchImpl>[1],
    )) as unknown as Response;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "TypeError" && err.message === "fetch failed") {
      const cause = (err as Error & { cause?: unknown }).cause;
      console.error(
        `[undici-fetch] fetch failed: ${input} (proxy: ${proxyUrl || "none"})${cause ? ` - cause: ${String(cause)}` : ""}`,
      );
    }
    throw err;
  }
}

/**
 * 将 Response body 读取为 Buffer，支持最大字节限制（防 OOM）。
 */
export async function readResponseBodyAsBuffer(res: Response, maxBytes?: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);

  const limit = maxBytes && Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : undefined;
  const chunks: Uint8Array[] = [];
  let total = 0;

  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (limit && total > limit) {
      try {
        await reader.cancel("body too large");
      } catch {
        // ignore
      }
      throw new Error(`response body too large (>${limit} bytes)`);
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}
