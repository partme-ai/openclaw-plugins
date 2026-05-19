/**
 * JSON 格式序列化器
 * 将指标数据转换为结构化 JSON
 */

import type { CollectorDiagnostic, MetricDefinition, MetricSample } from "../types.js";

/**
 * JSON 指标输出结构
 */
export interface JsonMetricsOutput {
  /** 采集时间 */
  timestamp: string;
  meta?: {
    rpc?: {
      initialized: boolean;
      lastSuccessAt: string | null;
      lastMethod: string | null;
      lastError: string | null;
    };
    collectors?: {
      total: number;
      failed: number;
    };
  };
  diagnostics?: CollectorDiagnostic[];
  /** 指标列表 */
  metrics: Array<{
    name: string;
    help: string;
    type: string;
    samples: Array<{
      labels?: Record<string, string>;
      value: number;
    }>;
  }>;
}

/**
 * 将所有指标数据序列化为 JSON 格式
 *
 * @param definitions - 指标定义列表
 * @param samples - 指标样本列表
 * @returns 结构化 JSON 对象
 */
export function formatJson(
  definitions: MetricDefinition[],
  samples: MetricSample[],
  diagnostics: CollectorDiagnostic[] = [],
  meta?: JsonMetricsOutput["meta"],
): JsonMetricsOutput {
  // 按指标名分组样本
  const samplesByName = new Map<string, MetricSample[]>();
  for (const sample of samples) {
    const existing = samplesByName.get(sample.name) ?? [];
    existing.push(sample);
    samplesByName.set(sample.name, existing);
  }

  return {
    timestamp: new Date().toISOString(),
    ...(meta ? { meta } : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    metrics: definitions.map((def) => ({
      name: def.name,
      help: def.help,
      type: def.type,
      samples: (samplesByName.get(def.name) ?? []).map((s) => ({
        ...(s.labels && Object.keys(s.labels).length > 0 ? { labels: s.labels } : {}),
        value: s.value,
      })),
    })),
  };
}
