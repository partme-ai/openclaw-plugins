/**
 * Pre-create RocketMQ topic on Docker broker so proxy/client can fetch routes.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_DIR } from "../lib/utils.mjs";
import { DOCKER, dockerEnv } from "../lib/compose.mjs";

/**
 * @description Create topic on broker via mqadmin when auto-create is unavailable through proxy.
 * @param {string} topicName
 */
function ensureTopicViaDocker(topicName) {
  try {
    execSync(
      `docker exec openclaw-e2e-rmq-broker sh mqadmin updatetopic -n rocketmq-namesrv:9876 -t ${topicName} -c DefaultCluster`,
      { stdio: "pipe", env: dockerEnv() },
    );
    console.log(`[rocketmq-bootstrap] mqadmin topic created: ${topicName}`);
  } catch (err) {
    console.warn(`[rocketmq-bootstrap] mqadmin skipped: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * @param {string} [topicOverride]
 */
export async function bootstrapRocketmqTopic(topicOverride) {
  const metaPath = join(E2E_DIR, ".e2e-config-meta.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const topic = topicOverride ?? meta.rocketmqTopic;
  const endpoints = process.env.ROCKETMQ_ENDPOINTS ?? "127.0.0.1:8081";

  ensureTopicViaDocker(topic);
  ensureTopicViaDocker(`${topic}-out`);
  // The adapter E2E performs the real producer publish. Keeping a second SDK
  // producer here caused rocketmq-client-nodejs/egg-logger to write after its
  // log stream had closed during shutdown under Node 24.
  console.log(`[rocketmq-bootstrap] topics ready: ${topic}, ${topic}-out @ ${endpoints}`);
}
