/**
 * Gotify external service E2E adapter.
 */
import { runAdapterTest } from "./_context.mjs";

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testGotify(ctx, results) {
  await runAdapterTest(
    ctx,
    "gotify",
    async () => {
      if (!ctx.gotifySecrets) throw new Error("Gotify secrets missing — run bootstrap/gotify.mjs");
      const status = await ctx.gatewayFetch("/gotify/status");
      if (!status.ok) throw new Error(`/gotify/status → ${status.status}`);
      const beforeInboundAt = status.json?.data?.accounts?.[0]?.runtime?.lastInboundAt ?? 0;
      const res = await fetch(`${ctx.gotifySecrets.serverUrl}/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Gotify-Key": ctx.gotifySecrets.appToken,
        },
        body: JSON.stringify({ title: "e2e", message: "gotify inbound ping", priority: 5 }),
      });
      if (!res.ok) throw new Error(`gotify POST /message → ${res.status}`);
      await ctx.waitFor(async () => {
        const current = await ctx.gatewayFetch("/gotify/status");
        const lastInboundAt = current.json?.data?.accounts?.[0]?.runtime?.lastInboundAt ?? 0;
        return current.ok && lastInboundAt > beforeInboundAt;
      }, { label: "gotify WebSocket inbound dispatch", timeoutMs: 20_000 });
      const health = await ctx.gatewayFetch("/gotify/health");
      if (!health.ok) throw new Error(`/gotify/health → ${health.status}`);
    },
    { service: "docker:18080", method: "REST publish + WebSocket inbound + health" },
    results,
  );
}
