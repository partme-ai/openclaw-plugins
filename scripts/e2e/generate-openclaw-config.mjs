/**
 * Generate ~/.openclaw-queue-e2e/openclaw.json for installed-plugin E2E.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { E2E_DIR, STATE_DIR, GATEWAY_PORT } from "./lib/utils.mjs";

const secretsPath = `${E2E_DIR}/.e2e-secrets.json`;
const gotify = JSON.parse(readFileSync(secretsPath, "utf8"));

const e2eTopic = `openclaw-e2e-${Date.now()}`;

const config = {
  gateway: {
    mode: "local",
    port: GATEWAY_PORT,
    bind: "loopback",
    auth: { mode: "none" },
  },
  session: { dmScope: "main" },
  plugins: {
    entries: {
      mqtt: { enabled: true },
      rabbitmq: { enabled: true, config: { url: "amqp://127.0.0.1:5672" } },
      rocketmq: { enabled: true },
      gotify: { enabled: true },
      stomp: { enabled: true },
      "web-mqtt": { enabled: true },
      "web-stomp": { enabled: true },
    },
  },
  channels: {
    mqtt: {
      port: 11883,
      auth: { enabled: false, allowAnonymous: true },
      subscribeTopics: ["openclaw/#", "openclaw-e2e/#"],
      topicBindings: [
        {
          topicPattern: "openclaw/agent/main/in",
          agentId: "main",
          accountId: "default",
          replyTopic: "openclaw/agent/main/out",
        },
      ],
    },
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
    rocketmq: {
      endpoints: "127.0.0.1:8081",
      namespace: "",
      topicPrefix: "openclaw",
      producer: { groupId: "openclaw-e2e-producer" },
      consumer: {
        groupId: `openclaw-e2e-consumer-${Date.now()}`,
        subscriptions: [{ topic: e2eTopic, filterExpression: "*" }],
      },
      topicBindings: [{ topic: e2eTopic, tag: "*", agentId: "main", accountId: "default" }],
      dispatch: { mode: "reply-pipeline", timeoutMs: 15000, reply: { enabled: true } },
    },
    gotify: {
      defaultAccount: "e2e",
      accounts: {
        e2e: {
          name: "e2e",
          enabled: true,
          serverUrl: gotify.serverUrl,
          appToken: gotify.appToken,
          clientToken: gotify.clientToken,
          dmPolicy: "open",
          allowFrom: ["*"],
          inbound: {
            enabled: true,
            allowedAppId: gotify.allowedAppId,
            deleteAfterConsume: false,
          },
        },
      },
    },
    "stomp-tcp": {
      port: 21613,
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
    "mqtt-ws": {
      port: 25675,
      path: "/ws",
      auth: { required: false, allowAnonymous: true },
      topicPrefix: "openclaw",
      subscribeTopics: ["openclaw/#"],
    },
    stomp: {
      wsPort: 25674,
      path: "/ws",
      auth: { required: false },
      subscribeTopics: ["/topic/#", "/queue/#"],
    },
  },
};

mkdirSync(STATE_DIR, { recursive: true });
mkdirSync(`${STATE_DIR}/workspace-main`, { recursive: true });
writeFileSync(`${STATE_DIR}/openclaw.json`, JSON.stringify(config, null, 2));
writeFileSync(`${E2E_DIR}/.e2e-config-meta.json`, JSON.stringify({ rocketmqTopic: e2eTopic }, null, 2));
console.log("[config] wrote %s (gateway:%s, rocketmq topic:%s)", `${STATE_DIR}/openclaw.json`, GATEWAY_PORT, e2eTopic);
