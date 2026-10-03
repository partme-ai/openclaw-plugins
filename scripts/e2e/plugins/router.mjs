import { createRequire } from "node:module";
import { STRUCTURED_MEDIA_URL, STRUCTURED_MEDIA_SHA256 } from "../helpers/structured-wire-fixture.mjs";
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
      const o6 = process.env.OPENCLAW_E2E_O6 === "1";
      if (!ctx.gotifySecrets) throw new Error("Gotify secrets missing for Router target verification");
      await ctx.waitFor(async () => {
        const current = await ctx.gatewayFetch("/router/status", authorized);
        return current.ok && current.json?.data?.delivered >= 1 && current.json?.data?.pending === 0 &&
          (o6 ? current.json?.data?.deadLetters >= 1 : current.json?.data?.deadLetters === 1);
      }, { label: "router persisted outbox delivery through Gateway send", timeoutMs: 20_000 });
      const beforeDeniedStatus = await ctx.gatewayFetch("/router/status", authorized);
      const beforeDeniedDlq = await ctx.gatewayFetch("/router/dlq", authorized);
      if (!beforeDeniedStatus.ok || !beforeDeniedDlq.ok ||
          (o6 ? beforeDeniedDlq.json?.data?.length < 1 : beforeDeniedDlq.json?.data?.length !== 1)) {
        throw new Error("Router management baseline is unavailable before denied requests");
      }

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
      rejected(cookieReplay, "forged cookie replay POST");
      const afterDeniedStatus = await ctx.gatewayFetch("/router/status", authorized);
      const afterDeniedDlq = await ctx.gatewayFetch("/router/dlq", authorized);
      if (!afterDeniedStatus.ok || !afterDeniedDlq.ok ||
          afterDeniedStatus.json?.data?.delivered !== beforeDeniedStatus.json?.data?.delivered ||
          afterDeniedStatus.json?.data?.deadLetters !== beforeDeniedStatus.json?.data?.deadLetters ||
          JSON.stringify(afterDeniedDlq.json?.data) !== JSON.stringify(beforeDeniedDlq.json?.data)) {
        throw new Error("denied replay request changed Router delivery or DLQ state");
      }
      const audit = await ctx.gatewayFetch("/router/audit?limit=1", authorized);
      if (audit.status !== 200 || audit.json?.ok !== true || !Array.isArray(audit.json?.data)) {
        throw new Error(`authorized audit response changed: ${audit.status}`);
      }
      const replay = await ctx.gatewayFetch("/router/dlq/replay?limit=1", { method: "POST", ...authorized });
      if (replay.status !== 202 || replay.json?.data?.replayed !== 1) {
        throw new Error(`authorized replay failed: ${replay.status}`);
      }
      console.log(`[router-auth] anonymous GET ${deniedStatuses.join(", ")}; POST anonymous=${anonymousReplay.status}, invalid=${invalidReplay.status}, forged-cookie=${cookieReplay.status}; denied requests kept DLQ unchanged; authorized replay=${replay.status}, replayed=1`);
      await ctx.waitFor(async () => {
        const current = await ctx.gatewayFetch("/router/status", authorized);
        return current.ok &&
          current.json?.data?.delivered === beforeDeniedStatus.json.data.delivered + 1 &&
          current.json?.data?.pending === 0 &&
          current.json?.data?.deadLetters === beforeDeniedStatus.json.data.deadLetters - 1;
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
      if (process.env.OPENCLAW_E2E_STRUCTURED_WIRE === "1") await verifyStructuredMedia(ctx);
    },
    { service: "openclaw-gateway", method: process.env.OPENCLAW_E2E_STRUCTURED_WIRE === "1" ? "Gateway management + MQ structured wire → ordered WeCom text/image with uploaded byte SHA" : "Gateway-authenticated management routes + single DLQ replay → Gotify" },
    results,
  );
}


/** Real MQTT ingress → installed Router → installed WeCom media upload/image send. */
async function verifyStructuredMedia(ctx) {
  if (!ctx.wecomProvider || !ctx.pluginIds.includes("mqtt")) throw new Error("O3 requires mqtt,router,wecom,gotify");
  const mqtt = createRequire(new URL("../../../extensions/mqtt/package.json", import.meta.url))("mqtt");
  const client = mqtt.connect("mqtt://127.0.0.1:11883", { clientId: `o3-media-${Date.now()}`, reconnectPeriod: 0 });
  const id = `o3-${Date.now()}`;
  const message = { schemaVersion: 1, messageId: id, deliveryId: `${id}-delivery`, idempotencyKey: `${id}-delivery`,
    parts: [{ type: "text", text: `${id}:before` }, { type: "media", mediaType: "image", url: STRUCTURED_MEDIA_URL }, { type: "text", text: `${id}:after` }] };
  try {
    await new Promise((resolve, reject) => { client.once("connect", resolve); client.once("error", reject); });
    const start = ctx.wecomProvider.metrics.messages.length;
    await client.publishAsync("openclaw/agent/main/in", JSON.stringify(message), { qos: 1 });
    await ctx.waitFor(() => ctx.wecomProvider.metrics.messages.slice(start).some((m) => m.text?.content === `${id}:after`), { timeoutMs: 60_000, label: "O3 ordered WeCom media delivery" });
    const messages = ctx.wecomProvider.metrics.messages.slice(start);
    const before = messages.findIndex((m) => m.text?.content === `${id}:before`);
    const sequence = messages.slice(before, before + 3);
    if (before < 0 || sequence[0]?.text?.content !== `${id}:before` || sequence[1]?.msgtype !== "image" || sequence[2]?.text?.content !== `${id}:after`) {
      throw new Error(`O3 media order/fidelity failed: ${JSON.stringify(sequence)}`);
    }
    const upload = ctx.wecomProvider.metrics.uploads.find((item) => item.mediaId === sequence[1].image?.media_id);
    if (!upload || upload.type !== "image" || upload.sha256 !== STRUCTURED_MEDIA_SHA256) throw new Error("O3 actual uploaded media bytes mismatch; text fallback is not accepted");
    console.log(`[o3-wire] MQTT messageId=${id} deliveryId=${message.deliveryId}; WeCom text→image→text, upload bytes=${upload.bytes} sha256=${upload.sha256}; public HTTPS fixture dependency`);
  } finally { await client.endAsync(true); }
}
