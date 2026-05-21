/**
 * web-mqtt 集成测试端脚本。
 * 用于验证 WebSocket MQTT 链路、多 topic 订阅和消息往返。
 */

import mqtt from "mqtt";

/**
 * 读取测试配置。
 */
function loadConfig(): {
  brokerUrl: string;
  clientId: string;
  publishCases: Array<{ topic: string; payload: string }>;
  subscribeTopics: string[];
  timeoutMs: number;
} {
  const brokerUrl = process.env.MQTT_BROKER_URL ?? "ws://127.0.0.1:15675/ws";
  const clientId = process.env.MQTT_CLIENT_ID ?? `web-mqtt-test-${Date.now()}`;
  const timeoutMs = Number(process.env.MQTT_TEST_TIMEOUT_MS ?? 20_000);

  const publishCases = process.env.MQTT_TEST_PUBLISH_CASES
    ? (JSON.parse(process.env.MQTT_TEST_PUBLISH_CASES) as Array<{ topic: string; payload: string }>)
    : [
        {
          topic: process.env.MQTT_TEST_TOPIC_JSON ?? "openclaw/agent/support-bot/in",
          payload: JSON.stringify({ text: "hello from web mqtt json payload" }),
        },
        {
          topic: process.env.MQTT_TEST_TOPIC_PLAIN ?? "openclaw/agent/support-bot/in",
          payload: "hello from web mqtt plain text payload",
        },
      ];

  const subscribeTopics = process.env.MQTT_TEST_SUBSCRIBE_TOPICS
    ? process.env.MQTT_TEST_SUBSCRIBE_TOPICS.split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [process.env.MQTT_TEST_REPLY_TOPIC ?? "openclaw/agent/support-bot/out", "devices/reply"];

  return { brokerUrl, clientId, publishCases, subscribeTopics, timeoutMs };
}

/**
 * 执行集成测试。
 */
async function main(): Promise<void> {
  const cfg = loadConfig();
  const messages: Array<{ topic: string; payload: string }> = [];
  const client = mqtt.connect(cfg.brokerUrl, {
    clientId: cfg.clientId,
    reconnectPeriod: 0,
    connectTimeout: 5000,
  });

  await new Promise<void>((resolve, reject) => {
    client.once("connect", () => resolve());
    client.once("error", (error) => reject(error));
  });

  await new Promise<void>((resolve, reject) => {
    client.subscribe(cfg.subscribeTopics, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  client.on("message", (topic, payload) => {
    messages.push({ topic, payload: payload.toString("utf-8") });
  });

  for (const testCase of cfg.publishCases) {
    await new Promise<void>((resolve, reject) => {
      client.publish(testCase.topic, testCase.payload, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  await new Promise<void>((resolve) => setTimeout(resolve, cfg.timeoutMs));
  client.end(true);

  if (messages.length === 0) {
    throw new Error(`No reply received within ${cfg.timeoutMs}ms from ${cfg.brokerUrl}.`);
  }
  console.log(`[test-client] success: received ${messages.length} message(s).`);
}

main().catch((error) => {
  console.error("[test-client] failed:", error);
  process.exitCode = 1;
});
