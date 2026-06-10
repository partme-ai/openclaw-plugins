/**
 * Log 后端
 * 将 Span 以 JSON 格式输出到 console.log
 *
 * 适用场景：
 * - 开发和调试环境
 * - 日志聚合系统（如 ELK）已配置 stdout 采集
 */

import type { TracingBackend, TracingConfig, Span } from "../shared/types.js";

/**
 * Console Log 追踪后端
 * 将每个完成的 Span 输出为一行 JSON 到 stdout
 */
export class LogBackend implements TracingBackend {
  name = "log";

  /** 是否输出紧凑 JSON（默认 true） */
  private compact = true;

  /**
   * 初始化 Log 后端
   */
  async init(_config: TracingConfig): Promise<void> {
    console.log("[openclaw-tracing] Log backend initialized");
  }

  /**
   * 导出 Span 到 console.log
   * 每个 Span 输出为一行 JSON，方便日志聚合工具解析
   *
   * @param spans - 待输出的 Span 列表
   */
  async exportSpans(spans: Span[]): Promise<void> {
    for (const span of spans) {
      const output = {
        _type: "openclaw_trace",
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        name: span.name,
        kind: span.kind,
        status: span.status,
        startTimeMs: span.startTimeMs,
        endTimeMs: span.endTimeMs,
        durationMs: span.endTimeMs ? span.endTimeMs - span.startTimeMs : undefined,
        attributes: span.attributes,
        events: span.events.length > 0 ? span.events : undefined,
      };

      if (this.compact) {
        console.log(JSON.stringify(output));
      } else {
        console.log(JSON.stringify(output, null, 2));
      }
    }
  }

  /**
   * 关闭后端（Log 无需特殊关闭操作）
   */
  async shutdown(): Promise<void> {
    console.log("[openclaw-tracing] Log backend shutdown");
  }
}
