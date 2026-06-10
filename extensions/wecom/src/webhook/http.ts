/**
 * WeCom Agent HTTP 客户端（http）
 *
 * 基于 undici 的 fetch 封装，供 Agent API（gettoken、media、message/send）使用。
 * 与 message-sdk 无直接耦合；SSRF 防护的出站 fetch 见 runtime-api `fetchWithSsrFGuard`。
 *
 * 特性：ProxyAgent 连接池复用、SDK 超时信号合并、瞬态错误有限重试、统一 User-Agent。
 */

import type { Dispatcher } from "undici";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { buildTimeoutAbortSignal } from "openclaw/plugin-sdk/text-runtime";
import {
  retryWeComFetch,
  shouldRetryWeComHttpResponse,
  WeComTransientHttpError,
} from "./http-retry.js";

type ProxyDispatcher = Dispatcher;

const proxyDispatchers = new Map<string, ProxyDispatcher>();

/**
 * **getProxyDispatcher (获取代理 Dispatcher)**
 *
 * 缓存并复用 ProxyAgent，避免重复创建连接池。
 */
function getProxyDispatcher(proxyUrl: string): ProxyDispatcher {
  const existing = proxyDispatchers.get(proxyUrl);
  if (existing) return existing;
  const created = new ProxyAgent(proxyUrl);
  proxyDispatchers.set(proxyUrl, created);
  return created;
}

/**
 * **WecomHttpOptions (HTTP 选项)**
 *
 * @property proxyUrl 代理服务器地址
 * @property timeoutMs 请求超时时间 (毫秒)
 * @property signal AbortSignal 信号
 * @property retry 是否对瞬态错误重试，默认 true
 */
export type WecomHttpOptions = {
  proxyUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  retry?: boolean;
};

/**
 * 单次 undici fetch（无重试）。
 */
async function wecomFetchOnce(
  input: string | URL,
  init?: RequestInit,
  opts?: WecomHttpOptions,
): Promise<Response> {
  const proxyUrl = opts?.proxyUrl?.trim() ?? "";
  const dispatcher = proxyUrl ? getProxyDispatcher(proxyUrl) : undefined;

  const initSignal = init?.signal ?? undefined;
  const url = typeof input === "string" ? input : input.toString();
  const { signal, cleanup } = buildTimeoutAbortSignal({
    signal: opts?.signal ?? initSignal,
    timeoutMs: opts?.timeoutMs,
    operation: "wecomFetch",
    url,
  });

  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", "OpenClaw/2.0 (WeCom-Agent)");
  }

  const nextInit: Record<string, unknown> = {
    ...(init ?? {}),
    ...(signal ? { signal } : {}),
    ...(dispatcher ? { dispatcher } : {}),
    headers,
  };

  try {
    return (await undiciFetch(
      input,
      nextInit as Parameters<typeof undiciFetch>[1],
    )) as unknown as Response;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "TypeError" && err.message === "fetch failed") {
      const cause = (err as Error & { cause?: unknown }).cause;
      console.error(
        `[wecom-http] fetch failed: ${input} (proxy: ${proxyUrl || "none"})${cause ? ` - cause: ${String(cause)}` : ""}`,
      );
    }
    throw err;
  } finally {
    cleanup();
  }
}

/**
 * 统一 HTTP 请求入口。
 *
 * @param input 请求 URL
 * @param init 标准 RequestInit
 * @param opts.proxyUrl 企业可信 IP 场景下的 egress 代理
 * @param opts.timeoutMs 请求超时（与 init.signal 合并）
 * @param opts.signal 外部取消信号
 * @param opts.retry 瞬态错误重试，默认开启
 */
export async function wecomFetch(
  input: string | URL,
  init?: RequestInit,
  opts?: WecomHttpOptions,
): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const retryEnabled = opts?.retry !== false;

  const execute = async (): Promise<Response> => {
    const res = await wecomFetchOnce(input, init, opts);
    if (shouldRetryWeComHttpResponse(res)) {
      throw new WeComTransientHttpError(res.status, `transient HTTP ${res.status} for ${url}`);
    }
    return res;
  };

  if (!retryEnabled) {
    return wecomFetchOnce(input, init, opts);
  }

  return retryWeComFetch(execute, { label: `wecomFetch ${url}` });
}

/**
 * 将 Response body 读入 Buffer，可选 maxBytes 防止 OOM。
 *
 * @param res fetch 响应
 * @param maxBytes 最大允许字节数，超出则 cancel reader 并抛错
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
