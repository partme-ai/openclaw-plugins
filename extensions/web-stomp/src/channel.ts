/**
 * STOMP Channel 定义模块
 * 将 STOMP 注册为 OpenClaw 的 Channel
 *
 * Channel 定义了 OpenClaw 如何通过 STOMP 协议发送出站消息：
 * - outbound.sendText: Agent 回复时推送到对应的 session Topic
 */

import type { ChannelDefinition } from "./types.js";
import { publishToDestination } from "./stomp-server.js";
import { buildSessionDestination } from "./destination-router.js";

/**
 * STOMP Channel 定义
 * 注册到 OpenClaw 后，Agent 的回复将通过此 channel 发送
 */
export const stompChannel: ChannelDefinition = {
  id: "stomp",
  name: "STOMP over WebSocket Bridge",

  meta: {
    id: "stomp",
    label: "STOMP",
    selectionLabel: "STOMP over WebSocket Bridge",
    docsPath: "/channels/stomp",
    blurb: "STOMP over WebSocket for web and enterprise integration.",
    aliases: ["stomp", "web-stomp"],
    order: 91,
  },

  /** 渠道能力：协议桥接无原生命令，仅直连会话 */
  capabilities: {
    chatTypes: ["direct"],
  },

  config: {
    listAccountIds: () => ["default"],
    resolveAccount: () => ({}),
  },

  outbound: {
    /**
     * 发送文本消息给 STOMP 客户端
     * Agent 回复时由 OpenClaw 调用此方法
     *
     * @param sessionKey - OpenClaw 会话键（格式：stomp:<connectionId>@<agentId>）
     * @param text - Agent 回复的文本内容
     */
    sendText: async (sessionKey: string, text: string): Promise<void> => {
      // 构建会话 Topic Destination
      const destination = buildSessionDestination(sessionKey);

      // 向所有订阅该 session 的客户端推送
      publishToDestination(destination, text);

      console.log(
        `[openclaw_web_stomp] Reply published to ${destination}`
      );
    },
  },
};
