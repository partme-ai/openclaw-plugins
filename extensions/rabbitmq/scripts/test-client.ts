/**
 * RabbitMQ 集成测试端脚本
 *
 * 用途：
 * 1. 连接本地/指定 RabbitMQ 服务器；
 * 2. 订阅多个回复 Topic；
 * 3. 发布 JSON.text 与纯文本两类消息；
 * 4. 验证是否能收到 Agent 回复。
 */

import amqp from "amqplib";

/**
 * 读取环境变量并构造测试配置。
 */
function loadConfig(): {
  url: string;
  exchange: string;
  exchangeType: string;
  topicPrefix: string;
  publishCases: Array<{ routingKey: string; payload: string }>;
  subscribeTopics: string[];
  timeoutMs: number;
} {
  const url = process.env.RABBITMQ_URL ?? "amqp://localhost";
  const exchange = process.env.RABBITMQ_EXCHANGE ?? "openclaw";
  const exchangeType = process.env.RABBITMQ_EXCHANGE_TYPE ?? "topic";
  const topicPrefix = process.env.RABBITMQ_TOPIC_PREFIX ?? "openclaw";
  const timeoutMs = Number(process.env.RABBITMQ_TEST_TIMEOUT_MS ?? 20_000);

  const defaultAgentId = process.env.RABBITMQ_AGENT_ID ?? "support-bot";
  const defaultPeerId = process.env.RABBITMQ_PEER_ID ?? "test-peer";

  let publishCases: Array<{ routingKey: string; payload: string }> = [
    {
      routingKey: `${topicPrefix}.agent.${defaultAgentId}.in.${defaultPeerId}`,
      payload: JSON.stringify({ text: "hello from json.text test" }),
    },
    {
      routingKey: `${topicPrefix}.agent.${defaultAgentId}.in.${defaultPeerId}`,
      payload: "hello from plain text test",
    },
  ];

  if (process.env.RABBITMQ_TEST_PUBLISH_CASES) {
    try {
      const parsed = JSON.parse(process.env.RABBITMQ_TEST_PUBLISH_CASES) as Array<{
        routingKey: string;
        payload: string;
      }>;
      if (Array.isArray(parsed) && parsed.length > 0) {
        publishCases = parsed;
      }
    } catch {
      console.warn("[test-client] RABBITMQ_TEST_PUBLISH_CASES is not valid JSON; using defaults");
    }
  }

  const subscribeTopics = process.env.RABBITMQ_TEST_SUBSCRIBE_TOPICS
    ? process.env.RABBITMQ_TEST_SUBSCRIBE_TOPICS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [
        `${topicPrefix}.agent.${defaultAgentId}.out.${defaultPeerId}`,
        `${topicPrefix}.#`,
      ];

  return {
    url,
    exchange,
    exchangeType,
    topicPrefix,
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
  const receivedMessages: Array<{ routingKey: string; payload: string }> = [];

  console.log(`[test-client] connecting to ${cfg.url}...`);
  const connection = await amqp.connect(cfg.url);
  const channel = await connection.createChannel();

  // 声明交换机
  await channel.assertExchange(cfg.exchange, cfg.exchangeType as any, {
    durable: true,
  });
  console.log(`[test-client] exchange declared: ${cfg.exchange} (type: ${cfg.exchangeType})`);

  // 声明临时队列用于接收回复
  const queue = await channel.assertQueue("", {
    exclusive: true,
  });
  console.log(`[test-client] queue declared: ${queue.queue}`);

  // 绑定队列到交换机，订阅所有配置的 Topic
  for (const topic of cfg.subscribeTopics) {
    await channel.bindQueue(queue.queue, cfg.exchange, topic);
    console.log(`[test-client] bound queue to topic: ${topic}`);
  }

  // 消费消息
  channel.consume(
    queue.queue,
    (msg) => {
      if (msg) {
        const routingKey = msg.fields.routingKey;
        const payload = msg.content.toString("utf-8");
        receivedMessages.push({ routingKey, payload });
        console.log(
          `[test-client] message received routingKey=${routingKey} payload=${payload.slice(0, 120)}`,
        );
        channel.ack(msg);
      }
    },
    { noAck: false },
  );

  // 发布测试消息
  for (const testCase of cfg.publishCases) {
    await channel.publish(cfg.exchange, testCase.routingKey, Buffer.from(testCase.payload));
    console.log(
      `[test-client] published routingKey=${testCase.routingKey} payload=${testCase.payload}`,
    );
  }

  // 等待回复
  console.log(`[test-client] waiting for replies for ${cfg.timeoutMs}ms...`);
  await new Promise<void>((resolve) => setTimeout(resolve, cfg.timeoutMs));

  // 清理
  await channel.close();
  await connection.close();

  if (receivedMessages.length === 0) {
    throw new Error(
      `[test-client] timeout: no reply received in ${cfg.timeoutMs}ms. Check topicBindings/agent route and gateway runtime.`,
    );
  }

  console.log(`[test-client] success: received ${receivedMessages.length} replies`);
}

main()
  .catch((error) => {
    console.error("[test-client] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit();
  });