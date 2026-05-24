/**
 * Presence 指标采集器
 *
 * 数据来源：Gateway `system-presence` RPC 方法
 * 返回当前连接的客户端/节点列表。
 *
 * 从真实数据中提取：
 * - 已连接客户端总数
 * - 按平台分布（macos, linux, windows, ios, android, ...）
 * - 按角色分布（operator, node）
 */

import type { MetricCollector, MetricDefinition, MetricSample, PresenceEntry } from "../types.js";
import { rpcCall } from "../runtime/ws-bridge.js";

const PREFIX = "openclaw_presence";

/**
 * Presence 采集器
 * 调用 Gateway `system-presence` RPC
 */
export class PresenceCollector implements MetricCollector {
  name = "presence";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_total`, help: "Active presence sessions", type: "gauge" },
    { name: `${PREFIX}_by_channel`, help: "Presence by channel", type: "gauge", labels: ["channel"] },
  ];

  /**
   * 采集 Presence 指标
   * 从 system-presence 真实响应中解析
   */
  async collect(): Promise<MetricSample[]> {
    const samples: MetricSample[] = [];
    const result = await rpcCall<unknown>("system-presence");

    // system-presence 可能返回数组或 { entries: [...] } 或 { presence: [...] }
    let entries: PresenceEntry[] = [];
    if (Array.isArray(result)) {
      entries = result;
    } else if (result && typeof result === "object") {
      const obj = result as Record<string, unknown>;
      if (Array.isArray(obj.entries)) entries = obj.entries;
      else if (Array.isArray(obj.presence)) entries = obj.presence;
    }

    samples.push({ name: `${PREFIX}_total`, value: entries.length });

    const byChannel: Record<string, number> = {};
    for (const entry of entries) {
      const channel = String(entry.platform ?? "unknown");
      byChannel[channel] = (byChannel[channel] ?? 0) + 1;
    }
    for (const [channel, count] of Object.entries(byChannel)) {
      samples.push({ name: `${PREFIX}_by_channel`, labels: { channel }, value: count });
    }

    return samples;
  }
}
