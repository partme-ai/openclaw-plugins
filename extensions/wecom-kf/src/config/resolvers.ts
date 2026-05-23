/**
 * @module config/resolvers
 *
 * 渠道级配置解析：出口代理、媒体上限、默认路由 fail-closed 策略。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  resolveChannelEgressProxyUrl,
  resolveChannelMediaMaxBytes,
} from "@partme.ai/openclaw-message-sdk/config";

import type { WecomConfig, WecomNetworkConfig } from "../types/index.js";
import { detectMode } from "./accounts.js";
import { WECOM_KF_CHANNEL_ID } from "./channel-block.js";

const WECOM_EGRESS_PROXY_ENV_KEYS = [
  "OPENCLAW_WECOM_EGRESS_PROXY_URL",
  "WECOM_EGRESS_PROXY_URL",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "HTTP_PROXY",
] as const;

/** 默认媒体上限（80MB），兼顾视频/较大文件；仍设上限防止恶意大文件拖垮内存。 */
export const DEFAULT_WECOM_MEDIA_MAX_BYTES = 80 * 1024 * 1024;

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
 */
export function resolveWecomEgressProxyUrl(cfg: OpenClawConfig): string | undefined {
  return resolveChannelEgressProxyUrl({
    channelId: WECOM_KF_CHANNEL_ID,
    cfg,
    envKeys: [...WECOM_EGRESS_PROXY_ENV_KEYS],
  });
}

/**
 * 解析 WeCom KF 通道媒体最大字节数（委托 message-sdk）。
 */
export function resolveWecomMediaMaxBytes(cfg: OpenClawConfig): number {
  return resolveChannelMediaMaxBytes({
    channelId: WECOM_KF_CHANNEL_ID,
    cfg,
    channelDefaultBytes: DEFAULT_WECOM_MEDIA_MAX_BYTES,
  });
}

/**
 * 默认策略：
 * - matrix（多账号）: 开启 fail-closed，防止未绑定账号回退到 main
 * - legacy（单账号兼容）: 维持历史行为，不强制拦截
 */
export function resolveWecomFailClosedOnDefaultRoute(cfg: OpenClawConfig): boolean {
  const wecom = cfg.channels?.["wecom-kf"] as WecomConfig | undefined;
  const explicit = wecom?.routing?.failClosedOnDefaultRoute;
  if (typeof explicit === "boolean") return explicit;
  return detectMode(wecom) === "matrix";
}

/**
 * 判断是否应拒绝 default 路由匹配（多账号 fail-closed）。
 */
export function shouldRejectWecomDefaultRoute(params: {
  cfg: OpenClawConfig;
  matchedBy: string;
  useDynamicAgent: boolean;
}): boolean {
  if (params.matchedBy !== "default") return false;
  if (params.useDynamicAgent) return false;
  return resolveWecomFailClosedOnDefaultRoute(params.cfg);
}
