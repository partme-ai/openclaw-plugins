import { E2E_PORTS } from "../../lib/utils.mjs";

/** @param {import('./mqtt.mjs').ConfigContext} _ctx */
export function webStompConfig(_ctx) {
  return {
    pluginEntry: { "web-stomp": { enabled: true } },
    channelEntry: {
      stomp: {
        wsPort: E2E_PORTS.webStompWs,
        path: "/ws",
        auth: { required: false },
        subscribeTopics: ["/topic/#", "/queue/#"],
      },
    },
  };
}
