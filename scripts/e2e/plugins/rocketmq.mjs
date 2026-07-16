/**
 * RocketMQ external broker E2E adapter.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runAdapterTest } from "./_context.mjs";

const PRODUCER_HELPER = fileURLToPath(new URL("../helpers/rocketmq-producer.mjs", import.meta.url));

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testRocketmq(ctx, results) {
  await runAdapterTest(
    ctx,
    "rocketmq",
    async () => {
      if (!(await ctx.tcpReachable(8081))) throw new Error("RocketMQ proxy 8081 not reachable");
      let health = await ctx.gatewayFetch("/rocketmq/health");
      await ctx.waitFor(
        async () => {
          health = await ctx.gatewayFetch("/rocketmq/health");
          return health.json?.data?.connected === true;
        },
        { label: "RocketMQ channel connected", timeoutMs: 60_000, intervalMs: 1_000 },
      ).catch(() => {
        throw new Error(`/rocketmq/health → ${health.status}: ${health.text}`);
      });
      execFileSync(
        process.execPath,
        [
          PRODUCER_HELPER,
          "127.0.0.1:8081",
          ctx.meta.rocketmqTopic,
          JSON.stringify({ ...ctx.pingPayload, text: "e2e rocketmq ping" }),
        ],
        { stdio: "pipe", timeout: 30_000 },
      );
    },
    { service: "docker:8081", method: "Producer.send + /rocketmq/health" },
    results,
  );
}
