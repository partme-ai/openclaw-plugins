/**
 * STOMP TCP Channel 定义。
 */

import { publishToDestination } from "./stomp-server.js";
import { stompTcpSetupAdapter, stompTcpSetupWizard } from "./onboarding.js";

/**
 * 由会话键构造默认回复 topic。
 */
function buildSessionDestination(sessionKey: string): string {
  return `/topic/session.${sessionKey}`;
}

/**
 * STOMP channel plugin（单账号 default）。
 */
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
    sendText: async (sessionKey: string, text: string): Promise<void> => {
      const destination = buildSessionDestination(sessionKey);
      publishToDestination(destination, text);
    },
  },
};
