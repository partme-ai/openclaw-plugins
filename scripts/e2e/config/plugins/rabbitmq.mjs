/** @param {import('./mqtt.mjs').ConfigContext} _ctx */
export function rabbitmqConfig(_ctx) {
  const subagentCase = process.env.OPENCLAW_E2E_RABBITMQ_SUBAGENT;
  const subagent = subagentCase === "visible" || subagentCase === "timeout";
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
        dispatch: { mode: subagent ? "subagent" : "reply-pipeline", timeoutMs: subagentCase === "timeout" ? 1 : 15000, reply: { enabled: true } },
      },
    },
  };
}
