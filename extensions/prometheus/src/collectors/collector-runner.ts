import type { MetricCollector, MetricSample } from "../types.js";

/**
 * 单采集器执行保护器。
 *
 * Prometheus HA、副本重试或人工探测可能同时触发多次 scrape。如果某个 Gateway RPC
 * 已经卡住，直接为每次 scrape 再创建一次调用会持续放大宿主压力。因此这里按采集器实例
 * 保存底层 Promise：每次 HTTP 请求只限制自己的等待时间，但共享尚未完成的真实采集任务。
 * 超时不会伪装成取消；底层任务结束后才从 `inFlight` 删除，下一轮才能重新发起采集。
 */
export class CollectorRunner {
  /** 当前仍在执行的底层采集任务；键使用稳定的 collector 实例而不是名称。 */
  private readonly inFlight = new Map<
    MetricCollector,
    Promise<MetricSample[]>
  >();

  /**
   * 执行或复用一次采集，并为当前 scrape 设置独立超时边界。
   *
   * @param collector - 要执行的指标采集器。
   * @param timeoutMs - 当前 HTTP scrape 最多等待该采集器的毫秒数。
   * @returns 采集器返回的指标样本。
   * @throws 超时或采集器自身异常；由上层 `Promise.allSettled` 做逐采集器故障隔离。
   */
  async run(
    collector: MetricCollector,
    timeoutMs: number,
  ): Promise<MetricSample[]> {
    let operation = this.inFlight.get(collector);
    if (!operation) {
      operation = Promise.resolve().then(() => collector.collect());
      this.inFlight.set(collector, operation);
      operation.then(
        () => this.deleteIfCurrent(collector, operation!),
        () => this.deleteIfCurrent(collector, operation!),
      );
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `collector ${collector.name} timed out after ${timeoutMs}ms`,
                ),
              ),
            timeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 清空运行代际引用，供插件 reload/stop 使用。
   * 已发出的宿主 RPC 不能由当前 SDK 主动取消，但其完成回调不会删除新代际任务。
   */
  clear(): void {
    this.inFlight.clear();
  }

  /** 只有 Promise 仍属于当前采集器时才删除，避免旧代际回调覆盖新任务。 */
  private deleteIfCurrent(
    collector: MetricCollector,
    operation: Promise<MetricSample[]>,
  ): void {
    if (this.inFlight.get(collector) === operation)
      this.inFlight.delete(collector);
  }
}
