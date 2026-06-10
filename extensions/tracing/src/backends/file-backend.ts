/**
 * File 后端（JSONL + 日期轮转）
 * 将 Span 写入 JSONL 文件，按日期自动轮转
 *
 * 文件布局：
 * <traceDir>/
 * ├── traces-2026-02-06.jsonl
 * ├── traces-2026-02-07.jsonl
 * └── ...
 *
 * 特性：
 * - 每行一个 JSON 对象（JSONL 格式）
 * - 按日期自动轮转文件
 * - 异步批量写入（减少 I/O 次数）
 * - 优雅关闭时刷新缓冲
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { TracingBackend, TracingConfig, Span } from "../shared/types.js";

/** 默认追踪目录 */
const DEFAULT_TRACE_DIR = "./traces";

/** 批量刷新间隔（毫秒） */
const FLUSH_INTERVAL = 5_000;

/**
 * File 追踪后端
 * JSONL 格式写入，按日期轮转
 */
export class FileBackend implements TracingBackend {
  name = "file";

  /** 追踪文件目录 */
  private traceDir: string = DEFAULT_TRACE_DIR;

  /** 写入缓冲 */
  private buffer: string[] = [];

  /** 缓冲刷新定时器 */
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  /** 当前日期（用于检测轮转） */
  private currentDate = "";

  /**
   * 初始化 File 后端
   * 创建追踪目录（如果不存在）
   */
  async init(config: TracingConfig): Promise<void> {
    this.traceDir = config.traceDir || DEFAULT_TRACE_DIR;

    // 创建目录
    await mkdir(this.traceDir, { recursive: true });

    // 启动定时刷新
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        console.error("[openclaw-tracing] File flush error:", err);
      });
    }, FLUSH_INTERVAL);

    console.log(`[openclaw-tracing] File backend initialized: ${this.traceDir}`);
  }

  /**
   * 导出 Span 到文件缓冲
   * 将 Span 序列化为 JSONL 行并添加到缓冲
   *
   * @param spans - 待写入的 Span 列表
   */
  async exportSpans(spans: Span[]): Promise<void> {
    for (const span of spans) {
      const line = JSON.stringify({
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
      });
      this.buffer.push(line);
    }

    // 缓冲超过 100 条时立即刷新
    if (this.buffer.length >= 100) {
      await this.flush();
    }
  }

  /**
   * 关闭后端
   * 停止定时器并刷新剩余缓冲
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // 刷新剩余数据
    await this.flush();
    console.log("[openclaw-tracing] File backend shutdown");
  }

  /**
   * 将缓冲内容写入文件
   * 按当前日期确定文件名，实现自动轮转
   */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // 获取当前日期
    const today = new Date().toISOString().slice(0, 10);
    const filePath = join(this.traceDir, `traces-${today}.jsonl`);

    // 取出缓冲内容
    const lines = this.buffer.splice(0);
    const content = lines.join("\n") + "\n";

    try {
      await appendFile(filePath, content, "utf-8");
    } catch (error) {
      console.error(
        `[openclaw-tracing] Failed to write to ${filePath}:`,
        (error as Error).message
      );
      // 写入失败时将数据放回缓冲（可能导致重复，但不丢失）
      this.buffer.unshift(...lines);
    }
  }
}
