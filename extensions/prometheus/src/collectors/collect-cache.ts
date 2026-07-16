/**
 * 指标采集结果缓存，降低高频 scrape 对 Gateway RPC 的压力。
 */

import type { CollectorDiagnostic, MetricDefinition, MetricSample } from "../types.js";

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
  private inFlight: Promise<CollectBundle> | null = null;

  /**
   * @param intervalMs - 0 表示禁用缓存（每次重新采集）
   */
  constructor(private readonly intervalMs: number) {}

  /**
   * 若缓存仍有效则返回缓存，否则调用 factory 并更新缓存。
   */
  async getOrCollect(factory: () => Promise<CollectBundle>): Promise<CollectBundle> {
    const now = Date.now();
    if (this.intervalMs > 0 && this.last && now - this.lastAt < this.intervalMs) {
      return this.last;
    }
    if (this.inFlight) return this.inFlight;

    const pending = factory().then((bundle) => {
      this.last = bundle;
      this.lastAt = Date.now();
      return bundle;
    });
    this.inFlight = pending;
    try {
      return await pending;
    } finally {
      if (this.inFlight === pending) this.inFlight = null;
    }
  }

  /** 测试或热更新配置时清空缓存 */
  invalidate(): void {
    this.last = null;
    this.lastAt = 0;
  }
}
