import { E2E_PORTS } from "../../lib/utils.mjs";

/** @param {import('./mqtt.mjs').ConfigContext} _ctx */
export function webStompConfig(_ctx) {
  const testWebPort = Number(process.env.E2E_TEST_WEB_PORT ?? 8765);
  return {
    pluginEntry: { "web-stomp": { enabled: true } },
    channelEntry: {
      stomp: {
        wsPort: E2E_PORTS.webStompWs,
        path: "/ws",
        // 覆盖生产推荐路径：浏览器 Origin 与 STOMP login/passcode 必须同时通过。
        auth: {
          required: true,
          users: [{ login: "web-stomp-e2e", password: "web-stomp-e2e-secret" }],
        },
        ws: { allowedOrigins: [`http://127.0.0.1:${testWebPort}`] },
        subscribeTopics: ["/topic/#", "/queue/#"],
      },
    },
  };
}
