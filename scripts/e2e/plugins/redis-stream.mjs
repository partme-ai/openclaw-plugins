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
      await ctx.waitFor(async () => {
        const health = await ctx.gatewayFetch("/redis-stream/health");
        return health.json?.data?.connected === true;
      }, { label: "redis-stream channel connection", timeoutMs: 15_000 });
      const model = ctx.modelFixture;
      if (!model) throw new Error("redis-stream E2E model fixture was not started by the orchestrator");
      const initialCompletions = model.metrics.completions;
      const client = createClient({ url: "redis://127.0.0.1:6379" });
      await client.connect();
      try {
        const peerId = `redis-stream-e2e-${Date.now()}`;
        await client.xAdd("openclaw-e2e:inbound", "*", {
          text: "Return the Redis Stream E2E fixture response.",
          agentId: "main",
          peerId,
          replyStream: "openclaw-e2e:outbound",
        });

        let reply;
        await ctx.waitFor(async () => {
          const entries = await client.xRevRange("openclaw-e2e:outbound", "+", "-", { COUNT: 20 });
          reply = entries.find((entry) => entry.message?.peerId === peerId);
          return Boolean(reply);
        }, { label: "redis-stream Agent reply entry", timeoutMs: 30_000 });

        const wire = reply?.message?.text;
        const envelope = typeof wire === "string" ? JSON.parse(wire) : null;
        if (envelope?.message?.text !== "openclaw e2e fixture reply") {
          throw new Error(`unexpected Redis Stream reply envelope: ${wire ?? "<missing>"}`);
        }
        if (envelope?.message?.source?.channel !== "redis-stream") {
          throw new Error(`Redis Stream reply source channel missing: ${wire}`);
        }
        if (envelope?.headers?.replyRoute?.topic !== "openclaw-e2e:outbound") {
          throw new Error(`Redis Stream reply route missing: ${wire}`);
        }

        await ctx.waitFor(async () => {
          const status = await ctx.gatewayFetch("/redis-stream/status");
          const stats = status.json?.data?.stats;
          const pending = await client.xPending("openclaw-e2e:inbound", "openclaw-e2e");
          return status.ok
            && typeof stats?.messagesRead === "number" && stats.messagesRead > 0
            && typeof stats?.messagesWritten === "number" && stats.messagesWritten > 0
            && typeof stats?.messagesAcked === "number" && stats.messagesAcked > 0
            && pending.pending === 0;
        }, { label: "redis-stream reply + XACK + empty PEL", timeoutMs: 15_000 });

        if (model.metrics.completions !== initialCompletions + 1) {
          throw new Error(`fixture completion delta=${model.metrics.completions - initialCompletions}, expected 1`);
        }
      } finally {
        await client.quit();
      }
    },
    { service: "docker:6379", method: "XADD + XREADGROUP + real Agent Turn + reply Stream + XACK/empty PEL" },
    results,
  );
}
