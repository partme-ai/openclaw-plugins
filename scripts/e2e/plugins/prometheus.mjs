/**
 * Prometheus 安装态 E2E。
 *
 * 这里访问的不是直接 import 的处理器，而是从最终 tarball 安装并由 OpenClaw 2026.7.1
 * Gateway 注册的真实 HTTP 路由，因此可以发现 manifest、加载路径、auth 和路由契约漂移。
 */
import { PROMETHEUS_E2E_TOKEN } from "../config/plugins/prometheus.mjs";
import { restartInstalledGateway } from "../lib/lifecycle.mjs";
import { runAdapterTest } from "./_context.mjs";
import { runInboundTurn } from "./tracing.mjs";
import { randomUUID } from "node:crypto";

const AUTH_HEADERS = { Authorization: `Bearer ${PROMETHEUS_E2E_TOKEN}` };

function count(text, fragment) {
  return text.split(fragment).length - 1;
}

function metricValue(text, name, labels = {}) {
  for (const line of text.split("\n")) {
    if (!line.startsWith(name + "{") && !line.startsWith(name + " ")) continue;
    if (Object.entries(labels).some(([key, value]) => !line.includes(`${key}="${value}"`))) continue;
    const value = Number(line.trim().split(/\s+/).at(-1));
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testPrometheus(ctx, results) {
  const evidence = {};
  await runAdapterTest(
    ctx,
    "prometheus",
    async () => {
      await ctx.waitFor(async () => {
        const response = await ctx.gatewayFetch("/metrics", { headers: AUTH_HEADERS });
        return response.status === 200 && response.text.includes("openclaw_up");
      }, { label: "authenticated Prometheus scrape", timeoutMs: 30_000 });

      const anonymous = await ctx.gatewayFetch("/metrics");
      if (anonymous.status !== 401) {
        throw new Error(`anonymous scrape → ${anonymous.status}, expected 401`);
      }
      const invalid = await ctx.gatewayFetch("/metrics", {
        headers: { Authorization: "Bearer wrong-token" },
      });
      if (invalid.status !== 401) {
        throw new Error(`invalid Bearer scrape → ${invalid.status}, expected 401`);
      }

      const scrape = await ctx.gatewayFetch("/metrics", { headers: AUTH_HEADERS });
      if (scrape.status !== 200 || !/^openclaw_up(?:\{[^}]*\})? 1(?:\s|$)/m.test(scrape.text)) {
        throw new Error(`authenticated scrape did not expose openclaw_up=1: ${scrape.status}`);
      }
      if (!scrape.text.includes('openclaw_exporter_build_info{plugin="prometheus",version="2026.7.1"} 1')) {
        throw new Error("build_info does not identify prometheus@2026.7.1");
      }
      if (count(scrape.text, "# HELP openclaw_exporter_build_info") !== 1) {
        throw new Error("build_info HELP must be emitted exactly once");
      }
      if (scrape.text.includes(PROMETHEUS_E2E_TOKEN)) {
        throw new Error("scrape response leaked the configured Bearer token");
      }

      const health = await ctx.gatewayFetch("/metrics/health", { headers: AUTH_HEADERS });
      if (health.status !== 200 || health.json?.healthy !== true || health.json?.version !== "2026.7.1") {
        throw new Error(`Prometheus health is not ready: ${health.status} ${health.text}`);
      }
      if (health.json?.rpc?.initialized !== true || health.json?.collectors?.failed !== 0) {
        throw new Error(`Prometheus collectors/RPC are degraded: ${health.text}`);
      }

      if (process.env.OPENCLAW_E2E_O6 === "1") {
        if (!["mqtt", "router", "memory"].every((id) => ctx.pluginIds.includes(id)) || !ctx.modelFixture) {
          throw new Error("O6 Prometheus E2E requires mqtt,router,memory and the local model fixture");
        }
        const nonce = randomUUID();
        const deliveryId = `o6-metrics-${randomUUID()}`;
        const previousReply = ctx.modelFixture.controls.replyText;
        ctx.modelFixture.controls.replyText = `openclaw e2e fixture reply ${nonce}`;
        try { await runInboundTurn(ctx, nonce, deliveryId); }
        finally { ctx.modelFixture.controls.replyText = previousReply; }
        let actualSamples;
        await ctx.waitFor(async () => {
          const actual = await ctx.gatewayFetch("/metrics", { headers: AUTH_HEADERS });
          if (actual.status !== 200 || actual.text.includes(deliveryId)) return false;
          const samples = {
            deliveryTelemetryEnabled: metricValue(actual.text, "openclaw_delivery_telemetry_enabled"),
            mqttDelivered: metricValue(actual.text, "openclaw_delivery_settlements_total", { channel: "mqtt", outcome: "delivered" }),
            routerFailed: metricValue(actual.text, "openclaw_delivery_settlements_total", { channel: "router", outcome: "failed" }),
            routerRetries: metricValue(actual.text, "openclaw_delivery_retries_total", { channel: "router" }),
            routerDlqEntries: metricValue(actual.text, "openclaw_router_dlq_entries"),
            memoryRecallCount: metricValue(actual.text, "openclaw_memory_recall_duration_seconds_count", { plugin: "memory" }),
          };
          const valid = samples.deliveryTelemetryEnabled === 1 && samples.mqttDelivered >= 1 &&
            samples.routerFailed >= 1 && samples.routerRetries >= 1 && samples.routerDlqEntries >= 1 &&
            samples.memoryRecallCount >= 1;
          if (valid) actualSamples = samples;
          return valid;
        }, { label: "O6 actual settlement/retry/DLQ/recall metric values", timeoutMs: 30_000, intervalMs: 500 });
        const o6Health = await ctx.gatewayFetch("/metrics/health", { headers: AUTH_HEADERS });
        if (o6Health.json?.deliveryTelemetry?.status !== "best-effort" ||
            o6Health.json?.deliveryTelemetry?.diagnosticQueueDrops !== 0) {
          throw new Error(`O6 diagnostics degraded: ${o6Health.text}`);
        }
        evidence.o6 = { ...actualSamples, diagnosticsStatus: o6Health.json.deliveryTelemetry.status,
          diagnosticQueueDrops: o6Health.json.deliveryTelemetry.diagnosticQueueDrops,
          rawDeliveryIdAbsent: true };
        console.log("[o6-prometheus] installed MQTT delivered, Router failed/retry/DLQ, Memory recall count, diagnostics enabled, zero queue drops");
      }

      const post = await ctx.gatewayFetch("/metrics", { method: "POST", headers: AUTH_HEADERS });
      if (post.status !== 405) {
        throw new Error(`POST /metrics → ${post.status}, expected 405`);
      }
      const unknown = await ctx.gatewayFetch("/metrics/unknown", { headers: AUTH_HEADERS });
      // OpenClaw 未命中的 GET 路径可能交给控制台 SPA fallback 并返回 200；exact 的
      // 可观察契约是这里绝不能执行 metrics handler 或泄露指标正文，而不是强求 404。
      if (unknown.text.includes("openclaw_up") || unknown.text.includes("# HELP")) {
        throw new Error("non-exact child path was incorrectly handled as a Prometheus scrape");
      }

      const concurrent = await Promise.all(
        Array.from({ length: 25 }, () => ctx.gatewayFetch("/metrics", { headers: AUTH_HEADERS })),
      );
      if (concurrent.some((response) => response.status !== 200)) {
        throw new Error("one or more concurrent scrapes failed");
      }

      await restartInstalledGateway(ctx);
      await ctx.waitFor(async () => {
        try {
          const response = await ctx.gatewayFetch("/metrics", { headers: AUTH_HEADERS });
          return response.status === 200 && /^openclaw_up(?:\{[^}]*\})? 1(?:\s|$)/m.test(response.text);
        } catch { return false; }
      }, { label: "Prometheus scrape after Gateway restart", timeoutMs: 30_000 });
      const restartedScrape = await ctx.gatewayFetch("/metrics", { headers: AUTH_HEADERS });
      const restartedHealth = await ctx.gatewayFetch("/metrics/health", { headers: AUTH_HEADERS });
      const restartedAnonymous = await ctx.gatewayFetch("/metrics");
      if (restartedAnonymous.status !== 401 || count(restartedScrape.text, "# HELP openclaw_exporter_build_info") !== 1 ||
          restartedHealth.json?.healthy !== true || restartedHealth.json?.rpc?.initialized !== true ||
          restartedHealth.json?.collectors?.failed !== 0) {
        throw new Error(`Prometheus restart changed scrape/collector state: ${restartedHealth.text}`);
      }
    },
    {
      service: "OpenClaw Gateway /metrics",
      method: "tarball install + Bearer auth + metrics/health contract + concurrent scrape + Gateway stop/restart",
      ...(process.env.OPENCLAW_E2E_O6 === "1" ? { evidence } : {}),
    },
    results,
  );
}
