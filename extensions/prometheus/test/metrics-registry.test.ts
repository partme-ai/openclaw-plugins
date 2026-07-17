import { describe, expect, it } from "vitest";
import {
  MAX_RUNTIME_METRIC_SERIES,
  MetricsRegistry,
} from "../src/diagnostics/metrics-registry.js";

describe("MetricsRegistry", () => {
  it("keeps counters monotonic and gauges non-negative", () => {
    const registry = new MetricsRegistry();
    registry.inc("requests_total", 2, { help: "requests", type: "counter" });
    registry.inc("requests_total", 3, { help: "requests", type: "counter" });
    registry.dec("inflight", 1, { help: "inflight" });

    expect(registry.getSampleValue("requests_total")).toBe(5);
    expect(registry.getSampleValue("inflight")).toBe(0);
  });

  it("caps label cardinality and exposes a dropped-series counter", () => {
    const registry = new MetricsRegistry();
    for (let index = 0; index < MAX_RUNTIME_METRIC_SERIES + 2; index += 1) {
      registry.set("dynamic_metric", 1, {
        help: "dynamic",
        labels: { id: String(index) },
      });
    }

    expect(registry.snapshotSamples()).toHaveLength(MAX_RUNTIME_METRIC_SERIES + 1);
    expect(registry.getSampleValue("dynamic_metric", { id: String(MAX_RUNTIME_METRIC_SERIES) })).toBe(0);
    expect(registry.snapshotSamples()).toContainEqual({
      name: "openclaw_runtime_metric_series_dropped_total",
      value: 2,
    });
  });

  it("copies, redacts and bounds labels at the registry boundary", () => {
    const registry = new MetricsRegistry();
    const labels = {
      provider: `Bearer top-secret-token\n${"x".repeat(200)}`,
    };
    registry.set("secured_metric", 1, { help: "secured", labels });
    labels.provider = "mutated-after-set";

    const sample = registry.snapshotSamples().find((entry) => entry.name === "secured_metric");
    expect(sample?.labels?.provider).not.toContain("top-secret-token");
    expect(sample?.labels?.provider).not.toContain("\n");
    expect(sample?.labels?.provider.length).toBeLessThanOrEqual(128);
    expect(sample?.labels?.provider).not.toBe("mutated-after-set");
    expect(registry.getSampleValue("secured_metric", {
      provider: `Bearer top-secret-token\n${"x".repeat(200)}`,
    })).toBe(1);
  });
});
