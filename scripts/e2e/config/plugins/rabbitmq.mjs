/** @param {import('./mqtt.mjs').ConfigContext} _ctx */
export function rabbitmqConfig(_ctx) {
  return {
    pluginEntry: { rabbitmq: { enabled: true, config: { url: "amqp://127.0.0.1:5672" } } },
    channelEntry: {
      rabbitmq: {
        url: "amqp://127.0.0.1:5672",
        exchange: "openclaw-e2e",
        subscribeTopics: ["openclaw.#"],
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
