/**
 * OTLP HTTP 后端
 * 通过 OTLP HTTP 协议导出 Span 到 Jaeger / Tempo / Collector
 *
 * 协议规范：
 * - OpenTelemetry Protocol (OTLP) over HTTP/JSON
 * - POST /V1/traces
 * - Content-Type: application/json
 *
 * 特性：
 * - 批量导出（减少网络请求）
 * - 自动重试（网络失败）
 * - 降级到内存缓冲（endpoint 不可达时）
 */

import type { TracingBackend, TracingConfig, Span } from "../shared/types.js";

/** 默认 OTLP endpoint */
const DEFAULT_ENDPOINT = "http://localhost:4318";

/** 批量发送阈值 */
const BATCH_SIZE = 50;

/** 批量发送间隔（毫秒） */
const BATCH_INTERVAL = 10_000;

/** 发送超时（毫秒） */
const SEND_TIMEOUT = 10_000;

/** 最大重试次数 */
const MAX_RETRIES = 3;

/**
 * OTLP HTTP 追踪后端
 * 通过 HTTP JSON 格式导出到 OpenTelemetry Collector
 */
export class OtlpBackend implements TracingBackend {
  name = "otlp";

  /** OTLP 端点 URL */
  private endpoint: string = DEFAULT_ENDPOINT;

  /** 待发送缓冲 */
  private buffer: Span[] = [];

  /** 批量发送定时器 */
  private batchTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 初始化 OTLP 后端
   */
  async init(config: TracingConfig): Promise<void> {
    this.endpoint = config.otlpEndpoint || DEFAULT_ENDPOINT;

    // 启动批量发送定时器
    this.batchTimer = setInterval(() => {
      this.sendBatch().catch((err) => {
        console.error("[openclaw-tracing] OTLP batch send error:", err);
      });
    }, BATCH_INTERVAL);

    console.log(`[openclaw-tracing] OTLP backend initialized: ${this.endpoint}`);
  }

  /**
   * 导出 Span 到缓冲
   * 达到批量阈值时自动触发发送
   *
   * @param spans - 待导出的 Span 列表
   */
  async exportSpans(spans: Span[]): Promise<void> {
    this.buffer.push(...spans);

    // 达到阈值时立即发送
    if (this.buffer.length >= BATCH_SIZE) {
      await this.sendBatch();
    }
  }

  /**
   * 关闭后端
   * 停止定时器并发送剩余数据
   */
  async shutdown(): Promise<void> {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }

    // 发送剩余数据
    await this.sendBatch();
    console.log("[openclaw-tracing] OTLP backend shutdown");
  }

  /**
   * 批量发送 Span 到 OTLP Collector
   * 将内部 Span 格式转换为 OTLP JSON 格式
   */
  private async sendBatch(): Promise<void> {
    if (this.buffer.length === 0) return;

    // 取出当前缓冲
    const spans = this.buffer.splice(0);

    // 转换为 OTLP 格式
    const otlpPayload = this.toOtlpPayload(spans);

    // 发送
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SEND_TIMEOUT);

        const response = await fetch(`${this.endpoint}/v1/traces`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(otlpPayload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          return; // 发送成功
        }

        lastError = new Error(`OTLP HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        lastError = error as Error;
      }

      // 指数退避重试
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }

    // 全部重试失败，将数据放回缓冲
    console.error(
      `[openclaw-tracing] OTLP send failed after ${MAX_RETRIES} retries:`,
      lastError?.message
    );
    this.buffer.unshift(...spans);
  }

  /**
   * 将内部 Span 格式转换为 OTLP JSON 格式
   * 参考 OpenTelemetry proto3 定义
   *
   * @param spans - 内部 Span 列表
   * @returns OTLP ExportTraceServiceRequest
   */
  private toOtlpPayload(spans: Span[]): Record<string, unknown> {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "openclaw-gateway" } },
              { key: "service.version", value: { stringValue: "1.0.0" } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "openclaw-tracing", version: "0.1.0" },
              spans: spans.map((span) => this.toOtlpSpan(span)),
            },
          ],
        },
      ],
    };
  }

  /**
   * 转换单个 Span 为 OTLP 格式
   */
  private toOtlpSpan(span: Span): Record<string, unknown> {
    const SPAN_KIND_MAP: Record<string, number> = {
      internal: 1,
      server: 2,
      client: 3,
      producer: 4,
      consumer: 5,
    };

    const STATUS_CODE_MAP: Record<string, number> = {
      unset: 0,
      ok: 1,
      error: 2,
    };

    return {
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId ?? "",
      name: span.name,
      kind: SPAN_KIND_MAP[span.kind] ?? 1,
      startTimeUnixNano: String(span.startTimeMs * 1_000_000),
      endTimeUnixNano: span.endTimeMs ? String(span.endTimeMs * 1_000_000) : undefined,
      attributes: Object.entries(span.attributes).map(([key, value]) => ({
        key,
        value: typeof value === "string"
          ? { stringValue: value }
          : typeof value === "number"
            ? { intValue: String(value) }
            : { boolValue: value },
      })),
      status: { code: STATUS_CODE_MAP[span.status] ?? 0 },
      events: span.events.map((event) => ({
        name: event.name,
        timeUnixNano: String(event.timestampMs * 1_000_000),
        attributes: event.attributes
          ? Object.entries(event.attributes).map(([key, value]) => ({
              key,
              value: typeof value === "string"
                ? { stringValue: value }
                : typeof value === "number"
                  ? { intValue: String(value) }
                  : { boolValue: value },
            }))
          : [],
      })),
    };
  }
}
