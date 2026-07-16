/**
 * @fileoverview Trace Span 的 OTLP/HTTP JSON 导出后端。
 *
 * 将内部 Span 转换为 OpenTelemetry ResourceSpans，按批次串行发送，并设置请求超时、有限
 * 指数退避和有界缓冲。失败批次会重新入队；缓冲溢出丢弃最旧数据并暴露 droppedSpans，
 * 关闭时必须排空队列，避免静默丢失最后一批追踪数据。
 */
import type {
  Span,
  TracingBackend,
  TracingBackendStatus,
  TracingConfig,
  TracingLogger,
} from "../shared/types.js";

const BATCH_SIZE = 50;

/** OTLP/HTTP JSON 后端；支持有界缓冲、串行发送、超时和重试。 */
export class OtlpBackend implements TracingBackend {
  readonly name = "otlp";
  private endpoint = "http://localhost:4318/v1/traces";
  private maxBufferedSpans = 10_000;
  private timeoutMs = 10_000;
  private retryAttempts = 3;
  private buffer: Span[] = [];
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private flushPromise: Promise<void> | null = null;
  private status: TracingBackendStatus = {
    healthy: true,
    bufferedSpans: 0,
    droppedSpans: 0,
  };

  constructor(private readonly logger: TracingLogger) {}

  async init(config: TracingConfig): Promise<void> {
    this.endpoint = config.otlpEndpoint;
    this.maxBufferedSpans = config.maxBufferedSpans;
    this.timeoutMs = config.exportTimeoutMs;
    this.retryAttempts = config.exportRetryAttempts;
    this.batchTimer = setInterval(() => {
      void this.flush().catch((error: unknown) => {
        this.logger.error(`[tracing] OTLP export failed: ${toErrorMessage(error)}`);
      });
    }, config.flushIntervalMs);
    this.batchTimer.unref?.();
    this.logger.info(`[tracing] OTLP backend initialized: ${this.endpoint}`);
  }

  async exportSpans(spans: Span[]): Promise<void> {
    this.buffer.push(...spans.map(cloneSpan));
    this.enforceBufferLimit();
    if (this.buffer.length >= BATCH_SIZE) {
      await this.flush();
    }
  }

  getStatus(): TracingBackendStatus {
    return { ...this.status, bufferedSpans: this.buffer.length };
  }

  async shutdown(): Promise<void> {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
    await this.flush();
    if (this.buffer.length > 0) {
      throw new Error(`OTLP backend shutdown with ${this.buffer.length} unsent spans`);
    }
    this.logger.info("[tracing] OTLP backend shut down");
  }

  private flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.flushInternal().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  private async flushInternal(): Promise<void> {
    if (this.buffer.length === 0) return;
    const spans = this.buffer.splice(0);
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      try {
        await this.send(spans);
        this.status = {
          ...this.status,
          healthy: true,
          bufferedSpans: this.buffer.length,
          lastExportAt: Date.now(),
          lastError: undefined,
        };
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.retryAttempts) {
          await delay(Math.min(250 * 2 ** (attempt - 1), 2_000));
        }
      }
    }
    this.buffer.unshift(...spans);
    this.enforceBufferLimit();
    this.status = {
      ...this.status,
      healthy: false,
      bufferedSpans: this.buffer.length,
      lastError: toErrorMessage(lastError),
    };
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async send(spans: Span[]): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(this.toOtlpPayload(spans)),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`OTLP HTTP ${response.status}: ${response.statusText}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private enforceBufferLimit(): void {
    const overflow = this.buffer.length - this.maxBufferedSpans;
    if (overflow <= 0) return;
    this.buffer.splice(0, overflow);
    this.status.droppedSpans += overflow;
    this.status.healthy = false;
    this.status.lastError = `Dropped ${overflow} spans because the OTLP buffer is full`;
    this.logger.error(`[tracing] ${this.status.lastError}`);
  }

  private toOtlpPayload(spans: Span[]): Record<string, unknown> {
    return {
      resourceSpans: [{
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "openclaw-gateway" } },
            { key: "service.version", value: { stringValue: "2026.7.1" } },
          ],
        },
        scopeSpans: [{
          scope: { name: "@partme.ai/openclaw-tracing", version: "2026.7.1" },
          spans: spans.map((span) => this.toOtlpSpan(span)),
        }],
      }],
    };
  }

  private toOtlpSpan(span: Span): Record<string, unknown> {
    const kind = { internal: 1, server: 2, client: 3, producer: 4, consumer: 5 }[span.kind];
    const status = { unset: 0, ok: 1, error: 2 }[span.status];
    return {
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId ?? "",
      name: span.name,
      kind,
      startTimeUnixNano: toUnixNano(span.startTimeMs),
      endTimeUnixNano: span.endTimeMs === undefined
        ? undefined
        : toUnixNano(span.endTimeMs),
      attributes: toOtlpAttributes(span.attributes),
      status: { code: status },
      events: span.events.map((event) => ({
        name: event.name,
        timeUnixNano: toUnixNano(event.timestampMs),
        attributes: toOtlpAttributes(event.attributes ?? {}),
      })),
    };
  }
}

function toOtlpAttributes(attributes: Record<string, string | number | boolean>) {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: typeof value === "string"
      ? { stringValue: value }
      : typeof value === "boolean"
        ? { boolValue: value }
        : Number.isInteger(value)
          ? { intValue: String(value) }
          : { doubleValue: value },
  }));
}

function cloneSpan(span: Span): Span {
  return {
    ...span,
    attributes: { ...span.attributes },
    events: span.events.map((event) => ({
      ...event,
      attributes: event.attributes ? { ...event.attributes } : undefined,
    })),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toUnixNano(timeMs: number): string {
  return (BigInt(Math.trunc(timeMs)) * 1_000_000n).toString();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
