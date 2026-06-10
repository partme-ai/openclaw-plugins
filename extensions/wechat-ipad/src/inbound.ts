/**
 * WeChat iPad 入站消息处理。
 */

import type {
  WechatIpadConfig,
  WxMessagePayload,
  WxLoginPayload,
  WxFriendRequestPayload,
  IpadEventType,
} from "./types.js";
import { inboundToText } from "./dispatch/message-converter.js";
import {
  getOrCreateSession,
  clearAllSessions,
} from "./routing/session-mapper.js";
import {
  getWechatIpadRuntime,
  getResolvedWechatIpadConfig,
} from "./runtime.js";
import { on as onBridgeEvent } from "./transport/ipad-bridge.js";

/**
 * 注册 iPad 协议桥接事件监听器。
 * 将微信事件转换为 OpenClaw 消息管道调用。
 *
 * @param config - 插件配置
 * @returns void
 */
export function registerWechatIpadEventHandlers(config: WechatIpadConfig): void {
  onBridgeEvent<WxMessagePayload>("message" as IpadEventType, (msg) => {
    handleWxMessage(msg, config);
  });

  onBridgeEvent<WxLoginPayload>("login_status" as IpadEventType, (payload) => {
    if (payload.status === "logged_out" || payload.status === "token_expired") {
      clearAllSessions();
      console.log("[wechat-ipad] Sessions cleared due to logout/token expiry");
    }
  });

  onBridgeEvent<WxFriendRequestPayload>("friend_request" as IpadEventType, (req) => {
    console.log(
      `[wechat-ipad] Friend request from ${req.nickname} (${req.fromWxid}): ${req.verifyContent}`,
    );
  });
}

/**
 * 处理微信入站消息。
 * 应用过滤规则后交给 OpenClaw Runtime 消息管道。
 *
 * @param msg - 微信消息负载
 * @param config - 插件配置
 * @returns void
 */
export function handleWxMessage(
  msg: WxMessagePayload,
  config: WechatIpadConfig,
): void {
  if (config.message.ignoreself && msg.isSelf) return;

  if (msg.isGroup) {
    if (!config.message.handleGroup) return;

    const whitelist = config.message.groupWhitelist;
    if (whitelist.length > 0) {
      const groupWxid = msg.isGroup ? msg.toWxid : null;
      if (groupWxid && !whitelist.includes(groupWxid)) return;
    }
  }

  const text = inboundToText(msg);
  if (!text) return;

  const senderWxid = msg.isGroup
    ? msg.groupSenderWxid ?? msg.fromWxid
    : msg.fromWxid;

  const conversationWxid = msg.isGroup ? msg.toWxid : msg.fromWxid;

  console.log(
    `[wechat-ipad] Inbound: from=${senderWxid}, conv=${conversationWxid}, ` +
    `group=${msg.isGroup}, text=${text.slice(0, 80)}`,
  );

  dispatchToRuntime(conversationWxid, senderWxid, text, msg.isGroup).catch(
    (error) => {
      console.error(
        `[wechat-ipad] Runtime dispatch failed for ${conversationWxid}:`,
        error,
      );
    },
  );
}

/**
 * 通过 OpenClaw Runtime 4 步管道处理入站消息。
 *
 * @param conversationWxid - 会话 wxid（私聊为对方，群聊为群）
 * @param senderWxid - 发送者 wxid
 * @param text - 转换后的消息文本
 * @param isGroup - 是否群消息
 */
export async function dispatchToRuntime(
  conversationWxid: string,
  senderWxid: string,
  text: string,
  isGroup: boolean,
): Promise<void> {
  const _runtime = getWechatIpadRuntime();
  if (!_runtime) {
    console.warn("[wechat-ipad] Runtime not initialized, cannot dispatch");
    return;
  }

  const cfg = _runtime.config;

  const route = await _runtime.channel.routing.resolveAgentRoute({
    cfg,
    channel: "wechat-ipad",
    accountId: "default",
    peer: {
      kind: isGroup ? "group" : "dm",
      id: conversationWxid,
    },
  });

  const sessionKey = getOrCreateSession(
    conversationWxid,
    route.agentId,
    isGroup,
  );

  const ctx = await _runtime.channel.reply.finalizeInboundContext({
    channel: "wechat-ipad",
    accountId: "default",
    from: senderWxid,
    text,
    chatType: isGroup ? "group" : "direct",
    extra: {
      conversationWxid,
      senderWxid,
      isGroup,
    },
  });

  const dispatcher = _runtime.channel.reply.createReplyDispatcherWithTyping({
    deliver: async (payload) => {
      const { sendMessage } = await import("./transport/ipad-bridge.js");
      const { outboundFromText } = await import("./dispatch/message-converter.js");

      const request = outboundFromText(conversationWxid, payload.text);
      const result = await sendMessage(request);

      if (!result.ok) {
        console.error(
          `[wechat-ipad] Streaming reply failed for ${conversationWxid}: ${result.error}`,
        );
      }
    },
  });

  await _runtime.channel.reply.dispatchReplyFromConfig({
    ctx,
    cfg,
    dispatcher,
    replyOptions: route,
  });
}

/**
 * 读取当前生效的插件配置（供 HTTP 状态端点等使用）。
 *
 * @returns 已解析配置；未就绪时返回 null
 */
export function getActiveWechatIpadConfig(): WechatIpadConfig | null {
  return getResolvedWechatIpadConfig();
}
