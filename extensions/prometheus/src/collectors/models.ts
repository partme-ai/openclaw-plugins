/**
 * Model 指标采集器
 *
 * 数据来源：Gateway `models.list` RPC 方法
 * 返回所有已配置/可用的模型列表。
 *
 * 从真实数据中提取：
 * - 模型总数
 * - 按 Provider 分布
 */

import type { MetricCollector, MetricDefinition, MetricSample } from "../types.js";
import { rpcCall } from "../runtime/ws-bridge.js";

const PREFIX = "openclaw_model";

/**
 * Model 采集器
 * 调用 Gateway `models.list` RPC
 */
export class ModelCollector implements MetricCollector {
  name = "models";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_total`, help: "Total available models", type: "gauge" },
    { name: `${PREFIX}_by_provider`, help: "Models per provider", type: "gauge", labels: ["provider"] },
  ];

  /**
   * 采集 Model 指标
   */
  async collect(): Promise<MetricSample[]> {
    const samples: MetricSample[] = [];
    const result = await rpcCall<unknown>("models.list");

    // models.list 可能返回数组或 { models: [...] }
    let models: Array<Record<string, unknown>> = [];
    if (Array.isArray(result)) {
      models = result;
    } else if (result && typeof result === "object") {
      const obj = result as Record<string, unknown>;
      if (Array.isArray(obj.models)) models = obj.models;
    }

    samples.push({ name: `${PREFIX}_total`, value: models.length });

    // 按 provider 分组
    const byProvider: Record<string, number> = {};
    for (const m of models) {
      // 模型 ID 格式通常为 "provider/model-name"
      const id = (m.id as string) ?? (m.name as string) ?? "";
      const provider = (m.provider as string) ?? id.split("/")[0] ?? "unknown";
      byProvider[provider] = (byProvider[provider] ?? 0) + 1;
    }

    for (const [provider, count] of Object.entries(byProvider)) {
      samples.push({ name: `${PREFIX}_by_provider`, labels: { provider }, value: count });
    }

    return samples;
  }
}
