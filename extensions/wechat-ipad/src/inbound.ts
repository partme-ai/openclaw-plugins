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
const recentMessages = new Map<string, number>();

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

/** Attach bridge handlers and return one lifecycle disposer. */
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

/** Validate, authorize, deduplicate, and dispatch one inbound bridge message. */
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

export function clearRecentWechatIpadMessages(): void {
  recentMessages.clear();
}
