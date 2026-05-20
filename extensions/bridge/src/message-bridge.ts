/**
 * OpenClaw Bridge — UnifiedMessage 消息桥接
 *
 * 配置驱动：按 channels.<id> 配置决定是否转发到 MQ。
 * 多个渠道共享同一套 UnifiedMessage 转换逻辑。
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { getChannelMeta } from "./channels.js";

// ── 内联消息类型（与 message-sdk 兼容） ──

type MessageContentType = "text" | "markdown" | "mixed";

interface UnifiedMessage {
  messageId: string;
  traceId: string;
  timestamp: number;
  source: { channel: string; accountId: string; userId: string; chatType: "direct" | "group" };
  target?: { channels: string[] };
  contentType: MessageContentType;
  text: string;
  markdown?: string;
  media: Array<{ url: string; kind: string; mimeType: string; fileName?: string }>;
  metadata?: Record<string, unknown>;
  direction: "inbound" | "outbound";
}

function generateTraceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateMessageId(channel?: string): string {
  return `${channel ?? "im"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildMessage(params: {
  channel: string; accountId: string; userId: string;
  chatType?: "direct" | "group"; text?: string; direction?: "inbound" | "outbound";
  metadata?: Record<string, unknown>;
}): UnifiedMessage {
  return {
    messageId: generateMessageId(params.channel),
    traceId: generateTraceId(),
    timestamp: Date.now(),
    source: { channel: params.channel, accountId: params.accountId, userId: params.userId, chatType: params.chatType ?? "direct" },
    contentType: "text",
    text: params.text ?? "",
    media: [],
    metadata: params.metadata,
    direction: params.direction ?? "inbound",
  };
}

// ── 桥接逻辑 ──

interface ChannelCfg {
  enabled?: boolean;
  forwardToMq?: boolean;
  mqChannel?: string;
}

interface BridgeConfig {
  channels?: Record<string, ChannelCfg>;
}

function getConfig(api: OpenClawPluginApi): BridgeConfig {
  return (api.pluginConfig ?? {}) as BridgeConfig;
}

export function registerMessageBridge(api: OpenClawPluginApi): void {
  api.on("agent_end", (event, ctx) => {
    const channelId = ctx.channelId;
    if (!channelId) return;

    const cfg = getConfig(api);
    const channelCfg = cfg.channels?.[channelId];

    // 未配置此渠道或未启用 → 跳过
    if (!channelCfg || channelCfg.enabled === false) return;
    // 此渠道未启用 MQ 转发 → 跳过
    if (channelCfg.forwardToMq === false) return;

    // 只有已知渠道才桥接
    const meta = getChannelMeta(channelId);
    if (!meta) return;

    const e = event as Record<string, unknown>;
    const msgs = (Array.isArray(e.messages) ? e.messages : []) as Array<Record<string, unknown>>;
    if (msgs.length === 0) return;

    const userMsg = [...msgs].reverse().find((m) => m.role === "user");
    const agentReply = [...msgs].reverse().find((m) => m.role === "assistant");
    const accountId = ctx.agentAccountId ?? "default";
    const mqChannel = channelCfg.mqChannel ?? "mqtt";
    const topicPrefix = `openclaw/bridge/${channelId}`;

    // 入站
    if (userMsg?.content) {
      const unified = buildMessage({
        channel: channelId, accountId,
        userId: (e.senderId as string) ?? "unknown",
        chatType: (e.chatType as "direct" | "group") ?? "direct",
        text: String(userMsg.content),
        metadata: { sessionKey: ctx.sessionKey, sourceChannel: channelId, bridge: "openclaw-bridge", direction: "inbound" },
      });
      api.publishInbound?.({ channel: mqChannel, content: JSON.stringify(unified), topic: `${topicPrefix}/inbound` })
        .then(() => api.logger.debug?.(`[openclaw-bridge] → inbound: ${mqChannel}/${topicPrefix}/inbound`))
        .catch((err: unknown) => api.logger.error(`[openclaw-bridge] Forward inbound failed [${channelId}]: ${String(err)}`));
    }

    // 出站
    if (agentReply?.content) {
      const unified = buildMessage({
        channel: channelId, accountId,
        userId: (e.senderId as string) ?? "unknown",
        chatType: (e.chatType as "direct" | "group") ?? "direct",
        text: String(agentReply.content), direction: "outbound",
        metadata: { sessionKey: ctx.sessionKey, sourceChannel: channelId, bridge: "openclaw-bridge", direction: "outbound" },
      });
      api.publishInbound?.({ channel: mqChannel, content: JSON.stringify(unified), topic: `${topicPrefix}/outbound` })
        .then(() => api.logger.debug?.(`[openclaw-bridge] → outbound: ${mqChannel}/${topicPrefix}/outbound`))
        .catch((err: unknown) => api.logger.error(`[openclaw-bridge] Forward outbound failed [${channelId}]: ${String(err)}`));
    }
  });

  api.logger.info("[openclaw-bridge] Message bridge registered");
}
