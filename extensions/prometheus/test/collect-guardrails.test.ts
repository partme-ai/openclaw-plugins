import { describe, expect, it, vi } from "vitest";
import { CollectCache } from "../src/collectors/collect-cache.js";
import { CollectorRunner } from "../src/collectors/collector-runner.js";
import {
  limitScrapeSamples,
  SCRAPE_DROPPED_SERIES_NAME,
} from "../src/collectors/sample-limit.js";
import type { MetricCollector } from "../src/types.js";

describe("Prometheus collection guardrails", () => {
  it("coalesces concurrent cache misses even when interval caching is disabled", async () => {
    const cache = new CollectCache(0);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const factory = vi.fn(async () => {
      await gate;
      return { definitions: [], samples: [], diagnostics: [] };
    });

    const scrapes = Array.from({ length: 100 }, () =>
      cache.getOrCollect(factory),
    );
    expect(factory).toHaveBeenCalledTimes(1);
    release();
    const results = await Promise.all(scrapes);
    expect(new Set(results).size).toBe(1);
  });

  it("times out a hung collector without starting duplicate underlying calls", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const collect = vi.fn(async () => {
      await gate;
      return [];
    });
    const collector: MetricCollector = {
      name: "hung",
      definitions: [],
      collect,
    };
    const runner = new CollectorRunner();

    await expect(runner.run(collector, 10)).rejects.toThrow("timed out");
    await expect(runner.run(collector, 10)).rejects.toThrow("timed out");
    expect(collect).toHaveBeenCalledTimes(1);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    await runner.run(collector, 100);
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it("bounds scrape series and exposes the omitted count", () => {
    const samples = Array.from({ length: 12 }, (_, index) => ({
      name: `metric_${index}`,
      value: index,
    }));
    const limited = limitScrapeSamples([], samples, 10);
    expect(limited.samples).toHaveLength(10);
    expect(limited.samples.at(-1)).toEqual({
      name: SCRAPE_DROPPED_SERIES_NAME,
      value: 3,
    });
    expect(limited.definitions.at(-1)?.name).toBe(SCRAPE_DROPPED_SERIES_NAME);
  });

  it("does not mutate or add a dropped metric when the series exactly fit", () => {
    const definitions = [
      { name: "metric", help: "test", type: "gauge" as const },
    ];
    const samples = Array.from({ length: 10 }, (_, index) => ({
      name: "metric",
      value: index,
    }));

    const limited = limitScrapeSamples(definitions, samples, 10);

    expect(limited).toEqual({ definitions, samples });
    expect(
      limited.samples.some(
        (sample) => sample.name === SCRAPE_DROPPED_SERIES_NAME,
      ),
    ).toBe(false);
  });

  it("overload truncation retains exporter health signals even when they appear last", () => {
    const samples = [
      ...Array.from({ length: 12 }, (_, index) => ({ name: `business_${index}`, value: index })),
      { name: "openclaw_metrics_collector_success", labels: { collector: "usage" }, value: 0 },
      { name: "openclaw_metrics_collect_errors_total", labels: { collector: "usage" }, value: 3 },
      { name: "openclaw_exporter_build_info", value: 1 },
    ];
    const limited = limitScrapeSamples([], samples, 6);
    expect(limited.samples.map((sample) => sample.name)).toEqual(expect.arrayContaining([
      "openclaw_metrics_collector_success",
      "openclaw_metrics_collect_errors_total",
      "openclaw_exporter_build_info",
      SCRAPE_DROPPED_SERIES_NAME,
    ]));
  });

  it("histogram bucket/sum/count series are retained or dropped atomically", () => {
    const definitions = [{ name: "request_duration", help: "duration", type: "histogram" as const }];
    const histogram = [
      { name: "request_duration_bucket", labels: { route: "/", le: "1" }, value: 1 },
      { name: "request_duration_bucket", labels: { route: "/", le: "+Inf" }, value: 2 },
      { name: "request_duration_sum", labels: { route: "/" }, value: 1.5 },
      { name: "request_duration_count", labels: { route: "/" }, value: 2 },
    ];
    const limited = limitScrapeSamples(definitions, [
      ...histogram,
      { name: "other_1", value: 1 },
      { name: "other_2", value: 2 },
    ], 4);
    expect(limited.samples.filter((sample) => sample.name.startsWith("request_duration"))).toHaveLength(0);
    expect(limited.samples.at(-1)?.name).toBe(SCRAPE_DROPPED_SERIES_NAME);
  });
});
