/**
 * @module config/resolvers
 *
 * Web MQTT 渠道级配置解析：委托 message-sdk，保留插件默认值。
 */

import {
  resolveChannelAgentReplyTimeoutMs,
  resolveChannelMediaMaxBytes,
  type ChannelLimitsOpenClawConfig,
} from "@partme.ai/openclaw-message-sdk/config";

/** OpenClaw channels.mqtt-ws 渠道 ID。 */
export const WEB_MQTT_CHANNEL_ID = "mqtt-ws";

/** 默认 Agent 回复超时。 */
export const DEFAULT_WEB_MQTT_AGENT_REPLY_TIMEOUT_MS = 120_000;

/** 默认 Web MQTT 媒体/载荷上限（与 limits.maxPayloadBytes 独立）。 */
export const DEFAULT_WEB_MQTT_MEDIA_MAX_BYTES = 80 * 1024 * 1024;

/**
 * 解析 Web MQTT Agent 回复超时（委托 message-sdk）。
 */
export function resolveWebMqttAgentReplyTimeoutMs(
  cfg: ChannelLimitsOpenClawConfig,
  channelDefaultMs = DEFAULT_WEB_MQTT_AGENT_REPLY_TIMEOUT_MS,
): number {
  return resolveChannelAgentReplyTimeoutMs({
    channelId: WEB_MQTT_CHANNEL_ID,
    cfg,
    defaultTimeoutMs: channelDefaultMs,
  });
}

/**
 * 解析 Web MQTT 媒体最大字节数（委托 message-sdk）。
 */
export function resolveWebMqttMediaMaxBytes(
  cfg: ChannelLimitsOpenClawConfig,
  channelDefaultBytes = DEFAULT_WEB_MQTT_MEDIA_MAX_BYTES,
): number {
  return resolveChannelMediaMaxBytes({
    channelId: WEB_MQTT_CHANNEL_ID,
    cfg,
    channelDefaultBytes,
  });
}
