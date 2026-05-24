/**
 * @module config/resolvers
 *
 * MQTT 渠道级配置解析：委托 message-sdk，保留插件默认值。
 */

import {
  resolveChannelAgentReplyTimeoutMs,
  resolveChannelMediaMaxBytes,
  type ChannelLimitsOpenClawConfig,
} from "@partme.ai/openclaw-message-sdk/config";

/** OpenClaw channels.mqtt 渠道 ID。 */
export const MQTT_CHANNEL_ID = "mqtt";

/** 默认 Agent 回复超时（与 limits.maxPayloadBytes 无关，供 embedded/subagent 扩展）。 */
export const DEFAULT_MQTT_AGENT_REPLY_TIMEOUT_MS = 120_000;

/** 默认 MQTT 媒体/载荷上限（80MB，与 broker limits.maxPayloadBytes 独立配置项）。 */
export const DEFAULT_MQTT_MEDIA_MAX_BYTES = 80 * 1024 * 1024;

/**
 * 解析 MQTT 通道 Agent 回复超时（委托 message-sdk）。
 */
export function resolveMqttAgentReplyTimeoutMs(
  cfg: ChannelLimitsOpenClawConfig,
  channelDefaultMs = DEFAULT_MQTT_AGENT_REPLY_TIMEOUT_MS,
): number {
  return resolveChannelAgentReplyTimeoutMs({
    channelId: MQTT_CHANNEL_ID,
    cfg,
    defaultTimeoutMs: channelDefaultMs,
  });
}

/**
 * 解析 MQTT 通道媒体最大字节数（委托 message-sdk）。
 */
export function resolveMqttMediaMaxBytes(
  cfg: ChannelLimitsOpenClawConfig,
  channelDefaultBytes = DEFAULT_MQTT_MEDIA_MAX_BYTES,
): number {
  return resolveChannelMediaMaxBytes({
    channelId: MQTT_CHANNEL_ID,
    cfg,
    channelDefaultBytes,
  });
}
