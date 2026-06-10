/** @typedef {{ e2eTopic: string; gotifySecrets?: Record<string, unknown>; gatewayPort: number }} ConfigContext */

/** @param {ConfigContext} ctx */
export function mqttConfig(ctx) {
  return {
    pluginEntry: { mqtt: { enabled: true } },
    channelEntry: {
      mqtt: {
        port: 11883,
        auth: { enabled: false, allowAnonymous: true },
        subscribeTopics: ["openclaw/#", "openclaw-e2e/#"],
        topicBindings: [
          {
            topicPattern: "openclaw/agent/main/in",
            agentId: "main",
            accountId: "default",
            replyTopic: "openclaw/agent/main/out",
          },
        ],
      },
    },
  };
}
