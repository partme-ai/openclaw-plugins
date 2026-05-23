/**
 * @module shared/http-client
 *
 * 企微 KF 出站 HTTP（undici + 代理 + 超时 + 限流读 body）。
 *
 * **与 message-sdk 关系**：核心实现见 `@partme.ai/openclaw-message-sdk` 的 `undiciFetch`；
 * 本模块保留 WeCom 专用 User-Agent 与历史导出名（`wecomFetch`）。
 */

import {
  undiciFetch as sdkUndiciFetch,
  readResponseBodyAsBuffer,
  type UndiciFetchOptions,
} from "@partme.ai/openclaw-message-sdk/http";

export type WecomHttpOptions = UndiciFetchOptions;

/**
 * 统一 HTTP 请求（WeCom KF User-Agent 包装）。
 */
export async function wecomFetch(
  input: string | URL,
  init?: RequestInit,
  opts?: WecomHttpOptions,
): Promise<Response> {
  return sdkUndiciFetch(input, init, {
    ...opts,
    userAgent: opts?.userAgent ?? "OpenClaw/2.0 (WeCom-Agent)",
  });
}

export { readResponseBodyAsBuffer };
