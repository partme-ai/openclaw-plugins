import { runAdapterTest } from "./_context.mjs";

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testRouter(ctx, results) {
  await runAdapterTest(
    ctx,
    "router",
    async () => {
      if (!ctx.gotifySecrets) throw new Error("Gotify secrets missing for Router target verification");
      await ctx.waitFor(async () => {
        const current = await ctx.gatewayFetch("/router/status");
        return current.ok && current.json?.data?.delivered >= 1 && current.json?.data?.pending === 0;
      }, { label: "router persisted outbox delivery through Gateway send", timeoutMs: 20_000 });
      const health = await ctx.gatewayFetch("/router/health");
      if (!health.ok) throw new Error(`/router/health → ${health.status}`);
      const messages = await fetch(`${ctx.gotifySecrets.serverUrl}/message?limit=20`, {
        headers: { "X-Gotify-Key": ctx.gotifySecrets.clientToken },
      });
      if (!messages.ok) throw new Error(`Gotify message verification → ${messages.status}`);
      const body = await messages.json();
      if (!body?.messages?.some((message) => message.message === "router public channel outbound adapter E2E")) {
        throw new Error("Router delivery body was not found in Gotify");
      }
    },
    { service: "openclaw-gateway", method: "persisted Outbox → public channel outbound adapter → Gotify" },
    results,
  );
}
