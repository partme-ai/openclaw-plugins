/**
 * Node 指标采集器
 *
 * 数据来源：Gateway `node.list` RPC 方法
 * 返回已配对/已连接的 IoT 设备节点列表。
 *
 * 从真实数据中提取：
 * - 节点总数、已连接/已配对数
 * - 按平台分布
 * - 按能力 (capabilities) 分布
 */

import type { MetricCollector, MetricDefinition, MetricSample } from "../types.js";
import { rpcCall } from "../ws-bridge.js";

const PREFIX = "openclaw_node";

/**
 * Node 采集器
 * 调用 Gateway `node.list` RPC
 */
export class NodeCollector implements MetricCollector {
  name = "nodes";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_total`, help: "Total paired nodes", type: "gauge" },
    { name: `${PREFIX}_connected`, help: "Currently connected nodes", type: "gauge" },
    { name: `${PREFIX}_by_platform`, help: "Nodes per platform", type: "gauge", labels: ["platform"] },
  ];

  /**
   * 采集 Node 指标
   */
  async collect(): Promise<MetricSample[]> {
    const samples: MetricSample[] = [];
    const result = await rpcCall<unknown>("node.list");

    let nodes: Array<Record<string, unknown>> = [];
    if (Array.isArray(result)) {
      nodes = result;
    } else if (result && typeof result === "object") {
      const obj = result as Record<string, unknown>;
      if (Array.isArray(obj.nodes)) nodes = obj.nodes;
    }

    const connectedCount = nodes.filter((n) => n.connected).length;

    samples.push({ name: `${PREFIX}_total`, value: nodes.length });
    samples.push({ name: `${PREFIX}_connected`, value: connectedCount });

    // 按平台
    const byPlatform: Record<string, number> = {};
    for (const n of nodes) {
      const platform = (n.platform as string) ?? (n.deviceFamily as string) ?? "unknown";
      byPlatform[platform] = (byPlatform[platform] ?? 0) + 1;
    }
    for (const [platform, count] of Object.entries(byPlatform)) {
      samples.push({ name: `${PREFIX}_by_platform`, labels: { platform }, value: count });
    }

    return samples;
  }
}
