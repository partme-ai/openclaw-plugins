/**
 * MQTT 集成测试端脚本
 *
 * 用途：
 * 1. 连接本地/指定 MQTT Broker；
 * 2. 订阅多个回复 Topic；
 * 3. 发布 JSON.text 与纯文本两类消息；
 * 4. 验证是否能收到 Agent 回复。
 */

import mqtt from "mqtt";

/**
 * 读取环境变量并构造测试配置。
 */
function loadConfig(): {
  brokerUrl: string;
  clientId: string;
  publishCases: Array<{ topic: string; payload: string }>;
  subscribeTopics: string[];
  timeoutMs: number;
} {
  const brokerUrl = process.env.MQTT_BROKER_URL ?? "mqtt://127.0.0.1:1883";
  const clientId = process.env.MQTT_CLIENT_ID ?? `mqtt-test-client-${Date.now()}`;
  const timeoutMs = Number(process.env.MQTT_TEST_TIMEOUT_MS ?? 20_000);

  let publishCases: Array<{ topic: string; payload: string }> = [
    {
      topic: process.env.MQTT_TEST_TOPIC_JSON ?? "openclaw/agent/support-bot/in",
      payload: JSON.stringify({ text: "hello from json.text test" }),
    },
    {
      topic: process.env.MQTT_TEST_TOPIC_PLAIN ?? "openclaw/agent/support-bot/in",
      payload: "hello from plain text test",
    },
  ];
  if (process.env.MQTT_TEST_PUBLISH_CASES) {
    try {
      const parsed = JSON.parse(process.env.MQTT_TEST_PUBLISH_CASES) as Array<{ topic: string; payload: string }>;
      if (Array.isArray(parsed) && parsed.length > 0) {
        publishCases = parsed;
      }
    } catch {
      console.warn("[test-client] MQTT_TEST_PUBLISH_CASES is not valid JSON; using defaults");
    }
  }

  const subscribeTopics = process.env.MQTT_TEST_SUBSCRIBE_TOPICS
    ? process.env.MQTT_TEST_SUBSCRIBE_TOPICS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [
        process.env.MQTT_TEST_REPLY_TOPIC ?? "openclaw/agent/support-bot/out",
        process.env.MQTT_TEST_REPLY_TOPIC_2 ?? "devices/reply",
      ];

  return {
    brokerUrl,
    clientId,
    publishCases,
    subscribeTopics,
    timeoutMs,
  };
}

/**
 * 启动集成测试流程。
 */
async function main(): Promise<void> {
  const cfg = loadConfig();
  const receivedMessages: Array<{ topic: string; payload: string }> = [];

  const client = mqtt.connect(cfg.brokerUrl, { clientId: cfg.clientId });

  await new Promise<void>((resolve, reject) => {
    client.once("connect", () => {
      console.log(`[test-client] connected: ${cfg.clientId} -> ${cfg.brokerUrl}`);
      resolve();
    });
    client.once("error", (err) => reject(err));
  });

  await new Promise<void>((resolve, reject) => {
    client.subscribe(cfg.subscribeTopics, (err) => {
      if (err) {
        reject(err);
        return;
      }
      console.log(`[test-client] subscribed: ${cfg.subscribeTopics.join(", ")}`);
      resolve();
    });
  });

  client.on("message", (topic, payload) => {
    const text = payload.toString("utf-8");
    receivedMessages.push({ topic, payload: text });
    console.log(`[test-client] message received topic=${topic} payload=${text.slice(0, 120)}`);
  });

  for (const testCase of cfg.publishCases) {
    await new Promise<void>((resolve, reject) => {
      client.publish(testCase.topic, testCase.payload, { qos: 0 }, (err) => {
        if (err) {
          reject(err);
          return;
        }
        console.log(`[test-client] published topic=${testCase.topic} payload=${testCase.payload}`);
        resolve();
      });
    });
  }

  await new Promise<void>((resolve) => setTimeout(resolve, cfg.timeoutMs));

  client.end(true);

  if (receivedMessages.length === 0) {
    throw new Error(
      `[test-client] timeout: no reply received in ${cfg.timeoutMs}ms. Check topicBindings/agent route and gateway runtime.`,
    );
  }

  console.log(`[test-client] success: received ${receivedMessages.length} replies`);
}

main().catch((error) => {
  console.error("[test-client] failed:", error);
  process.exitCode = 1;
});
