/**
 * 抖音渠道 message-sdk 配置解析（媒体上限、Agent 超时、出口代理）。
 */

import {
  resolveChannelAgentReplyTimeoutMs,
  resolveChannelEgressProxyUrl,
  resolveChannelMediaMaxBytes,
  type ChannelLimitsOpenClawConfig,
} from "../runtime/runtime-api.js";

const CHANNEL_ID = "douyin";
const DEFAULT_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_AGENT_REPLY_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 解析抖音入站/出站媒体最大字节数。
 */
export function resolveDouyinMediaMaxBytes(cfg: ChannelLimitsOpenClawConfig): number {
  return resolveChannelMediaMaxBytes({
    channelId: CHANNEL_ID,
    cfg,
    channelDefaultBytes: DEFAULT_MEDIA_MAX_BYTES,
  });
}

/**
 * 解析 Agent 回复派发超时（毫秒）。
 */
export function resolveDouyinAgentReplyTimeoutMs(cfg: ChannelLimitsOpenClawConfig): number {
  return resolveChannelAgentReplyTimeoutMs({
    channelId: CHANNEL_ID,
    cfg,
    defaultTimeoutMs: DEFAULT_AGENT_REPLY_TIMEOUT_MS,
  });
}

/**
 * 解析 HTTP 出站代理 URL。
 */
export function resolveDouyinEgressProxyUrl(cfg: ChannelLimitsOpenClawConfig): string | undefined {
  return resolveChannelEgressProxyUrl({ channelId: CHANNEL_ID, cfg });
}
