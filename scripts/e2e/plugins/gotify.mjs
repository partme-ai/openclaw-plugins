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
      if (!ctx.modelFixture) throw new Error("Gotify Agent E2E requires the local model fixture");
      const status = await ctx.gatewayFetch("/gotify/status");
      if (!status.ok) throw new Error(`/gotify/status → ${status.status}`);
      const beforeInboundAt = status.json?.data?.accounts?.[0]?.runtime?.lastInboundAt ?? 0;
      const beforeOutboundAt = status.json?.data?.accounts?.[0]?.runtime?.lastOutboundAt ?? 0;
      const beforeCompletions = ctx.modelFixture.metrics.completions;
      const res = await fetch(`${ctx.gotifySecrets.serverUrl}/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Gotify-Key": ctx.gotifySecrets.appToken,
        },
        body: JSON.stringify({
          title: "e2e",
          message: "Return the Gotify E2E fixture response.",
          priority: 5,
        }),
      });
      if (!res.ok) throw new Error(`gotify POST /message → ${res.status}`);
      const inbound = await res.json();
      await ctx.waitFor(async () => {
        const current = await ctx.gatewayFetch("/gotify/status");
        const lastInboundAt = current.json?.data?.accounts?.[0]?.runtime?.lastInboundAt ?? 0;
        const lastOutboundAt = current.json?.data?.accounts?.[0]?.runtime?.lastOutboundAt ?? 0;
        return current.ok && lastInboundAt > beforeInboundAt && lastOutboundAt > beforeOutboundAt;
      }, { label: "gotify Agent dispatch and reply", timeoutMs: 45_000 });

      let messages;
      await ctx.waitFor(async () => {
        const list = await fetch(`${ctx.gotifySecrets.serverUrl}/message?limit=100`, {
          headers: { "X-Gotify-Key": ctx.gotifySecrets.clientToken },
        });
        if (!list.ok) throw new Error(`gotify GET /message → ${list.status}`);
        messages = (await list.json()).messages ?? [];
        const inboundDeleted = !messages.some((message) => message.id === inbound.id);
        const reply = messages.find((message) =>
          message.message === "openclaw e2e fixture reply"
          && message.extras?.openclaw?.outbound === true
        );
        return inboundDeleted && Boolean(reply);
      }, { label: "gotify reply retained and inbound deleted", timeoutMs: 20_000 });

      const completionDelta = ctx.modelFixture.metrics.completions - beforeCompletions;
      if (completionDelta !== 1) {
        throw new Error(`Gotify model completion count mismatch: expected 1, got ${completionDelta}`);
      }
      const health = await ctx.gatewayFetch("/gotify/health");
      if (!health.ok) throw new Error(`/gotify/health → ${health.status}`);
    },
    {
      service: "docker:18080",
      method: "REST publish → WebSocket → real Agent Turn → retained reply → delete inbound",
    },
    results,
  );
}
