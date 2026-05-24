/**
 * @fileoverview STOMP TCP Channel 定义：Topic 绑定、单账号 default 与 outbound publish。
 *
 * @description
 * 实现 OpenClaw ChannelPlugin：`sendText` 向 `/topic/session.<sessionKey>` 发布 STOMP MESSAGE。
 *
 * @module channel
 */

/**
 * STOMP Channel — Base Profile 入口。
 */

import { publishToDestination } from "./transport/server.js";
import { stompTcpSetupAdapter, stompTcpSetupWizard } from "./onboarding.js";

/**
 * @description 由 OpenClaw sessionKey 构造默认 STOMP 回复 destination。
 * @param sessionKey - 会话键。
 * @returns STOMP destination 路径。
 * @throws 不抛出。
 */
function buildSessionDestination(sessionKey: string): string {
  return `/topic/session.${sessionKey}`;
}

/** @description STOMP ChannelPlugin（渠道 id：`stomp-tcp`）。 */
export const stompTcpChannel = {
  id: "stomp-tcp",
  meta: {
    id: "stomp-tcp",
    label: "STOMP TCP",
    selectionLabel: "STOMP over TCP (Native)",
    docsPath: "/channels/stomp-tcp",
    docsLabel: "stomp-tcp",
    blurb: "Native TCP STOMP protocol bridge with topic binding and enterprise delivery controls.",
    aliases: ["stomp-tcp", "stomp"],
    order: 92,
  },
  capabilities: {
    chatTypes: ["direct"],
    media: false,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.stomp-tcp"] },
  setupWizard: stompTcpSetupWizard,
  setup: stompTcpSetupAdapter,
  config: {
    listAccountIds: () => ["default"],
    defaultAccountId: () => "default",
    resolveAccount: () => ({
      accountId: "default",
      name: "default",
      enabled: true,
      configured: true,
    }),
    isConfigured: () => true,
  },
  outbound: {
    deliveryMode: "direct",
    /**
     * @description Channel 出站：向 session destination 发布文本。
     * @param sessionKey - OpenClaw 会话键（作为 `to`）。
     * @param text - 回复正文。
     * @returns Promise，无返回值。
     */
    sendText: async (sessionKey: string, text: string): Promise<void> => {
      const destination = buildSessionDestination(sessionKey);
      publishToDestination(destination, text);
    },
  },
};
