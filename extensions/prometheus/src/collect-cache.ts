/**
 * 指标采集结果缓存，降低高频 scrape 对 Gateway RPC 的压力。
 */

import type { CollectorDiagnostic, MetricDefinition, MetricSample } from "./types.js";

export type CollectBundle = {
  definitions: MetricDefinition[];
  samples: MetricSample[];
  diagnostics: CollectorDiagnostic[];
  collectDurationSeconds?: number;
};

/**
 * 基于时间窗口的采集缓存。
 */
export class CollectCache {
  private last: CollectBundle | null = null;
  private lastAt = 0;

  /**
   * @param intervalMs - 0 表示禁用缓存（每次重新采集）
   */
  constructor(private readonly intervalMs: number) {}

  /**
   * 若缓存仍有效则返回缓存，否则调用 factory 并更新缓存。
   */
  async getOrCollect(factory: () => Promise<CollectBundle>): Promise<CollectBundle> {
    if (this.intervalMs <= 0) {
      return factory();
    }
    const now = Date.now();
    if (this.last && now - this.lastAt < this.intervalMs) {
      return this.last;
    }
    const bundle = await factory();
    this.last = bundle;
    this.lastAt = now;
    return bundle;
  }

  /** 测试或热更新配置时清空缓存 */
  invalidate(): void {
    this.last = null;
    this.lastAt = 0;
  }
}
