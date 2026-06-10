/**
 * RabbitMQ external broker E2E adapter.
 */
import { createRequire } from "node:module";
import { runAdapterTest } from "./_context.mjs";

const req = createRequire(new URL("../../../extensions/rabbitmq/package.json", import.meta.url));
const amqp = req("amqplib");

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testRabbitmq(ctx, results) {
  await runAdapterTest(
    ctx,
    "rabbitmq",
    async () => {
      const health = await ctx.gatewayFetch("/rabbitmq/health");
      if (health.json?.data?.connected !== true) {
        throw new Error(`/rabbitmq/health → ${health.status}: ${health.text}`);
      }
      const conn = await amqp.connect("amqp://127.0.0.1:5672");
      const ch = await conn.createChannel();
      await ch.assertExchange("openclaw-e2e", "topic", { durable: true });
      ch.publish(
        "openclaw-e2e",
        "openclaw.agent.main.in",
        Buffer.from(JSON.stringify({ ...ctx.pingPayload, text: "e2e rabbit ping" })),
      );
      await ch.close();
      await conn.close();
      await ctx.waitFor(async () => {
        const stats = await ctx.gatewayFetch("/rabbitmq/stats");
        const received = stats.json?.data?.stats?.messagesReceived;
        return stats.ok && typeof received === "number" && received > 0;
      }, { label: "rabbitmq stats messagesReceived", timeoutMs: 15_000 });
    },
    { service: "docker:5672", method: "amqp publish + /rabbitmq/health" },
    results,
  );
}
