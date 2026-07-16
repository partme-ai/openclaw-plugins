/** @param {import('./mqtt.mjs').ConfigContext} _ctx */
export function rabbitmqConfig(_ctx) {
  return {
    pluginEntry: { rabbitmq: { enabled: true, config: { url: "amqp://127.0.0.1:5672" } } },
    channelEntry: {
      rabbitmq: {
        url: "amqp://127.0.0.1:5672",
        exchange: "openclaw-e2e",
        // Do not bind the consumer queue to outbound replies; otherwise the
        // plugin consumes its own `.out` messages as unmatched inbound work.
        subscribeTopics: ["openclaw.agent.*.in"],
        topicBindings: [
          {
            topicPattern: "openclaw.agent.main.in",
            agentId: "main",
            accountId: "default",
          },
        ],
        dispatch: { mode: "reply-pipeline", timeoutMs: 15000, reply: { enabled: true } },
      },
    },
  };
}
