import type { MetricCollector, MetricSample } from "../types.js";

/** Prevent duplicate hung collector calls while bounding each scrape wait. */
export class CollectorRunner {
  private readonly inFlight = new Map<MetricCollector, Promise<MetricSample[]>>();

  async run(collector: MetricCollector, timeoutMs: number): Promise<MetricSample[]> {
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
            () => reject(new Error(`collector ${collector.name} timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  clear(): void {
    this.inFlight.clear();
  }

  private deleteIfCurrent(collector: MetricCollector, operation: Promise<MetricSample[]>): void {
    if (this.inFlight.get(collector) === operation) this.inFlight.delete(collector);
  }
}
