import { E2E_PORTS } from "../../lib/utils.mjs";

/** @param {import('./mqtt.mjs').ConfigContext} _ctx */
export function webMqttConfig(_ctx) {
  const testWebPort = Number(process.env.E2E_TEST_WEB_PORT ?? 8765);
  return {
    pluginEntry: { "web-mqtt": { enabled: true } },
    channelEntry: {
      "mqtt-ws": {
        port: E2E_PORTS.webMqttWs,
        path: "/ws",
        // E2E 必须覆盖生产推荐路径：浏览器 Origin 校验、账号认证和双向 Topic ACL 同时生效。
        auth: {
          required: true,
          allowAnonymous: false,
          users: [{
            username: "web-mqtt-e2e",
            password: "web-mqtt-e2e-secret",
            publishAllow: ["openclaw/agent/+/in"],
            subscribeAllow: ["openclaw/agent/+/out"],
          }],
        },
        ws: { allowedOrigins: [`http://127.0.0.1:${testWebPort}`] },
        topicPrefix: "openclaw",
        subscribeTopics: ["openclaw/#"],
      },
    },
  };
}
