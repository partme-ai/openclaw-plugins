/** @param {{ e2eTopic: string }} ctx */
export function rocketmqConfig(ctx) {
  return {
    pluginEntry: { rocketmq: { enabled: true } },
    channelEntry: {
      rocketmq: {
        endpoints: "127.0.0.1:8081",
        namespace: "",
        topicPrefix: "openclaw",
        producer: { groupId: "openclaw-e2e-producer" },
        consumer: {
          groupId: `openclaw-e2e-consumer-${Date.now()}`,
          subscriptions: [{ topic: ctx.e2eTopic, filterExpression: "*" }],
        },
        topicBindings: [{ topic: ctx.e2eTopic, tag: "*", agentId: "main", accountId: "default" }],
        dispatch: { mode: "reply-pipeline", timeoutMs: 15000, reply: { enabled: true } },
      },
    },
  };
}
