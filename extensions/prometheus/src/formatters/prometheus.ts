/**
 * Prometheus 文本格式序列化器
 * 将内部指标数据转换为 Prometheus exposition format
 * https://prometheus.io/docs/instrumenting/exposition_formats/
 */

import type { MetricDefinition, MetricSample } from "../types.js";

/**
 * 转义 label 值中的特殊字符
 */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * 预估 Prometheus 文本输出大小（用于预分配）
 * 粗略估算：每个 sample 约 name(40) + labels(60) + value(10) + TYPE/HELP 行 ≈ 150 bytes
 * 每个 definition 约 2 行 ≈ 80 bytes
 */
function estimateOutputSize(defCount: number, sampleCount: number): number {
  return defCount * 80 + sampleCount * 150 + 256;
}

/**
 * 将所有指标数据序列化为 Prometheus text format。
 *
 * 性能优化：
 * - 单次遍历 samples 按 name 分桶（用 Map<string,number[]> 记录索引）
 * - 预分配 string[] 避免动态扩容
 * - 减少中间对象创建
 */
export function formatPrometheus(
  definitions: MetricDefinition[],
  samples: MetricSample[],
): string {
  const parts: string[] = [];
  // 预分配：defCount * 3 lines + sampleCount lines + gaps
  parts.length = definitions.length * 3 + samples.length + definitions.length;

  // ─── 1. 按 name 分桶 samples（用索引数组避免创建子数组） ───
  const bucketStart = new Map<string, number[]>(); // name → [sampleIndex, ...]
  for (let i = 0; i < samples.length; i++) {
    const name = samples[i].name;
    let bucket = bucketStart.get(name);
    if (!bucket) {
      bucket = [];
      bucketStart.set(name, bucket);
    }
    bucket.push(i);
  }

  // ─── 2. 按 definition 顺序输出 ───
  let pi = 0; // parts index

  for (let di = 0; di < definitions.length; di++) {
    const def = definitions[di];

    // HELP + TYPE
    parts[pi++] = `# HELP ${def.name} ${def.help}`;
    parts[pi++] = `# TYPE ${def.name} ${def.type}`;

    // samples for this definition
    const indices = bucketStart.get(def.name);
    if (indices) {
      for (let j = 0; j < indices.length; j++) {
        const sample = samples[indices[j]];
        parts[pi++] = formatSampleLine(sample);
      }
    }

    parts[pi++] = ""; // blank line separator
  }

  // ─── 3. 输出未定义的样本（auto-discovered） ───
  const defNameSet = new Set<string>();
  for (let di = 0; di < definitions.length; di++) {
    defNameSet.add(definitions[di].name);
  }

  for (const [name, indices] of bucketStart) {
    if (defNameSet.has(name)) continue;
    parts[pi++] = `# HELP ${name} (auto-discovered)`;
    parts[pi++] = `# TYPE ${name} gauge`;
    for (let j = 0; j < indices.length; j++) {
      parts[pi++] = formatSampleLine(samples[indices[j]]);
    }
    parts[pi++] = "";
  }

  parts.length = pi;
  return parts.join("\n");
}

/**
 * 格式化单个样本为 Prometheus 行（热路径，内联优化）
 */
function formatSampleLine(sample: MetricSample): string {
  const labels = sample.labels;
  if (labels && Object.keys(labels).length > 0) {
    const labelParts: string[] = [];
    const keys = Object.keys(labels);
    for (let i = 0; i < keys.length; i++) {
      labelParts.push(`${keys[i]}="${escapeLabel(labels[keys[i]])}"`);
    }
    return `${sample.name}{${labelParts.join(",")}} ${sample.value}${sample.timestamp ? ` ${sample.timestamp}` : ""}`;
  }
  return `${sample.name} ${sample.value}${sample.timestamp ? ` ${sample.timestamp}` : ""}`;
}
