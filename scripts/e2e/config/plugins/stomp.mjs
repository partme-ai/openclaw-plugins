import { E2E_PORTS } from "../../lib/utils.mjs";

/** @param {import('./mqtt.mjs').ConfigContext} _ctx */
export function stompConfig(_ctx) {
  return {
    pluginEntry: { stomp: { enabled: true } },
    channelEntry: {
      "stomp-tcp": {
        port: E2E_PORTS.stompTcp,
        auth: { required: false },
        subscribeTopics: ["/topic/#", "/queue/#"],
        topicBindings: [
          {
            topicPattern: "/queue/agent.main.in",
            agentId: "main",
            replyTopic: "/topic/session.main.out",
          },
        ],
      },
    },
  };
}
