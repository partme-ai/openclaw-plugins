/**
 * One-shot RocketMQ producer isolated from the E2E orchestrator.
 *
 * rocketmq-client-nodejs 1.0.7 leaves telemetry activity behind and its
 * shutdown path writes to a closed egg-logger stream on Node 24. Exiting this
 * short-lived process after send acknowledgement keeps that upstream defect
 * from crashing the parent test runner.
 */
import { createRequire } from "node:module";

const req = createRequire(new URL("../../../extensions/rocketmq/package.json", import.meta.url));
const { Producer } = req("rocketmq-client-nodejs");

const [endpoints, topic, payload] = process.argv.slice(2);
if (!endpoints || !topic || payload === undefined) {
  console.error("usage: rocketmq-producer.mjs <endpoints> <topic> <payload>");
  process.exit(2);
}

try {
  const producer = new Producer({ endpoints, namespace: "", requestTimeout: 10_000 });
  await producer.startup();
  await producer.send({ topic, tag: "*", body: Buffer.from(payload) });
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}
