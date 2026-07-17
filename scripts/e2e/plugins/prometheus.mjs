/**
 * Prometheus 安装态 E2E。
 *
 * 这里访问的不是直接 import 的处理器，而是从最终 tarball 安装并由 OpenClaw 2026.7.1
 * Gateway 注册的真实 HTTP 路由，因此可以发现 manifest、加载路径、auth 和路由契约漂移。
 */
import { PROMETHEUS_E2E_TOKEN } from "../config/plugins/prometheus.mjs";
import { runAdapterTest } from "./_context.mjs";

const AUTH_HEADERS = { Authorization: `Bearer ${PROMETHEUS_E2E_TOKEN}` };

function count(text, fragment) {
  return text.split(fragment).length - 1;
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testPrometheus(ctx, results) {
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
    },
    {
      service: "OpenClaw Gateway /metrics",
      method: "tarball install + Bearer auth + metrics/health contract + exact GET routes + concurrent scrape",
    },
    results,
  );
}
