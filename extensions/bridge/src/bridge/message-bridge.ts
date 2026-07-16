/**
 * @fileoverview OpenClaw 消息生命周期 Hook → MQ 的 UnifiedMessage 桥接层。
 *
 * @description
 * **架构角色**：监听 `message_received` 与 `reply_payload_sending`，分别构造
 * `UnifiedMessage` JSON 并通过 OpenClaw 公共 channel outbound adapter 投递到消息中间件。
 *
 * **配置驱动**：仅当 `pluginConfig.channels.<channelId>` 存在且 `enabled !== false`、
 * `forwardToMq !== false` 时才转发；`mqChannel` 白名单校验后回退 `mqtt`。
 *
 * **ID 设计**：
 * - `traceId`：由 `sessionKey` 等稳定字段确定性派生，同会话 inbound/outbound 共享。
 * - `messageId`：每条消息唯一，含方向/渠道/账号/智能体/时间戳，便于日志检索。
 *
 * **关键依赖**：`openclaw/plugin-sdk`（事件与 publish API）、`./channels.js`（渠道闸门）。
 *
 * @module bridge/message-bridge
 */

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

import { createHash, randomUUID } from "node:crypto";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { getChannelMeta } from "./channels.js";

// ── 已知的合法 MQ 渠道 ──

/** @description Bridge 允许配置的 MQ 传输别名；未知值会 warn 并回退 `mqtt`。 */
const MQ_CHANNEL_ALIASES: Record<string, string> = {
  mqtt: "mqtt",
  "mqtt-ws": "mqtt-ws",
  "web-mqtt": "mqtt-ws",
  rabbitmq: "rabbitmq",
  "redis-stream": "redis-stream",
  rocketmq: "rocketmq",
  stomp: "stomp",
  "web-stomp": "stomp",
  "stomp-tcp": "stomp-tcp",
};
const DIRECT_TOPIC_CHANNELS = new Set(["mqtt", "mqtt-ws", "rabbitmq", "redis-stream", "rocketmq"]);
const DIRECT_TARGET_PREFIX = "openclaw-direct-topic:v1:";
const DEFAULT_DELIVERY = { maxAttempts: 3, retryDelayMs: 250, publishTimeoutMs: 5_000, maxPayloadBytes: 1_048_576 };

// ── 消息类型 ──

/** @description UnifiedMessage 正文格式抽象（当前桥接路径主要产出 `text`）。 */
type MessageContentType = "text" | "markdown" | "mixed";

/**
 * @description 跨渠道统一的消息信封，供 MQ 消费者与下游 Router 解析。
 */
export interface UnifiedMessage {
  /** @description 单条消息唯一 ID（见 `generateMessageId`）。 */
  messageId: string;
  /** @description 会话级追踪 ID（见 `deriveTraceId`）；同 sessionKey 下 inbound/outbound 一致。 */
  traceId: string;
  /** @description Unix 毫秒时间戳（消息构建时刻）。 */
  timestamp: number;
  /** @description 消息来源：渠道、账号、智能体、用户及会话类型。 */
  source: {
    /** @description OpenClaw 逻辑渠道 ID。 */
    channel: string;
    /** @description 渠道侧账号/机器人实例 ID。 */
    accountId: string;
    /** @description 处理该会话的智能体 ID。 */
    agentId: string;
    /** @description 终端用户或发送方标识。 */
    userId: string;
    /** @description 单聊或群聊上下文。 */
    chatType: "direct" | "group";
  };
  /** @description （可选）多播/路由目标渠道列表，桥接路径通常不填充。 */
  target?: { channels: string[] };
  /** @description 正文格式标签。 */
  contentType: MessageContentType;
  /** @description 从消息 Hook 载荷提取的纯文本正文。 */
  text: string;
  /** @description （可选）Markdown 变体正文，当前 build 路径未单独填充。 */
  markdown?: string;
  /** @description 附件列表；桥接路径默认为空数组。 */
  media: Array<{ url: string; kind: string; mimeType: string; fileName?: string }>;
  /** @description 扩展元数据（含 sessionKey、bridge 标识、direction 等）。 */
  metadata?: Record<string, unknown>;
  /** @description 相对 Agent 的方向：用户入站或助手出站。 */
  direction: "inbound" | "outbound";
}

// ── ID 生成 ──

/**
 * @description 确定性字符串哈希：FNV-1a 32 位折叠为 base36，用于 trace 摘要段。
 * @param input - 待哈希的 UTF-16 字符串（通常为 channel:account:agent:sessionKey）。
 * @returns 固定长度的 base36 摘要；同输入恒同输出（非密码学安全）。
 * @throws 不抛出。
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

/**
 * @description 将路径段中的 `/` 替换为 `_`，避免 traceId/messageId 分段解析歧义。
 * @param seg - 原始段（渠道名、账号 ID 等）。
 * @returns 安全段字符串。
 * @throws 不抛出。
 */
function safeSegment(seg: string): string {
  return seg.replace(/\//g, "_");
}

/**
 * @description 从会话稳定标识确定性派生 traceId，供全链路关联 inbound/outbound。
 *
 * 逻辑：sessionKey 是 OpenClaw 为每个会话分配的唯一稳定 key，
 * 同一会话中 inbound/outbound 共享同一个 sessionKey → 同一个 traceId。
 * 加上 channel/accountId/agentId 使 traceId 在跨渠道路由时可辨识来源。
 *
 * 格式: `trace/{channelSafe}/{accountSafe}/{agentSafe}/{stableDigest}`
 * 示例: `trace/discord/main/assistant/c7h2k9`
 *
 * @param channel - OpenClaw 逻辑渠道 ID。
 * @param accountId - 渠道账号/机器人实例 ID。
 * @param agentId - 智能体 ID。
 * @param sessionKey - 宿主分配的会话稳定键。
 * @returns 可嵌入 topic/日志的路径式 traceId。
 * @throws 不抛出。
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
 * @description 生成单条消息唯一 messageId，含方向缩写与时间/random 后缀。
 *
 * 格式: `bridge/{in|out}/{channel}/{accountId}/{agentId}/{ts36}-{rand}`
 * 示例: `bridge/in/discord/main/assistant/m1a2b3c-x4y5`
 *
 * @param channel - OpenClaw 逻辑渠道 ID。
 * @param accountId - 渠道账号 ID。
 * @param agentId - 智能体 ID。
 * @param direction - `inbound` 映射为路径段 `in`，`outbound` 为 `out`。
 * @returns 全局唯一（工程语义）的消息 ID 字符串。
 * @throws 不抛出。
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
 * @description 从运行时上下文字段组装完整 `UnifiedMessage`（公开 API，供测试与下游直接构建）。
 * @param params - 构建参数。
 * @param params.channel - 逻辑渠道 ID。
 * @param params.accountId - 账号 ID。
 * @param params.agentId - 智能体 ID。
 * @param params.sessionKey - 会话稳定键（用于 traceId）。
 * @param params.userId - 用户/发送方 ID。
 * @param params.chatType - 单聊或群聊，默认 `direct`。
 * @param params.text - 正文，默认空串。
 * @param params.direction - 消息方向，默认 `inbound`。
 * @param params.metadata - 可选扩展元数据。
 * @returns 填充了 messageId、traceId、timestamp 的 UnifiedMessage。
 * @throws 不抛出。
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
  messageId?: string;
  traceId?: string;
  timestamp?: number;
}): UnifiedMessage {
  const direction = params.direction ?? "inbound";
  return {
    messageId: params.messageId ?? generateMessageId(params.channel, params.accountId, params.agentId, direction),
    traceId: params.traceId ?? deriveTraceId(params.channel, params.accountId, params.agentId, params.sessionKey),
    timestamp: params.timestamp ?? Date.now(),
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

/** @description 单渠道 MQ 转发开关（映射自 `pluginConfig.channels` 条目）。 */
export interface BridgeChannelConfig {
  /** @description 为 `false` 时该渠道完全不桥接。 */
  enabled?: boolean;
  /** @description 为 `false` 时跳过消息 Hook → MQ。 */
  forwardToMq?: boolean;
  /** @description MQ 传输别名，须落在 `VALID_MQ_CHANNELS` 内才原样使用。 */
  mqChannel?: string;
  mqAccountId?: string;
  topicPrefix?: string;
}

/** @description Bridge 插件配置根：`channels` 键为 channelId。 */
export interface BridgeConfig {
  channels?: Record<string, BridgeChannelConfig>;
  delivery?: Partial<typeof DEFAULT_DELIVERY>;
}

/**
 * @description 从宿主 API 读取并断言 Bridge 插件配置形状。
 * @param api - OpenClaw 插件 API。
 * @returns 松散类型的 Bridge 配置对象（缺省字段由调用方解释）。
 * @throws 不抛出。
 */
function getConfig(api: OpenClawPluginApi): BridgeConfig {
  return (api.pluginConfig ?? {}) as BridgeConfig;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function extractText(content: unknown): string | undefined {
  if (typeof content === "string") return readString(content);
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const value = part as Record<string, unknown>;
    const text = readString(value.text) ?? readString(value.content);
    return text ? [text] : [];
  });
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function resolveMqChannel(value: string | undefined): string {
  const requested = value ?? "mqtt";
  const resolved = MQ_CHANNEL_ALIASES[requested];
  if (!resolved) {
    throw new Error(`[openclaw-bridge] unsupported mqChannel "${requested}"; expected one of ${Object.keys(MQ_CHANNEL_ALIASES).join(", ")}`);
  }
  return resolved;
}

function resolveDelivery(config: BridgeConfig): typeof DEFAULT_DELIVERY {
  const delivery = { ...DEFAULT_DELIVERY, ...config.delivery };
  for (const [name, value] of Object.entries(delivery)) {
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      throw new Error(`[openclaw-bridge] delivery.${name} must be a positive integer`);
    }
  }
  return delivery;
}

export function validateBridgeConfig(config: BridgeConfig): void {
  resolveDelivery(config);
  for (const [channelId, channel] of Object.entries(config.channels ?? {})) {
    if (!getChannelMeta(channelId)) throw new Error(`[openclaw-bridge] unsupported source channel "${channelId}"`);
    resolveMqChannel(channel.mqChannel);
    if (channel.topicPrefix !== undefined && !readString(channel.topicPrefix)) {
      throw new Error(`[openclaw-bridge] channels.${channelId}.topicPrefix must be non-empty`);
    }
  }
}

function encodeTarget(channel: string, topic: string): string {
  if (DIRECT_TOPIC_CHANNELS.has(channel)) return `${DIRECT_TARGET_PREFIX}${encodeURIComponent(topic)}`;
  if (channel === "stomp" || channel === "stomp-tcp") {
    return topic.startsWith("/topic/") ? topic : `/topic/${topic.replaceAll("/", ".")}`;
  }
  return topic;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`publish timed out after ${timeoutMs}ms; outcome is unknown`)), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function publishToMq(params: {
  api: OpenClawPluginApi;
  config: BridgeConfig;
  channelConfig: BridgeChannelConfig;
  sourceChannel: string;
  direction: "inbound" | "outbound";
  message: UnifiedMessage;
}): Promise<void> {
  const mqChannel = resolveMqChannel(params.channelConfig.mqChannel);
  const topicPrefix = readString(params.channelConfig.topicPrefix) ?? `openclaw/bridge/${params.sourceChannel}`;
  const topic = `${topicPrefix.replace(/\/$/, "")}/${params.direction}`;
  const content = JSON.stringify(params.message);
  const delivery = resolveDelivery(params.config);
  if (Buffer.byteLength(content, "utf8") > delivery.maxPayloadBytes) {
    throw new Error(`[openclaw-bridge] payload exceeds delivery.maxPayloadBytes=${delivery.maxPayloadBytes}`);
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= delivery.maxAttempts; attempt += 1) {
    try {
      const adapter = await params.api.runtime.channel.outbound.loadAdapter(mqChannel);
      if (!adapter?.sendText) throw new Error(`[openclaw-bridge] outbound adapter unavailable or lacks sendText: ${mqChannel}`);
      await withTimeout(adapter.sendText({
        cfg: params.api.runtime.config.current() as never,
        to: encodeTarget(mqChannel, topic),
        text: content,
        accountId: params.channelConfig.mqAccountId ?? null,
        deliveryQueueId: params.message.messageId,
      }), delivery.publishTimeoutMs);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < delivery.maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delivery.retryDelayMs * attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function stableMessageId(direction: "inbound" | "outbound", channel: string, identity: string): string {
  const digest = createHash("sha256").update(`${direction}:${channel}:${identity}`).digest("hex");
  return `bridge/${direction === "inbound" ? "in" : "out"}/${safeSegment(channel)}/${digest}`;
}

class ReplyOrdinalTracker {
  private readonly ordinals = new Map<string, number>();

  next(runIdentity: string): number {
    const value = this.ordinals.get(runIdentity) ?? 0;
    this.ordinals.set(runIdentity, value + 1);
    if (this.ordinals.size > 10_000) this.ordinals.delete(this.ordinals.keys().next().value as string);
    return value;
  }
}

/**
 * @description 注册 `message_received` 与 `reply_payload_sending`：按配置将真实收发载荷转发到 MQ。
 *
 * **处理流程**：
 * 1. 校验 `channelId`、渠道配置、`getChannelMeta` 闸门
 * 2. 从真实入站或回复 payload 提取正文并生成稳定投递 ID
 * 3. 通过公共 outbound adapter 发布 inbound/outbound topic
 *
 * @param api - OpenClaw 插件 API（`on`、`publishInbound`、`logger`）。
 * @returns void
 * @throws 不抛出同步异常；publish 失败仅记录 error 日志。
 */
export function registerMessageBridge(api: OpenClawPluginApi): void {
  const config = getConfig(api);
  validateBridgeConfig(config);
  const replyOrdinals = new ReplyOrdinalTracker();

  api.on("message_received", async (event, ctx) => {
    const channelId = ctx.channelId;
    const channelConfig = config.channels?.[channelId];
    if (!channelConfig || channelConfig.enabled === false || channelConfig.forwardToMq === false) return;
    const text = extractText(event.content);
    if (!text) return;
    const sessionKey = ctx.sessionKey ?? event.sessionKey ?? ctx.conversationId ?? "";
    const identity = ctx.messageId ?? event.messageId ?? ctx.runId ?? event.runId ?? randomUUID();
    const message = buildMessage({
      channel: channelId,
      accountId: ctx.accountId ?? "default",
      agentId: "default",
      sessionKey,
      userId: ctx.senderId ?? event.senderId ?? event.from ?? "unknown",
      text,
      messageId: stableMessageId("inbound", channelId, identity),
      traceId: readString(event.traceId) ?? deriveTraceId(channelId, ctx.accountId ?? "default", "default", sessionKey),
      timestamp: event.timestamp,
      metadata: { sessionKey, runId: ctx.runId ?? event.runId, sourceChannel: channelId, bridge: "openclaw-bridge", direction: "inbound" },
    });
    await publishToMq({ api, config, channelConfig, sourceChannel: channelId, direction: "inbound", message });
  });

  api.on("reply_payload_sending", async (event, ctx) => {
    const channelId = ctx.channelId;
    const channelConfig = config.channels?.[channelId];
    if (!channelConfig || channelConfig.enabled === false || channelConfig.forwardToMq === false) return;
    const text = extractText(event.payload.text);
    if (!text) return;
    const sessionKey = ctx.sessionKey ?? event.sessionKey ?? ctx.conversationId ?? "";
    const runIdentity = event.runId ?? ctx.runId ?? randomUUID();
    const ordinal = replyOrdinals.next(`${channelId}:${sessionKey}:${runIdentity}`);
    const message = buildMessage({
      channel: channelId,
      accountId: ctx.accountId ?? "default",
      agentId: event.usageState?.agentId ?? "default",
      sessionKey,
      userId: ctx.senderId ?? ctx.conversationId ?? "unknown",
      text,
      direction: "outbound",
      messageId: stableMessageId("outbound", channelId, `${runIdentity}:${event.kind}:${ordinal}`),
      traceId: readString(ctx.traceId) ?? deriveTraceId(channelId, ctx.accountId ?? "default", "default", sessionKey),
      metadata: { sessionKey, runId: event.runId ?? ctx.runId, kind: event.kind, ordinal, sourceChannel: channelId, bridge: "openclaw-bridge", direction: "outbound" },
    });
    await publishToMq({ api, config, channelConfig, sourceChannel: channelId, direction: "outbound", message });
  });

  api.logger.info("[openclaw-bridge] Message bridge registered");
}
