import { describe, expect, it, vi } from "vitest";
import { CollectCache } from "../src/collectors/collect-cache.js";
import { CollectorRunner } from "../src/collectors/collector-runner.js";
import { limitScrapeSamples, SCRAPE_DROPPED_SERIES_NAME } from "../src/collectors/sample-limit.js";
import type { MetricCollector } from "../src/types.js";

describe("Prometheus collection guardrails", () => {
  it("coalesces concurrent cache misses even when interval caching is disabled", async () => {
    const cache = new CollectCache(0);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const factory = vi.fn(async () => {
      await gate;
      return { definitions: [], samples: [], diagnostics: [] };
    });

    const scrapes = Array.from({ length: 100 }, () => cache.getOrCollect(factory));
    expect(factory).toHaveBeenCalledTimes(1);
    release();
    const results = await Promise.all(scrapes);
    expect(new Set(results).size).toBe(1);
  });

  it("times out a hung collector without starting duplicate underlying calls", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const collect = vi.fn(async () => {
      await gate;
      return [];
    });
    const collector: MetricCollector = { name: "hung", definitions: [], collect };
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
    const samples = Array.from({ length: 12 }, (_, index) => ({ name: `metric_${index}`, value: index }));
    const limited = limitScrapeSamples([], samples, 10);
    expect(limited.samples).toHaveLength(10);
    expect(limited.samples.at(-1)).toEqual({ name: SCRAPE_DROPPED_SERIES_NAME, value: 3 });
    expect(limited.definitions.at(-1)?.name).toBe(SCRAPE_DROPPED_SERIES_NAME);
  });
});
