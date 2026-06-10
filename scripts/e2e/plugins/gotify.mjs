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
        const h = await ctx.gatewayFetch("/gotify/health");
        return h.ok;
      }, { label: "gotify health", timeoutMs: 20_000 });
    },
    { service: "docker:18080", method: "POST /message + /gotify/status" },
    results,
  );
}
