/**
 * Skills 指标采集器
 *
 * 数据来源：Gateway `skills.status` + `skills.bins` RPC 方法
 * 返回已安装 Skill 的状态和二进制列表。
 *
 * 从真实数据中提取：
 * - Skill 总数
 * - 已安装二进制数
 */

import type { MetricCollector, MetricDefinition, MetricSample } from "../types.js";
import { rpcCall } from "../runtime/ws-bridge.js";

const PREFIX = "openclaw_skill";

/**
 * Skill 采集器
 * 调用 skills.status 和 skills.bins RPC
 */
export class SkillCollector implements MetricCollector {
  name = "skills";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_total`, help: "Total registered skills", type: "gauge" },
    { name: `${PREFIX}_active_total`, help: "Active skills", type: "gauge" },
    { name: `${PREFIX}_by_category`, help: "Skills per category", type: "gauge", labels: ["category"] },
  ];

  /**
   * 采集 Skill 指标
   */
  async collect(): Promise<MetricSample[]> {
    const statusResult = await rpcCall<unknown>("skills.status");

    const samples: MetricSample[] = [];
    const statusObj = statusResult && typeof statusResult === "object"
      ? (statusResult as Record<string, unknown>)
      : {};
    const skills = Array.isArray(statusObj.skills)
      ? (statusObj.skills as Array<Record<string, unknown>>)
      : [];
    const skillCount = typeof statusObj.count === "number" ? statusObj.count : skills.length;
    const enabledCount = skills.filter((skill) => skill.disabled !== true).length;

    samples.push({ name: `${PREFIX}_total`, value: skillCount });
    samples.push({ name: `${PREFIX}_active_total`, value: enabledCount });

    const byCategory: Record<string, number> = {};
    for (const skill of skills) {
      const category = String((skill as Record<string, unknown>).category ?? "unknown");
      byCategory[category] = (byCategory[category] ?? 0) + 1;
    }
    for (const [category, count] of Object.entries(byCategory)) {
      samples.push({ name: `${PREFIX}_by_category`, labels: { category }, value: count });
    }

    return samples;
  }
}
