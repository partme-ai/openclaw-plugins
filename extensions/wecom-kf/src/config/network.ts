import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveChannelEgressProxyUrl } from "@partme.ai/openclaw-message-sdk/config";

import type { WecomNetworkConfig } from "../types/index.js";
import { WECOM_KF_CHANNEL_ID } from "./channel-block.js";

const WECOM_EGRESS_PROXY_ENV_KEYS = [
  "OPENCLAW_WECOM_EGRESS_PROXY_URL",
  "WECOM_EGRESS_PROXY_URL",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "HTTP_PROXY",
] as const;

/**
 * 从账号级 network 配置解析出口代理（委托 message-sdk，供 api-client 等使用）。
 */
export function resolveWecomEgressProxyUrlFromNetwork(network?: WecomNetworkConfig): string | undefined {
  return resolveChannelEgressProxyUrl({
    channelId: WECOM_KF_CHANNEL_ID,
    cfg: { channels: { [WECOM_KF_CHANNEL_ID]: { network } } },
    envKeys: [...WECOM_EGRESS_PROXY_ENV_KEYS],
  });
}

/**
 * 解析 WeCom KF 出口 HTTP 代理 URL（委托 message-sdk）。
 *
 * @param cfg OpenClaw 全局配置
 */
export function resolveWecomEgressProxyUrl(cfg: OpenClawConfig): string | undefined {
  return resolveChannelEgressProxyUrl({
    channelId: WECOM_KF_CHANNEL_ID,
    cfg,
    envKeys: [...WECOM_EGRESS_PROXY_ENV_KEYS],
  });
}
