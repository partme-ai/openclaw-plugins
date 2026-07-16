/**
 * @fileoverview 微信 iPad 桥接事件到 OpenClaw Agent 的入站适配管道。
 *
 * 处理顺序固定为：结构校验 → 自发消息过滤 → 短期去重 → 群聊授权 → 文本转换与大小限制
 * → Agent 路由 → Reply Dispatcher。任何外部事件都不能绕过这些边界直接进入 Agent。
 */
import { inboundToText } from "./dispatch/message-converter.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { getWechatIpadRuntime } from "./runtime.js";
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

/** 记录消息 ID；返回 `false` 表示 TTL 内已经处理过。 */
function rememberMessage(messageId: string): boolean {
  const now = Date.now();
  const seenAt = recentMessages.get(messageId);
  if (seenAt && now - seenAt < RECENT_TTL_MS) return false;
  recentMessages.set(messageId, now);
  if (recentMessages.size > RECENT_MAX) {
    for (const [key, timestamp] of recentMessages) {
      if (now - timestamp >= RECENT_TTL_MS || recentMessages.size > RECENT_MAX) {
        recentMessages.delete(key);
      }
      if (recentMessages.size <= RECENT_MAX) break;
    }
  }
  return true;
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
  const disposers = [
    bridge.on<WxMessagePayload>(IpadEventType.Message, async (message) => {
      await handleWxMessage(message, config, logger);
    }),
    bridge.on<WxLoginPayload>(IpadEventType.LoginStatus, (payload) => {
      logger.info(`[wechat-ipad] login status changed: ${payload.status}`);
    }),
    bridge.on(IpadEventType.FriendRequest, () => {
      logger.debug?.("[wechat-ipad] friend request event received");
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
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
  if (!isValidMessage(message)) {
    logger?.warn("[wechat-ipad] rejected invalid message payload");
    return;
  }
  if (config.message.ignoreSelf && message.isSelf) return;
  if (!rememberMessage(message.msgId)) return;

  if (message.isGroup) {
    if (!config.message.handleGroup) return;
    if (!config.message.allowAllGroups && !config.message.groupWhitelist.includes(message.toWxid)) {
      return;
    }
  }

  const text = inboundToText(message)?.trim();
  if (!text) return;
  if (text.length > config.message.maxTextChars) {
    logger?.warn("[wechat-ipad] rejected oversized inbound text");
    return;
  }
  const sender = message.isGroup ? message.groupSenderWxid ?? message.fromWxid : message.fromWxid;
  const conversation = message.isGroup ? message.toWxid : message.fromWxid;
  await dispatchToRuntime({
    conversation,
    sender,
    text,
    isGroup: message.isGroup,
    messageId: message.msgId,
    timestamp: Number.isFinite(message.createTime) ? message.createTime * 1000 : Date.now(),
  });
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
    CommandAuthorized: true,
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
}
