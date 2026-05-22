/**
 * 将 diagnostics store 快照转换为通用 MetricCollector 输出（JSON /detailed 端点）。
 */

import type { MetricCollector, MetricDefinition, MetricSample } from "../types.js";
import type { MetricSnapshot } from "./metric-store.js";
import { getDiagnosticsMetricStore } from "./subscribe.js";

/**
 * 从 diagnostics 内存 store 采集指标（counter/gauge + histogram 展开为 bucket/sum/count）。
 */
export class DiagnosticsCollector implements MetricCollector {
  name = "diagnostics";

  get definitions(): MetricDefinition[] {
    return snapshotToMetricBundle(getDiagnosticsMetricStore().snapshot()).definitions;
  }

  async collect(): Promise<MetricSample[]> {
    return snapshotToMetricBundle(getDiagnosticsMetricStore().snapshot()).samples;
  }
}

/**
 * 将 diagnostics 快照转为 definitions + samples，供 JSON 导出与合并采集。
 */
export function snapshotToMetricBundle(snapshot: MetricSnapshot): {
  definitions: MetricDefinition[];
  samples: MetricSample[];
} {
  const definitions: MetricDefinition[] = [];
  const samples: MetricSample[] = [];
  const seenDefs = new Set<string>();

  const ensureDef = (name: string, help: string, type: MetricDefinition["type"]) => {
    if (seenDefs.has(name)) {
      return;
    }
    seenDefs.add(name);
    definitions.push({ name, help, type });
  };

  const counterKeys = [...snapshot.counters.keys()].toSorted((a, b) => a.localeCompare(b));
  for (const key of counterKeys) {
    const sample = snapshot.counters.get(key);
    if (!sample) {
      continue;
    }
    const name = key.split("|", 1)[0] ?? "";
    ensureDef(name, sample.help, "counter");
    samples.push({
      name,
      value: sample.value,
      ...(Object.keys(sample.labels).length > 0 ? { labels: { ...sample.labels } } : {}),
    });
  }

  const gaugeKeys = [...snapshot.gauges.keys()].toSorted((a, b) => a.localeCompare(b));
  for (const key of gaugeKeys) {
    const sample = snapshot.gauges.get(key);
    if (!sample) {
      continue;
    }
    const name = key.split("|", 1)[0] ?? "";
    ensureDef(name, sample.help, "gauge");
    samples.push({
      name,
      value: sample.value,
      ...(Object.keys(sample.labels).length > 0 ? { labels: { ...sample.labels } } : {}),
    });
  }

  const histKeys = [...snapshot.histograms.keys()].toSorted((a, b) => a.localeCompare(b));
  for (const key of histKeys) {
    const sample = snapshot.histograms.get(key);
    if (!sample) {
      continue;
    }
    const name = key.split("|", 1)[0] ?? "";
    ensureDef(name, sample.help, "histogram");

    for (let index = 0; index < sample.buckets.length; index += 1) {
      const bucket = sample.buckets[index];
      if (bucket === undefined) {
        continue;
      }
      samples.push({
        name: `${name}_bucket`,
        value: sample.counts[index] ?? 0,
        labels: { ...sample.labels, le: String(bucket) },
      });
    }
    samples.push({
      name: `${name}_bucket`,
      value: sample.count,
      labels: { ...sample.labels, le: "+Inf" },
    });
    samples.push({
      name: `${name}_sum`,
      value: sample.sum,
      ...(Object.keys(sample.labels).length > 0 ? { labels: { ...sample.labels } } : {}),
    });
    samples.push({
      name: `${name}_count`,
      value: sample.count,
      ...(Object.keys(sample.labels).length > 0 ? { labels: { ...sample.labels } } : {}),
    });
  }

  return { definitions, samples };
}
