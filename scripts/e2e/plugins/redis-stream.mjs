/** Redis Streams consumer-group E2E adapter. */
import { createRequire } from "node:module";
import { runAdapterTest } from "./_context.mjs";

const req = createRequire(new URL("../../../extensions/redis-stream/package.json", import.meta.url));
const { createClient } = req("redis");

export async function testRedisStream(ctx, results) {
  await runAdapterTest(
    ctx,
    "redis-stream",
    async () => {
      const health = await ctx.gatewayFetch("/redis-stream/health");
      if (health.json?.data?.connected !== true) {
        throw new Error(`/redis-stream/health → ${health.status}: ${health.text}`);
      }
      const client = createClient({ url: "redis://127.0.0.1:6379" });
      await client.connect();
      try {
        await client.xAdd("openclaw-e2e:inbound", "*", {
          text: "e2e redis stream ping",
          agentId: "main",
          peerId: `e2e-${Date.now()}`,
          replyStream: "openclaw-e2e:outbound",
        });
        await ctx.waitFor(async () => {
          const status = await ctx.gatewayFetch("/redis-stream/status");
          const acked = status.json?.data?.stats?.messagesAcked;
          return status.ok && typeof acked === "number" && acked > 0;
        }, { label: "redis-stream messagesAcked", timeoutMs: 15_000 });
      } finally {
        await client.quit();
      }
    },
    { service: "docker:6379", method: "XADD + XREADGROUP + XACK + /redis-stream/health" },
    results,
  );
}
