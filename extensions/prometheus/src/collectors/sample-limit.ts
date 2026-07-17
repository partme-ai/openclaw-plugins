import type { MetricDefinition, MetricSample } from "../types.js";

/** 单次 scrape 因最终系列上限而被省略的原始系列数量。 */
export const SCRAPE_DROPPED_SERIES_NAME =
  "openclaw_metrics_scrape_series_dropped";

/**
 * 对最终 Prometheus 响应实施硬系列上限。
 *
 * 上限不仅覆盖 diagnostics/runtime registry，也覆盖 RPC 采集器产生的样本。发生截断时会
 * 预留最后一个位置输出 dropped 指标，因此 `dropped` 包含被该元指标替换掉的那个原始系列。
 * 这里保持输入数组不变，避免缓存中的完整采集结果被一次低上限响应污染。
 */
export function limitScrapeSamples(
  definitions: MetricDefinition[],
  samples: MetricSample[],
  maximum: number,
): { definitions: MetricDefinition[]; samples: MetricSample[] } {
  if (samples.length <= maximum) return { definitions, samples };
  const histogramSampleNames = new Map<string, string>();
  for (const definition of definitions) {
    if (definition.type !== "histogram") continue;
    for (const name of [definition.name, `${definition.name}_bucket`, `${definition.name}_sum`, `${definition.name}_count`]) {
      histogramSampleNames.set(name, definition.name);
    }
  }

  type SampleGroup = { samples: MetricSample[]; priority: boolean; order: number };
  const groups = new Map<string, SampleGroup>();
  samples.forEach((sample, index) => {
    const histogram = histogramSampleNames.get(sample.name);
    const labels = histogram
      ? Object.entries(sample.labels ?? {}).filter(([name]) => name !== "le").sort(([a], [b]) => a.localeCompare(b))
      : [];
    // Histogram 的 bucket/sum/count 必须作为一个标签组整体保留或整体丢弃，否则 Prometheus 会看到残缺分布。
    const key = histogram ? `histogram:${histogram}:${JSON.stringify(labels)}` : `sample:${index}`;
    const metricName = histogram ?? sample.name;
    const existing = groups.get(key);
    if (existing) {
      existing.samples.push(sample);
      return;
    }
    groups.set(key, {
      samples: [sample],
      priority: isExporterHealthMetric(metricName),
      order: index,
    });
  });

  const orderedGroups = [...groups.values()].sort((left, right) =>
    Number(right.priority) - Number(left.priority) || left.order - right.order);
  const kept: MetricSample[] = [];
  const capacity = Math.max(0, maximum - 1);
  for (const group of orderedGroups) {
    if (kept.length + group.samples.length <= capacity) kept.push(...group.samples);
  }
  const dropped = samples.length - kept.length;
  return {
    definitions: [
      ...definitions,
      {
        name: SCRAPE_DROPPED_SERIES_NAME,
        help: "Metric series omitted from this scrape because maxScrapeSeries was reached",
        type: "gauge",
      },
    ],
    samples: [
      ...kept,
      { name: SCRAPE_DROPPED_SERIES_NAME, value: dropped },
    ],
  };
}

/** 过载截断时优先保留 exporter 自身存活、采集失败和耗时信号，便于告警解释缺失数据。 */
function isExporterHealthMetric(name: string): boolean {
  return name === "openclaw_up" ||
    name === "openclaw_ready" ||
    name === "openclaw_exporter_build_info" ||
    name === "openclaw_metrics_collector_success" ||
    name === "openclaw_metrics_collect_errors_total" ||
    name === "openclaw_metrics_last_scrape_duration_seconds";
}
