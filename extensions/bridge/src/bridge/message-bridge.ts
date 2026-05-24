/**
 * OpenClaw Bridge — UnifiedMessage 消息桥接
 *
 * 配置驱动：按 channels.<id> 配置决定是否转发到 MQ。
 * 多个渠道共享同一套 UnifiedMessage 转换逻辑。
 *
 * traceId 设计原则：
 *   从会话稳定标识（sessionKey）确定性派生，同一会话的 inbound/outbound
 *   以及下游各节点始终得到相同的 traceId，实现全链路追踪。
 *
 * messageId 设计原则：
 *   每条消息唯一，编码方向/渠道/账号/智能体/时间戳，便于日志排查。
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { getChannelMeta } from "./channels.js";

// ── 已知的合法 MQ 渠道 ──

const VALID_MQ_CHANNELS = new Set([
  "mqtt", "rabbitmq", "redis-stream", "rocketmq", "stomp", "web-mqtt", "web-stomp",
]);

// ── 消息类型 ──

type MessageContentType = "text" | "markdown" | "mixed";

export interface UnifiedMessage {
  messageId: string;
  traceId: string;
  timestamp: number;
  source: {
    channel: string;
    accountId: string;
    agentId: string;
    userId: string;
    chatType: "direct" | "group";
  };
  target?: { channels: string[] };
  contentType: MessageContentType;
  text: string;
  markdown?: string;
  media: Array<{ url: string; kind: string; mimeType: string; fileName?: string }>;
  metadata?: Record<string, unknown>;
  direction: "inbound" | "outbound";
}

// ── ID 生成 ──

/**
 * 确定性哈希：将字符串折叠为固定长度的 base36 摘要。
 * 不追求密码学安全性，只追求同输入 → 同输出，异输入 → 低碰撞。
 */
function stableHash(input: string): string {
  let h = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
    h = h >>> 0; // keep uint32
  }
  return h.toString(36);
}

/** 清理路径段中的 '/' 防止解析歧义 */
function safeSegment(seg: string): string {
  return seg.replace(/\//g, "_");
}

/**
 * 从会话稳定标识确定性派生 traceId。
 *
 * 逻辑：sessionKey 是 OpenClaw 为每个会话分配的唯一稳定 key，
 * 同一会话中 inbound/outbound 共享同一个 sessionKey → 同一个 traceId。
 * 加上 channel/accountId/agentId 使 traceId 在跨渠道路由时可辨识来源。
 *
 * 格式: "trace/{channelSafe}/{accountSafe}/{agentSafe}/{stableDigest}"
 * 示例: "trace/discord/main/assistant/c7h2k9"
 *
 * 消费方可直接从 traceId 解析渠道和账号，无需反序列化消息体。
 * 只要 sessionKey 不变，traceId 就不变 — 实现全链路关联。
 */
export function deriveTraceId(
  channel: string,
  accountId: string,
  agentId: string,
  sessionKey: string,
): string {
  const digest = stableHash(`${channel}:${accountId}:${agentId}:${sessionKey}`);
  return `trace/${safeSegment(channel)}/${safeSegment(accountId)}/${safeSegment(agentId)}/${digest}`;
}

/**
 * 生成唯一 messageId：bridge/{direction}/{channel}/{accountId}/{agentId}/{ts36}-{rand}
 *
 * messageId 标识单条消息（不是会话），每条消息唯一。
 * 包含方向标记，便于日志过滤。
 *
 * 示例: "bridge/in/discord/main/assistant/m1a2b3c-x4y5"
 */
export function generateMessageId(
  channel: string,
  accountId: string,
  agentId: string,
  direction: "inbound" | "outbound",
): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `bridge/${direction === "inbound" ? "in" : "out"}/${safeSegment(channel)}/${safeSegment(accountId)}/${safeSegment(agentId)}/${ts}-${rand}`;
}

/**
 * 从 channel/accountId/agentId/sessionKey 构建 UnifiedMessage。
 *
 * 公开导出以便下游直接构建或测试。
 */
export function buildMessage(params: {
  channel: string;
  accountId: string;
  agentId: string;
  sessionKey: string;
  userId: string;
  chatType?: "direct" | "group";
  text?: string;
  direction?: "inbound" | "outbound";
  metadata?: Record<string, unknown>;
}): UnifiedMessage {
  const direction = params.direction ?? "inbound";
  return {
    messageId: generateMessageId(params.channel, params.accountId, params.agentId, direction),
    traceId: deriveTraceId(params.channel, params.accountId, params.agentId, params.sessionKey),
    timestamp: Date.now(),
    source: {
      channel: params.channel,
      accountId: params.accountId,
      agentId: params.agentId,
      userId: params.userId,
      chatType: params.chatType ?? "direct",
    },
    contentType: "text",
    text: params.text ?? "",
    media: [],
    metadata: params.metadata,
    direction,
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

    // agentAccountId 在运行时存在（wecom、router 等插件均使用），
    // 但 SDK 类型定义可能未包含此字段。
    const accountId = (ctx as Record<string, unknown>).agentAccountId as string ?? "default";
    const agentId = (ctx as Record<string, unknown>).agentId as string ?? "default";
    const sessionKey = (ctx as Record<string, unknown>).sessionKey as string ?? "";

    // MQ 渠道校验：仅允许已知的合法 MQ 渠道
    const mqChannel = channelCfg.mqChannel ?? "mqtt";
    if (!VALID_MQ_CHANNELS.has(mqChannel)) {
      api.logger.warn(
        `[openclaw-bridge] Unknown mqChannel "${mqChannel}" for channel "${channelId}". ` +
        `Valid options: ${[...VALID_MQ_CHANNELS].join(", ")}. Falling back to "mqtt".`,
      );
    }
    const resolvedMqChannel = VALID_MQ_CHANNELS.has(mqChannel) ? mqChannel : "mqtt";
    const topicPrefix = `openclaw/bridge/${channelId}`;

    // 单次反转，缓存结果——避免双重反转
    const reversed = [...msgs].reverse();
    const userMsg = reversed.find((m) => m.role === "user");
    const agentReply = reversed.find((m) => m.role === "assistant");

    // senderId/chatType 来自运行时事件中的额外属性；
    // SDK 类型定义可能不包含这些字段，但运行时通常会填充它们。
    // 使用 ?? 回退，保证始终有默认值。
    const userId = (e.senderId as string) ?? "unknown";
    const chatType = (e.chatType as "direct" | "group") ?? "direct";

    // 入站
    if (userMsg?.content) {
      const unified = buildMessage({
        channel: channelId,
        accountId,
        agentId,
        sessionKey,
        userId,
        chatType,
        text: String(userMsg.content),
        metadata: { sessionKey, sourceChannel: channelId, bridge: "openclaw-bridge", direction: "inbound" },
      });
      // publishInbound 在运行时存在（wecom、router 等插件均使用），
      // 但 SDK 类型定义可能未包含此方法。
      (api as any).publishInbound?.({ channel: resolvedMqChannel, content: JSON.stringify(unified), topic: `${topicPrefix}/inbound` })
        .then(() => api.logger.debug?.(`[openclaw-bridge] → inbound: ${resolvedMqChannel}/${topicPrefix}/inbound`))
        .catch((err: unknown) => api.logger.error(`[openclaw-bridge] Forward inbound failed [${channelId}]: ${String(err)}`));
    }

    // 出站
    if (agentReply?.content) {
      const unified = buildMessage({
        channel: channelId,
        accountId,
        agentId,
        sessionKey,
        userId,
        chatType,
        text: String(agentReply.content),
        direction: "outbound",
        metadata: { sessionKey, sourceChannel: channelId, bridge: "openclaw-bridge", direction: "outbound" },
      });
      (api as any).publishInbound?.({ channel: resolvedMqChannel, content: JSON.stringify(unified), topic: `${topicPrefix}/outbound` })
        .then(() => api.logger.debug?.(`[openclaw-bridge] → outbound: ${resolvedMqChannel}/${topicPrefix}/outbound`))
        .catch((err: unknown) => api.logger.error(`[openclaw-bridge] Forward outbound failed [${channelId}]: ${String(err)}`));
    }
  });

  api.logger.info("[openclaw-bridge] Message bridge registered");
}
