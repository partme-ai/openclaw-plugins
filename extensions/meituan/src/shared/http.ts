/**
 * 美团渠道 HTTP 客户端（undici + 出口代理）。
 */

import {
  undiciFetch,
  readResponseBodyAsBuffer,
  type ChannelLimitsOpenClawConfig,
} from "../runtime/runtime-api.js";
import { resolveMeituanEgressProxyUrl } from "../config/resolvers.js";

const USER_AGENT = "OpenClaw/2.0 (Meituan-Channel)";

/**
 * 带代理与超时的 HTTP 请求。
 */
export async function meituanFetch(
  cfg: ChannelLimitsOpenClawConfig | undefined,
  input: string | URL,
  init?: RequestInit,
  opts?: { timeoutMs?: number },
): Promise<Response> {
  const proxyUrl = resolveMeituanEgressProxyUrl(cfg ?? {});
  return undiciFetch(input, init, {
    proxyUrl,
    timeoutMs: opts?.timeoutMs,
    userAgent: USER_AGENT,
  });
}

export { readResponseBodyAsBuffer };
