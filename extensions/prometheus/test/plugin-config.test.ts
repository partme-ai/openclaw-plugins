import { describe, it, expect } from "vitest";
import { resolvePrometheusConfig, scrapeTokenEnvName } from "../src/config/plugin-config.js";

describe("resolvePrometheusConfig", () => {
  it("uses defaults when raw is empty", () => {
    const c = resolvePrometheusConfig(undefined);
    expect(c.metricsPath).toBe("/metrics");
    expect(c.collectIntervalMs).toBe(15000);
    expect(c.snapshotIntervalMs).toBe(30000);
    expect(c.workloadWindowMs).toBe(300000);
    expect(c.includeRuntime).toBe(true);
    expect(c.monitoredProviders).toEqual([]);
    expect(c.scrapeAuthEnabled).toBe(false);
    expect(c.collectorTimeoutMs).toBe(10000);
    expect(c.maxScrapeSeries).toBe(10000);
  });

  it("respects custom path and interval", () => {
    const c = resolvePrometheusConfig({
      path: "/openclaw/metrics",
      collectIntervalMs: 5000,
      snapshotIntervalMs: 60000,
      workloadWindowMs: 900000,
      includeRuntime: false,
      monitoredProviders: ["openai", "anthropic"],
      collectorTimeoutMs: 5000,
      maxScrapeSeries: 2000,
    });
    expect(c.metricsPath).toBe("/openclaw/metrics");
    expect(c.collectIntervalMs).toBe(5000);
    expect(c.snapshotIntervalMs).toBe(60000);
    expect(c.workloadWindowMs).toBe(900000);
    expect(c.includeRuntime).toBe(false);
    expect(c.monitoredProviders).toEqual(["openai", "anthropic"]);
    expect(c.collectorTimeoutMs).toBe(5000);
    expect(c.maxScrapeSeries).toBe(2000);
  });

  it("reads bearer token from env when scrapeAuth enabled", () => {
    const c = resolvePrometheusConfig(
      { scrapeAuth: { enabled: true } },
      { OPENCLAW_PROMETHEUS_BEARER_TOKEN: "abc" } as NodeJS.ProcessEnv,
    );
    expect(c.scrapeAuthEnabled).toBe(true);
    expect(c.scrapeBearerToken).toBe("abc");
  });

  it("exposes env name helper", () => {
    expect(scrapeTokenEnvName()).toBe("OPENCLAW_PROMETHEUS_BEARER_TOKEN");
  });

  it("rejects invalid paths and out-of-range intervals", () => {
    expect(() => resolvePrometheusConfig({ path: "metrics" })).toThrow(/absolute HTTP path/);
    expect(() => resolvePrometheusConfig({ path: "/" })).toThrow(/root path/);
    expect(() => resolvePrometheusConfig({ collectIntervalMs: -1 })).toThrow(/collectIntervalMs/);
    expect(() => resolvePrometheusConfig({ snapshotIntervalMs: 999 })).toThrow(/snapshotIntervalMs/);
    expect(() => resolvePrometheusConfig({ collectorTimeoutMs: 99 })).toThrow(/collectorTimeoutMs/);
    expect(() => resolvePrometheusConfig({ maxScrapeSeries: 99 })).toThrow(/maxScrapeSeries/);
    expect(() => resolvePrometheusConfig({ includeRuntime: "false" as never })).toThrow(/includeRuntime/);
    expect(() => resolvePrometheusConfig({ metricsPath: "/legacy" })).toThrow(/unknown field/);
    expect(() => resolvePrometheusConfig({ scrapeAuth: { enabled: "true" } as never })).toThrow(/enabled/);
    expect(() => resolvePrometheusConfig({ scrapeAuth: { extra: true } as never })).toThrow(/unknown field/);
    expect(() => resolvePrometheusConfig(
      { scrapeAuth: { enabled: true } },
      {} as NodeJS.ProcessEnv,
    )).toThrow(/requires OPENCLAW_PROMETHEUS_BEARER_TOKEN/);
    expect(() => resolvePrometheusConfig(
      { scrapeAuth: { enabled: true } },
      { OPENCLAW_PROMETHEUS_BEARER_TOKEN: "bad\nvalue" } as NodeJS.ProcessEnv,
    )).toThrow(/single-line/);
  });

  it("normalizes paths and de-duplicates providers", () => {
    const c = resolvePrometheusConfig({ path: "/metrics/", monitoredProviders: [" openai ", "openai"] });
    expect(c.metricsPath).toBe("/metrics");
    expect(c.monitoredProviders).toEqual(["openai"]);
  });
});
