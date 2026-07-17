/**
 * @fileoverview Trace Span 的有界 JSONL 文件导出后端。
 *
 * Span 先进入内存缓冲，达到批量阈值或定时周期后串行追加到每日文件；刷盘失败会把批次放回
 * 队首，缓冲超限则丢弃最旧 Span 并降低健康状态。后端每天清理过期文件，关闭时必须完成
 * 最后一轮 flush，否则明确报告未持久化数据。
 */
import { appendFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  Span,
  TracingBackend,
  TracingBackendStatus,
  TracingConfig,
  TracingLogger,
} from "../shared/types.js";

const FLUSH_BATCH_SIZE = 100;

function serializeSpan(span: Span): string {
  return JSON.stringify({
    ...span,
    durationMs: span.endTimeMs === undefined ? undefined : span.endTimeMs - span.startTimeMs,
    events: span.events.length > 0 ? span.events : undefined,
  });
}

/** 有界缓冲、串行刷盘的 JSONL 后端。 */
export class FileBackend implements TracingBackend {
  readonly name = "file";
  private traceDir = "./traces";
  private maxBufferedSpans = 10_000;
  private retentionDays = 7;
  private lastRetentionDate = "";
  private buffer: string[] = [];
  private inFlightSpans = 0;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushPromise: Promise<void> | null = null;
  private status: TracingBackendStatus = {
    healthy: true,
    bufferedSpans: 0,
    droppedSpans: 0,
  };

  constructor(private readonly logger: TracingLogger) {}

  async init(config: TracingConfig): Promise<void> {
    this.traceDir = config.traceDir;
    this.maxBufferedSpans = config.maxBufferedSpans;
    this.retentionDays = config.traceRetentionDays;
    await mkdir(this.traceDir, { recursive: true });
    await this.cleanupExpiredFiles();
    this.flushTimer = setInterval(() => {
      void this.flush().catch((error: unknown) => {
        this.logger.error(`[tracing] File flush failed: ${toErrorMessage(error)}`);
      });
    }, config.flushIntervalMs);
    this.flushTimer.unref?.();
    this.logger.info(`[tracing] File backend initialized: ${this.traceDir}`);
  }

  async exportSpans(spans: Span[]): Promise<void> {
    this.buffer.push(...spans.map(serializeSpan));
    this.enforceBufferLimit();
    if (this.buffer.length >= FLUSH_BATCH_SIZE) {
      // Tracing 是旁路观测能力：达到批量阈值只触发后台刷盘，不能让第 100 个业务 Hook 等待磁盘。
      void this.flush().catch((error: unknown) => {
        this.logger.error(`[tracing] File flush failed: ${toErrorMessage(error)}`);
      });
    }
  }

  getStatus(): TracingBackendStatus {
    return { ...this.status, bufferedSpans: this.buffer.length + this.inFlightSpans };
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    if (this.buffer.length > 0) {
      throw new Error(`File backend shutdown with ${this.buffer.length} unflushed spans`);
    }
    this.logger.info("[tracing] File backend shut down");
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
    const date = new Date().toISOString().slice(0, 10);
    if (date !== this.lastRetentionDate) await this.cleanupExpiredFiles();
    const filePath = join(this.traceDir, `traces-${date}.jsonl`);
    // 只处理进入本轮 flush 前的快照，避免持续高流量让一次刷盘永不结束。
    let remaining = this.buffer.length;
    while (remaining > 0) {
      const lines = this.buffer.splice(0, Math.min(FLUSH_BATCH_SIZE, remaining));
      remaining -= lines.length;
      this.inFlightSpans = lines.length;
      try {
        await appendFile(filePath, `${lines.join("\n")}\n`, "utf8");
        this.inFlightSpans = 0;
        this.status = {
          ...this.status,
          healthy: true,
          bufferedSpans: this.buffer.length,
          lastExportAt: Date.now(),
          lastError: undefined,
        };
      } catch (error) {
        this.inFlightSpans = 0;
        this.buffer.unshift(...lines);
        this.enforceBufferLimit();
        this.status = {
          ...this.status,
          healthy: false,
          bufferedSpans: this.buffer.length,
          lastError: toErrorMessage(error),
        };
        throw error;
      }
    }
  }

  private enforceBufferLimit(): void {
    const overflow = this.buffer.length - this.maxBufferedSpans;
    if (overflow <= 0) return;
    this.buffer.splice(0, overflow);
    this.status.droppedSpans += overflow;
    this.status.healthy = false;
    this.status.lastError = `Dropped ${overflow} spans because the file buffer is full`;
    this.logger.error(`[tracing] ${this.status.lastError}`);
  }

  private async cleanupExpiredFiles(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const todayStart = Date.parse(`${today}T00:00:00.000Z`);
    const cutoff = todayStart - (this.retentionDays - 1) * 86_400_000;
    const files = await readdir(this.traceDir);
    await Promise.all(files.map(async (file) => {
      const match = /^traces-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(file);
      if (!match) return;
      const timestamp = Date.parse(`${match[1]}T00:00:00.000Z`);
      if (Number.isFinite(timestamp) && timestamp < cutoff) {
        await unlink(join(this.traceDir, file));
      }
    }));
    this.lastRetentionDate = today;
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
