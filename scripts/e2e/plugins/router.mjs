import { runAdapterTest } from "./_context.mjs";
import { MANAGEMENT_E2E_GATEWAY_TOKEN } from "../lib/config.mjs";

const authorized = { headers: { Authorization: `Bearer ${MANAGEMENT_E2E_GATEWAY_TOKEN}` } };

function rejected(response, label) {
  if (![401, 403].includes(response.status) || response.json?.data !== undefined) {
    throw new Error(`${label} exposed a management response (${response.status})`);
  }
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testRouter(ctx, results) {
  await runAdapterTest(
    ctx,
    "router",
    async () => {
      if (!ctx.gotifySecrets) throw new Error("Gotify secrets missing for Router target verification");
      await ctx.waitFor(async () => {
        const current = await ctx.gatewayFetch("/router/status", authorized);
        return current.ok && current.json?.data?.delivered >= 1 && current.json?.data?.pending === 0 && current.json?.data?.deadLetters === 1;
      }, { label: "router persisted outbox delivery through Gateway send", timeoutMs: 20_000 });

      const deniedStatuses = [];
      for (const path of ["/router/status", "/router/health", "/router/dlq", "/router/audit"]) {
        const response = await ctx.gatewayFetch(path);
        rejected(response, `anonymous GET ${path}`);
        deniedStatuses.push(`${path}:${response.status}`);
      }
      const anonymousReplay = await ctx.gatewayFetch("/router/dlq/replay?limit=1", { method: "POST" });
      rejected(anonymousReplay, "anonymous replay POST");
      const invalidReplay = await ctx.gatewayFetch("/router/dlq/replay?limit=1", {
        method: "POST", headers: { Authorization: "Bearer invalid-e2e-token" },
      });
      rejected(invalidReplay, "invalid token replay POST");
      const cookieReplay = await ctx.gatewayFetch("/router/dlq/replay?limit=1", {
        method: "POST", headers: { Cookie: "openclaw-plugin-auth-router=invalid-e2e-cookie" },
      });
      rejected(cookieReplay, "cookie-only replay POST");
      const beforeReplay = await ctx.gatewayFetch("/router/dlq", authorized);
      if (!beforeReplay.ok || beforeReplay.json?.data?.length !== 1) {
        throw new Error(`unauthorized replay changed DLQ: ${beforeReplay.status}`);
      }
      const replay = await ctx.gatewayFetch("/router/dlq/replay?limit=1", { method: "POST", ...authorized });
      if (replay.status !== 202 || replay.json?.data?.replayed !== 1) {
        throw new Error(`authorized replay failed: ${replay.status}`);
      }
      console.log(`[router-auth] anonymous GET ${deniedStatuses.join(", ")}; POST anonymous=${anonymousReplay.status}, invalid=${invalidReplay.status}, cookie-only=${cookieReplay.status}; authorized replay=${replay.status}, replayed=1`);
      await ctx.waitFor(async () => {
        const current = await ctx.gatewayFetch("/router/status", authorized);
        return current.ok && current.json?.data?.delivered === 2 && current.json?.data?.pending === 0 && current.json?.data?.deadLetters === 0;
      }, { label: "single authorized DLQ replay delivery", timeoutMs: 20_000 });
      const health = await ctx.gatewayFetch("/router/health", authorized);
      if (!health.ok) throw new Error(`/router/health → ${health.status}`);
      const messages = await fetch(`${ctx.gotifySecrets.serverUrl}/message?limit=20`, {
        headers: { "X-Gotify-Key": ctx.gotifySecrets.clientToken },
      });
      if (!messages.ok) throw new Error(`Gotify message verification → ${messages.status}`);
      const body = await messages.json();
      if (!body?.messages?.some((message) => message.message === "router public channel outbound adapter E2E")) {
        throw new Error("Router delivery body was not found in Gotify");
      }
      if (body.messages.filter((message) => message.message === `router authenticated DLQ replay E2E ${ctx.meta.rocketmqTopic}`).length !== 1) {
        throw new Error("Authorized DLQ replay did not deliver exactly once");
      }
    },
    { service: "openclaw-gateway", method: "Gateway-authenticated management routes + single DLQ replay → Gotify" },
    results,
  );
}
