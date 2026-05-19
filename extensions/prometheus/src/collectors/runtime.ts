/**
 * Node.js 运行时指标采集器
 * 采集进程级指标：内存、CPU、事件循环延迟
 */

import type { MetricCollector, MetricDefinition, MetricSample } from "../types.js";

const PREFIX = "openclaw_nodejs";

/**
 * 运行时采集器
 * 采集 Node.js 进程级别的资源使用指标（堆、RSS、`arrayBuffers`、事件环延迟、累计 CPU 时间）。
 */
export class RuntimeCollector implements MetricCollector {
  name = "runtime";

  definitions: MetricDefinition[] = [
    { name: `${PREFIX}_heap_used_bytes`, help: "Node.js heap used in bytes", type: "gauge" },
    { name: `${PREFIX}_heap_total_bytes`, help: "Node.js heap total in bytes", type: "gauge" },
    { name: `${PREFIX}_external_bytes`, help: "Node.js external memory in bytes", type: "gauge" },
    {
      name: `${PREFIX}_array_buffers_bytes`,
      help: "Node.js memoryUsage.arrayBuffers (if available)",
      type: "gauge",
    },
    { name: `${PREFIX}_rss_bytes`, help: "Resident set size in bytes", type: "gauge" },
    { name: `${PREFIX}_event_loop_lag_ms`, help: "Event loop lag in milliseconds", type: "gauge" },
    { name: `${PREFIX}_uptime_seconds`, help: "Node.js process uptime", type: "gauge" },
    {
      name: `${PREFIX}_process_cpu_user_seconds_total`,
      help: "Cumulative CPU user time for this process (seconds)",
      type: "counter",
    },
    {
      name: `${PREFIX}_process_cpu_system_seconds_total`,
      help: "Cumulative CPU system time for this process (seconds)",
      type: "counter",
    },
  ];

  /** 事件循环延迟测量值 */
  private eventLoopLag = 0;
  /** 上次事件循环检测时间 */
  private lastCheck = Date.now();
  /** 定时器引用 */
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 是否已销毁 */
  private _disposed = false;

  constructor() {
    this.startEventLoopMeasure();
  }

  /**
   * 停止事件循环测量并清理定时器。
   * 插件热更新或 reload 时应调用此方法，避免内存泄漏。
   */
  dispose(): void {
    this._disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * 启动事件循环延迟测量
   * 每 100ms 检查一次实际经过时间与预期的差值
   */
  private startEventLoopMeasure(): void {
    const measure = () => {
      if (this._disposed) return;
      const now = Date.now();
      const expected = 100;
      const actual = now - this.lastCheck;
      this.eventLoopLag = Math.max(0, actual - expected);
      this.lastCheck = now;
      this.timer = setTimeout(measure, expected);
    };
    this.timer = setTimeout(measure, 100);
  }

  /**
   * 采集运行时指标：内存与 `process.cpuUsage()` 的累计用户/系统时间（秒）。
   */
  async collect(): Promise<MetricSample[]> {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const arrayBuffers =
      typeof mem.arrayBuffers === "number" && Number.isFinite(mem.arrayBuffers) ? mem.arrayBuffers : 0;

    return [
      { name: `${PREFIX}_heap_used_bytes`, value: mem.heapUsed },
      { name: `${PREFIX}_heap_total_bytes`, value: mem.heapTotal },
      { name: `${PREFIX}_external_bytes`, value: mem.external },
      { name: `${PREFIX}_array_buffers_bytes`, value: arrayBuffers },
      { name: `${PREFIX}_rss_bytes`, value: mem.rss },
      { name: `${PREFIX}_event_loop_lag_ms`, value: this.eventLoopLag },
      { name: `${PREFIX}_uptime_seconds`, value: process.uptime() },
      { name: `${PREFIX}_process_cpu_user_seconds_total`, value: cpu.user / 1e6 },
      { name: `${PREFIX}_process_cpu_system_seconds_total`, value: cpu.system / 1e6 },
    ];
  }
}
