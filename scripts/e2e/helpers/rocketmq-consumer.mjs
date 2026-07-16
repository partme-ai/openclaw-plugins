/**
 * Short-lived RocketMQ reply consumer used by the E2E adapter.
 *
 * The SDK keeps telemetry/logger activity alive after shutdown on Node 24, so
 * this helper emits a base64 reply marker and exits as a separate process.
 */
import { createRequire } from "node:module";

const req = createRequire(new URL("../../../extensions/rocketmq/package.json", import.meta.url));
const { ConsumeResult, PushConsumer } = req("rocketmq-client-nodejs");

const [endpoints, topic] = process.argv.slice(2);
if (!endpoints || !topic) {
  console.error("usage: rocketmq-consumer.mjs <endpoints> <topic>");
  process.exit(2);
}

try {
  const consumer = new PushConsumer({
    endpoints,
    namespace: "",
    consumerGroup: `openclaw-e2e-reply-${process.pid}-${Date.now()}`,
    subscriptions: new Map([[topic, "*"]]),
    requestTimeout: 10_000,
    messageListener: {
      async consume(messageView) {
        const raw = Buffer.isBuffer(messageView.body)
          ? messageView.body.toString("utf8")
          : Buffer.from(messageView.body).toString("utf8");
        process.stdout.write(`ROCKETMQ_E2E_REPLY=${Buffer.from(raw).toString("base64")}\n`);
        setTimeout(() => process.exit(0), 25).unref?.();
        return ConsumeResult.SUCCESS;
      },
    },
  });
  let startupError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      await consumer.startup();
      startupError = undefined;
      break;
    } catch (error) {
      startupError = error;
      if (attempt < 6) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }
  if (startupError) {
    throw startupError;
  }
  process.stdout.write("ROCKETMQ_E2E_READY\n");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}
