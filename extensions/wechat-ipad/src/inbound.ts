/**
 * @fileoverview 微信 iPad 桥接事件到 OpenClaw Agent 的入站适配管道。
 *
 * 处理顺序固定为：结构校验 → 自发消息过滤 → 短期去重 → 群聊授权 → 文本转换与大小限制
 * → Agent 路由 → Reply Dispatcher。任何外部事件都不能绕过这些边界直接进入 Agent。
 */
import { inboundToText } from "./dispatch/message-converter.js";
import { WechatIpadInboundQueue } from "./dispatch/inbound-queue.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { getWechatIpadRuntime } from "./runtime.js";
import { WechatIpadProcessedMessageStore } from "./storage/processed-messages.js";
import { WechatIpadBridge } from "./transport/ipad-bridge.js";
import {
  IpadEventType,
  type PluginLogger,
  type WechatIpadConfig,
  type WxLoginPayload,
  type WxMessagePayload,
} from "./types.js";

const RECENT_TTL_MS = 10 * 60_000;
const RECENT_MAX = 10_000;
/**
 * 进程内短期消息去重表。它防止桥接服务重连重放造成重复回复，但不承担跨进程持久化语义。
 */
const recentMessages = new Map<string, number>();
/** 当前仍在 Agent 管道中的消息，防止同一 ID 在首次处理完成前并发进入两次。 */
const inFlightMessages = new Set<string>();
/** Gateway 服务启动时注入的持久去重存储；纯单元测试可保持为空并使用内存语义。 */
let processedMessageStore: WechatIpadProcessedMessageStore | null = null;

/** 判断消息是否已成功处理；内存热缓存与重启恢复日志任一命中即视为重复。 */
function wasProcessed(messageId: string): boolean {
  const now = Date.now();
  const seenAt = recentMessages.get(messageId);
  if (seenAt && now - seenAt < RECENT_TTL_MS) return true;
  if (seenAt) recentMessages.delete(messageId);
  return processedMessageStore?.has(messageId, now) ?? false;
}

/** 成功完成 Agent 调度与回复投递后才提交去重记录，失败消息仍可由桥接服务重试。 */
function commitProcessed(messageId: string, logger?: PluginLogger): void {
  const now = Date.now();
  recentMessages.set(messageId, now);
  if (recentMessages.size > RECENT_MAX) {
    for (const [key, timestamp] of recentMessages) {
      if (now - timestamp >= RECENT_TTL_MS || recentMessages.size > RECENT_MAX) {
        recentMessages.delete(key);
      }
      if (recentMessages.size <= RECENT_MAX) break;
    }
  }
  try {
    processedMessageStore?.mark(messageId, now);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.error(`[wechat-ipad] failed to persist processed message id: ${message}`);
  }
}

/** 为当前 Gateway 生命周期配置持久去重文件。 */
export function configureWechatIpadProcessedMessageStore(filePath: string): void {
  processedMessageStore = new WechatIpadProcessedMessageStore(filePath);
}

/** 校验入站路由所需的最小消息字段，载荷仍按不可信输入处理。 */
function isValidMessage(message: WxMessagePayload): boolean {
  return Boolean(
    message &&
      typeof message.msgId === "string" &&
      message.msgId.trim() &&
      typeof message.fromWxid === "string" &&
      message.fromWxid.trim() &&
      typeof message.toWxid === "string" &&
      message.toWxid.trim() &&
      typeof message.isGroup === "boolean" &&
      typeof message.isSelf === "boolean",
  );
}

/**
 * 将桥接事件处理器绑定到当前连接，并返回一个统一的生命周期清理函数。
 */
export function registerWechatIpadEventHandlers(
  bridge: WechatIpadBridge,
  config: WechatIpadConfig,
  logger: PluginLogger,
): () => void {
  const queue = new WechatIpadInboundQueue(config.message.maxPendingMessages, (error) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[wechat-ipad] inbound Agent task failed: ${message}`);
  });
  const disposers = [
    bridge.on<WxMessagePayload>(IpadEventType.Message, (message) => {
      const accepted = queue.enqueue(() => handleWxMessage(message, config, logger));
      if (!accepted) {
        logger.warn("[wechat-ipad] inbound queue is full or closed; event was dropped");
      }
    }),
    bridge.on<WxLoginPayload>(IpadEventType.LoginStatus, (payload) => {
      logger.info(`[wechat-ipad] login status changed: ${payload.status}`);
    }),
    bridge.on(IpadEventType.FriendRequest, () => {
      logger.debug?.("[wechat-ipad] friend request event received");
    }),
  ];
  return () => {
    queue.close();
    for (const dispose of disposers) dispose();
  };
}

/** 精确匹配 wxid 白名单；`*` 只能由运维人员显式配置，表示接受所有发送者。 */
function matchesAllowlist(entries: readonly string[], sender: string): boolean {
  return entries.includes("*") || entries.includes(sender);
}

/**
 * 校验、授权、去重并分发一条外部桥接消息。
 * 群聊只有在显式启用且命中白名单（或再次明确允许全部群）时才会进入 Agent。
 */
export async function handleWxMessage(
  message: WxMessagePayload,
  config: WechatIpadConfig,
  logger?: PluginLogger,
): Promise<void> {
  if (!config.enabled) return;
  if (!isValidMessage(message)) {
    logger?.warn("[wechat-ipad] rejected invalid message payload");
    return;
  }
  if (config.message.ignoreSelf && message.isSelf) return;
  const messageId = message.msgId.trim();
  if (wasProcessed(messageId) || inFlightMessages.has(messageId)) return;

  if (message.isGroup) {
    if (!config.message.handleGroup) return;
    if (!config.message.allowAllGroups && !config.message.groupWhitelist.includes(message.toWxid)) {
      return;
    }
  } else {
    if (config.message.dmPolicy === "disabled") return;
    if (config.message.dmPolicy === "allowlist" &&
        !matchesAllowlist(config.message.allowFrom, message.fromWxid.trim())) {
      return;
    }
  }

  const text = inboundToText(message)?.trim();
  if (!text) return;
  if (text.length > config.message.maxTextChars) {
    logger?.warn("[wechat-ipad] rejected oversized inbound text");
    return;
  }
  const sender = (message.isGroup ? message.groupSenderWxid ?? message.fromWxid : message.fromWxid).trim();
  const conversation = (message.isGroup ? message.toWxid : message.fromWxid).trim();
  const commandAuthorized = matchesAllowlist(config.message.commandAllowFrom, sender);
  inFlightMessages.add(messageId);
  try {
    await dispatchToRuntime({
      conversation,
      sender,
      text,
      isGroup: message.isGroup,
      messageId,
      timestamp: Number.isFinite(message.createTime) ? message.createTime * 1000 : Date.now(),
      commandAuthorized,
    });
    commitProcessed(messageId, logger);
  } finally {
    inFlightMessages.delete(messageId);
  }
}

/**
 * 将已通过安全边界的消息构造成 OpenClaw 2026.7.1 入站上下文并触发 Agent 回复。
 * Reply Dispatcher 的 `deliver` 回调会复用活动桥接器，将 Agent 文本响应发回原会话。
 */
export async function dispatchToRuntime(params: {
  conversation: string;
  sender: string;
  text: string;
  isGroup: boolean;
  messageId?: string;
  timestamp?: number;
  commandAuthorized?: boolean;
}): Promise<void> {
  const runtime = getWechatIpadRuntime();
  if (!runtime) throw new Error("wechat-ipad runtime is not initialized");
  const cfg = runtime.config.current() as unknown as OpenClawConfig;
  const route = await runtime.channel.routing.resolveAgentRoute({
    cfg,
    channel: "wechat-ipad",
    accountId: "default",
    peer: { kind: params.isGroup ? "group" : "direct", id: params.conversation },
  });
  const agentId = route.agentId || "main";
  const sessionKey = route.sessionKey ||
    `agent:${agentId}:wechat-ipad:default:${params.isGroup ? "group" : "direct"}:${params.conversation}`;
  const address = `wechat-ipad:${params.conversation}`;
  const inboundContext = await runtime.channel.reply.finalizeInboundContext({
    Body: params.text,
    BodyForAgent: params.text,
    RawBody: params.text,
    CommandBody: params.text,
    From: `wechat-ipad:${params.sender}`,
    To: address,
    SessionKey: sessionKey,
    AccountId: "default",
    ChatType: params.isGroup ? "group" : "direct",
    SenderId: params.sender,
    Provider: "wechat-ipad",
    Surface: "wechat-ipad",
    OriginatingChannel: "wechat-ipad",
    OriginatingTo: address,
    MessageSid: params.messageId,
    Timestamp: params.timestamp ?? Date.now(),
    // 普通对话准入与命令授权必须分离；未知发送者即便能对话，也不能执行管理命令。
    CommandAuthorized: params.commandAuthorized === true,
  });
  const { dispatcher, replyOptions, markDispatchIdle } =
    runtime.channel.reply.createReplyDispatcherWithTyping({
    deliver: async (payload) => {
      const { sendMessage } = await import("./transport/ipad-bridge.js");
      const result = await sendMessage({
        toWxid: params.conversation,
        msgType: "text",
        content: payload.text,
      });
      if (!result.ok) throw new Error(result.error ?? "wechat-ipad reply delivery failed");
    },
    });
  await runtime.channel.reply.withReplyDispatcher({
    dispatcher,
    onSettled: () => markDispatchIdle(),
    run: () => runtime.channel.reply.dispatchReplyFromConfig({
      ctx: inboundContext,
      cfg,
      dispatcher,
      replyOptions,
    }),
  });
}

/** Gateway 停止或插件重载时清空进程内去重状态。 */
export function clearRecentWechatIpadMessages(): void {
  recentMessages.clear();
  inFlightMessages.clear();
  processedMessageStore = null;
}
