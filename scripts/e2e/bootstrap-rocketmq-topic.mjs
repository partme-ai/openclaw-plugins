/**
 * Pre-create RocketMQ topic on Docker broker so proxy/client can fetch routes.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { E2E_DIR } from "./lib/utils.mjs";

const req = createRequire(new URL("../../extensions/rocketmq/package.json", import.meta.url));
const { Producer } = req("rocketmq-client-nodejs");

const meta = JSON.parse(readFileSync(`${E2E_DIR}/.e2e-config-meta.json`, "utf8"));
const topic = meta.rocketmqTopic;
const endpoints = process.env.ROCKETMQ_ENDPOINTS ?? "127.0.0.1:8081";
const dockerEnv = {
  ...process.env,
  PATH: `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH ?? ""}`,
};

/**
 * @description Create topic on broker via mqadmin when auto-create is unavailable through proxy.
 */
function ensureTopicViaDocker(topicName) {
  try {
    execSync(
      `docker exec openclaw-e2e-rmq-broker sh mqadmin updatetopic -n rocketmq-namesrv:9876 -t ${topicName} -c DefaultCluster`,
      { stdio: "pipe", env: dockerEnv },
    );
    console.log(`[rocketmq-bootstrap] mqadmin topic created: ${topicName}`);
  } catch (err) {
    console.warn(`[rocketmq-bootstrap] mqadmin skipped: ${err instanceof Error ? err.message : err}`);
  }
}

async function main() {
  ensureTopicViaDocker(topic);
  try {
    const producer = new Producer({ endpoints, namespace: "", requestTimeout: 15_000 });
    await producer.startup();
    await producer.send({
      topic,
      tag: "*",
      body: Buffer.from(JSON.stringify({ text: "bootstrap topic create" })),
    });
    await producer.shutdown();
    console.log(`[rocketmq-bootstrap] producer ping ok: ${topic}`);
  } catch (err) {
    console.warn(`[rocketmq-bootstrap] producer ping skipped: ${err instanceof Error ? err.message : err}`);
  }
  console.log(`[rocketmq-bootstrap] topic ready: ${topic} @ ${endpoints}`);
}

main().catch((err) => {
  console.error("[rocketmq-bootstrap] failed:", err);
  process.exit(1);
});
