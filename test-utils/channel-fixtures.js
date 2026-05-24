/**
 * Reusable channel config fragments for unit tests (no Docker).
 */

/** @returns {Record<string, unknown>} */
export function emptyChannelsFixture() {
  return { channels: {} };
}

/** @returns {Record<string, unknown>} */
export function mqttChannelFixture() {
  return {
    channels: {
      mqtt: {
        port: 11883,
        subscribeTopics: ["devices/+/in"],
        topicBindings: [
          { topicPattern: "devices/+/in", agentId: "test-agent", accountId: "default" },
        ],
        auth: { enabled: false, allowAnonymous: true },
      },
    },
  };
}

/** @returns {Record<string, unknown>} */
export function stompTcpChannelFixture() {
  return {
    channels: {
      "stomp-tcp": {
        port: 61673,
        auth: { required: false },
        topicBindings: [
          {
            topicPattern: "devices/*/in",
            agentId: "iot-agent",
            accountId: "default",
            replyTopic: "/topic/devices/reply",
          },
        ],
      },
    },
  };
}

/** @returns {Record<string, unknown>} */
export function gotifyChannelFixture() {
  return {
    channels: {
      gotify: {
        serverUrl: "http://127.0.0.1:18080",
        appToken: "test-app-token",
        clientToken: "test-client-token",
        inbound: { deleteAfterConsume: false },
      },
    },
  };
}
