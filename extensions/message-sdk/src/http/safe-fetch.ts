/**
 * 带 SSRF 防护的 fetch（优先 OpenClaw ssrf-runtime）。
 */

import { importOpenClawPluginSdk } from "../openclaw-loader.js";

export type SafeFetchOptions = RequestInit & {
  maxBytes?: number;
  timeoutMs?: number;
};

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/,
];

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

  const timeoutMs = init?.timeoutMs;
  const signal =
    timeoutMs && timeoutMs > 0
      ? AbortSignal.timeout(timeoutMs)
      : init?.signal;

  return fetch(input, { ...init, signal });
}
