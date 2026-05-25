/**
 * @module config/resolvers
 *
 * WebSocket 渠道级配置解析（委托 message-sdk limits）。
 */

import {
  resolveChannelAgentReplyTimeoutMs,
  resolveChannelMediaMaxBytes,
  type ChannelLimitsOpenClawConfig,
} from "@partme.ai/openclaw-message-sdk/config";

/** OpenClaw channels.web-socket 渠道 ID。 */
export const WEB_SOCKET_CHANNEL_ID = "web-socket";

export const DEFAULT_WEBSOCKET_AGENT_REPLY_TIMEOUT_MS = 120_000;
export const DEFAULT_WEBSOCKET_MEDIA_MAX_BYTES = 80 * 1024 * 1024;

/**
 * 解析 WebSocket 通道 Agent 回复超时。
 */
export function resolveWebsocketAgentReplyTimeoutMs(
  cfg: ChannelLimitsOpenClawConfig,
  channelDefaultMs = DEFAULT_WEBSOCKET_AGENT_REPLY_TIMEOUT_MS,
): number {
  return resolveChannelAgentReplyTimeoutMs({
    channelId: WEB_SOCKET_CHANNEL_ID,
    cfg,
    defaultTimeoutMs: channelDefaultMs,
  });
}

/**
 * 解析 WebSocket 通道媒体最大字节数。
 */
export function resolveWebsocketMediaMaxBytes(
  cfg: ChannelLimitsOpenClawConfig,
  channelDefaultBytes = DEFAULT_WEBSOCKET_MEDIA_MAX_BYTES,
): number {
  return resolveChannelMediaMaxBytes({
    channelId: WEB_SOCKET_CHANNEL_ID,
    cfg,
    channelDefaultBytes,
  });
}
