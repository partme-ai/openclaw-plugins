/**
 * RocketMQ external broker E2E adapter.
 */
import { createRequire } from "node:module";
import { runAdapterTest } from "./_context.mjs";

const req = createRequire(new URL("../../../extensions/rocketmq/package.json", import.meta.url));
const { Producer } = req("rocketmq-client-nodejs");

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testRocketmq(ctx, results) {
  await runAdapterTest(
    ctx,
    "rocketmq",
    async () => {
      const health = await ctx.gatewayFetch("/rocketmq/health");
      if (health.json?.data?.connected !== true) {
        throw new Error(`/rocketmq/health → ${health.status}: ${health.text}`);
      }
      if (!(await ctx.tcpReachable(8081))) throw new Error("RocketMQ proxy 8081 not reachable");
      const producer = new Producer({ endpoints: "127.0.0.1:8081", namespace: "", requestTimeout: 10_000 });
      try {
        await producer.startup();
        await producer.send({
          topic: ctx.meta.rocketmqTopic,
          tag: "*",
          body: Buffer.from(JSON.stringify({ ...ctx.pingPayload, text: "e2e rocketmq ping" })),
        });
      } finally {
        producer.shutdown().catch(() => {});
      }
    },
    { service: "docker:8081", method: "Producer.send + /rocketmq/health" },
    results,
  );
}
