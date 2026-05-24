import { E2E_PORTS } from "../../lib/utils.mjs";

/** @param {import('./mqtt.mjs').ConfigContext} _ctx */
export function webMqttConfig(_ctx) {
  return {
    pluginEntry: { "web-mqtt": { enabled: true } },
    channelEntry: {
      "mqtt-ws": {
        port: E2E_PORTS.webMqttWs,
        path: "/ws",
        auth: { required: false, allowAnonymous: true },
        topicPrefix: "openclaw",
        subscribeTopics: ["openclaw/#"],
      },
    },
  };
}
