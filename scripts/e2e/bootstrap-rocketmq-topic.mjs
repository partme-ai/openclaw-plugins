/**
 * Pre-create RocketMQ topic — thin wrapper for bootstrap/rocketmq-topic.mjs
 */
import { bootstrapRocketmqTopic } from "./bootstrap/rocketmq-topic.mjs";

bootstrapRocketmqTopic().catch((err) => {
  console.error("[rocketmq-bootstrap] failed:", err);
  process.exit(1);
});
