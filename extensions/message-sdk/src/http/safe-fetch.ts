/**
 * @module http/safe-fetch
 *
 * 带 SSRF 防护的 fetch（优先 OpenClaw ssrf-runtime）。
 *
 * **职责**：阻止内网/非 HTTP(S) URL，防止服务端请求伪造；生产环境优先委托 OpenClaw SDK。
 *
 * **关键导出**：`safeFetch`
 */

import { importOpenClawPluginSdk } from "../openclaw/loader.js";

/**
 * 安全 fetch 选项 / Safe fetch options extending `RequestInit`.
 *
 * @property maxBytes - 响应体最大字节（委托 SDK 时生效）
 * @property timeoutMs - 请求超时毫秒（本地降级时使用 `AbortSignal.timeout`）
 */
export type SafeFetchOptions = RequestInit & {
  maxBytes?: number;
  timeoutMs?: number;
};

/** 内网/本地主机名模式 — 命中则拒绝请求 */
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/,
];

/**
 * 判断 URL 是否应被 SSRF 规则拦截。
 *
 * @param url - 待检测 URL 字符串
 * @returns `true` 表示非 http(s)、内网或解析失败
 */
function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return true;
    const host = parsed.hostname;
    if (PRIVATE_HOST_PATTERNS.some((p) => p.test(host))) return true;
    if (host.endsWith(".local")) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * 安全 fetch：阻止内网/非 HTTP(S) URL；优先使用 OpenClaw `fetchWithSsrFGuard`。
 *
 * @param input - 请求 URL
 * @param init - fetch 选项与超时配置
 * @returns 原生 `Response`
 * @throws URL 被 SSRF 规则拦截时抛错
 *
 * @example
 * ```ts
 * const resp = await safeFetch("https://api.example.com/data", { timeoutMs: 5000 });
 * ```
 */
export async function safeFetch(input: string | URL, init?: SafeFetchOptions): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  if (isBlockedUrl(url)) {
    throw new Error(`safeFetch: blocked URL ${url}`);
  }

  const sdk = await importOpenClawPluginSdk<{
    fetchWithSsrFGuard?: (u: string | URL, i?: RequestInit) => Promise<Response>;
  }>("ssrf-runtime");

  if (typeof sdk?.fetchWithSsrFGuard === "function") {
    return sdk.fetchWithSsrFGuard(input, init);
  }

  // 降级：本地 fetch + 可选超时
  const timeoutMs = init?.timeoutMs;
  const signal =
    timeoutMs && timeoutMs > 0
      ? AbortSignal.timeout(timeoutMs)
      : init?.signal;

  return fetch(input, { ...init, signal });
}
