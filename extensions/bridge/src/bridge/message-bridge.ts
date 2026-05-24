/**
 * @fileoverview `agent_end` 事件 → MQ 的 UnifiedMessage 桥接层。
 *
 * @description
 * **架构角色**：监听宿主 `agent_end`，在用户消息与助手回复可用时分别构造
 * `UnifiedMessage` JSON 并通过 `api.publishInbound` 投递到配置的消息中间件。
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

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { getChannelMeta } from "./channels.js";

// ── 已知的合法 MQ 渠道 ──

/** @description Bridge 允许配置的 MQ 传输别名；未知值会 warn 并回退 `mqtt`。 */
const VALID_MQ_CHANNELS = new Set([
  "mqtt", "rabbitmq", "redis-stream", "rocketmq", "stomp", "web-mqtt", "web-stomp",
]);

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
  /** @description 纯文本正文（桥接时由 `agent_end` 消息 content 字符串化）。 */
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

/** @description 单渠道 MQ 转发开关（映射自 `pluginConfig.channels` 条目）。 */
interface ChannelCfg {
  /** @description 为 `false` 时该渠道完全不桥接。 */
  enabled?: boolean;
  /** @description 为 `false` 时跳过 `agent_end` → MQ。 */
  forwardToMq?: boolean;
  /** @description MQ 传输别名，须落在 `VALID_MQ_CHANNELS` 内才原样使用。 */
  mqChannel?: string;
}

/** @description Bridge 插件配置根：`channels` 键为 channelId。 */
interface BridgeConfig {
  channels?: Record<string, ChannelCfg>;
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

/**
 * @description 注册 `agent_end` 监听：按配置将用户/助手消息序列化为 UnifiedMessage 并 publish 到 MQ。
 *
 * **处理流程**：
 * 1. 校验 `channelId`、渠道配置、`getChannelMeta` 闸门
 * 2. 解析 `agent_end.messages`，反向扫描最近 user/assistant 各一条
 * 3. 分别 publish inbound/outbound topic（`openclaw/bridge/{channelId}/inbound|outbound`）
 *
 * @param api - OpenClaw 插件 API（`on`、`publishInbound`、`logger`）。
 * @returns void
 * @throws 不抛出同步异常；publish 失败仅记录 error 日志。
 */
export function registerMessageBridge(api: OpenClawPluginApi): void {
  api.on("agent_end", (event, ctx) => {
    const channelId = ctx.channelId;
    // 非 Channel 会话或无 channel 上下文 → 不桥接
    if (!channelId) return;

    const cfg = getConfig(api);
    const channelCfg = cfg.channels?.[channelId];

    // 配置闸门：未声明该渠道或显式 disabled → 短路
    if (!channelCfg || channelCfg.enabled === false) return;
    // 细分开关：保留 enabled 但关闭 MQ 转发
    if (channelCfg.forwardToMq === false) return;

    // 注册表闸门：只对 Bridge 已知渠道桥接，避免污染未知 connector
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

    // MQ 渠道白名单校验：非法值 warn 并回退 mqtt，避免 publish 到未注册 transport
    const mqChannel = channelCfg.mqChannel ?? "mqtt";
    if (!VALID_MQ_CHANNELS.has(mqChannel)) {
      api.logger.warn(
        `[openclaw-bridge] Unknown mqChannel "${mqChannel}" for channel "${channelId}". ` +
        `Valid options: ${[...VALID_MQ_CHANNELS].join(", ")}. Falling back to "mqtt".`,
      );
    }
    const resolvedMqChannel = VALID_MQ_CHANNELS.has(mqChannel) ? mqChannel : "mqtt";
    const topicPrefix = `openclaw/bridge/${channelId}`;

    // 单次反转，缓存结果——避免双重反转；取时间上「最后一条」user/assistant
    const reversed = [...msgs].reverse();
    const userMsg = reversed.find((m) => m.role === "user");
    const agentReply = reversed.find((m) => m.role === "assistant");

    // senderId/chatType 来自运行时事件中的额外属性；
    // SDK 类型定义可能不包含这些字段，但运行时通常会填充它们。
    const userId = (e.senderId as string) ?? "unknown";
    const chatType = (e.chatType as "direct" | "group") ?? "direct";

    // ── 入站：最近一条 user 消息 ──
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
      // 但 SDK 类型定义可能未包含此方法；失败时 catch 打 error 不阻断 agent 生命周期
      (api as any).publishInbound?.({ channel: resolvedMqChannel, content: JSON.stringify(unified), topic: `${topicPrefix}/inbound` })
        .then(() => api.logger.debug?.(`[openclaw-bridge] → inbound: ${resolvedMqChannel}/${topicPrefix}/inbound`))
        .catch((err: unknown) => api.logger.error(`[openclaw-bridge] Forward inbound failed [${channelId}]: ${String(err)}`));
    }

    // ── 出站：最近一条 assistant 回复 ──
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
