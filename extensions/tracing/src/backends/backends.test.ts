import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileBackend } from "./file-backend.js";
import { OtlpBackend } from "./otlp-backend.js";
import type { Span, TracingConfig, TracingLogger } from "../shared/types.js";

const logger: TracingLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const config: TracingConfig = {
  enabled: true,
  backend: "file",
  otlpEndpoint: "http://localhost:4318/v1/traces",
  otlpHeaders: {},
  sampleRate: 1,
  traceDir: "./traces",
  traceRetentionDays: 7,
  maxSpansPerTrace: 100,
  maxActiveTraces: 100,
  maxBufferedSpans: 100,
  flushIntervalMs: 60_000,
  exportTimeoutMs: 1_000,
  exportRetryAttempts: 1,
  shutdownTimeoutMs: 1000,
  captureMessageBody: false,
};

function span(id: string, value = 1): Span {
  return {
    traceId: id.padEnd(32, "0").slice(0, 32),
    spanId: id.padEnd(16, "0").slice(0, 16),
    name: `span-${id}`,
    kind: "client",
    startTimeMs: 100,
    endTimeMs: 110,
    status: "ok",
    attributes: { integer: value, ratio: 0.5 },
    events: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FileBackend", () => {
  it("shutdown 会把缓冲写入按日轮转的 JSONL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openclaw-tracing-"));
    const backend = new FileBackend(logger);
    await backend.init({ ...config, traceDir: dir });
    await backend.exportSpans([span("a")]);
    await backend.shutdown();
    const date = new Date().toISOString().slice(0, 10);
    const content = await readFile(join(dir, `traces-${date}.jsonl`), "utf8");
    expect(JSON.parse(content.trim())).toMatchObject({ name: "span-a", durationMs: 10 });
    expect(backend.getStatus()).toMatchObject({ healthy: true, bufferedSpans: 0 });
    await rm(dir, { recursive: true, force: true });
  });
});

describe("OtlpBackend", () => {
  it("使用完整 endpoint，并正确编码浮点属性", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const backend = new OtlpBackend(logger);
    await backend.init({
      ...config,
      backend: "otlp",
      otlpHeaders: { Authorization: "Bearer test-token" },
    });
    await backend.exportSpans([span("b")]);
    await backend.shutdown();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:4318/v1/traces");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(request.body)).toContain('"doubleValue":0.5');
    expect(request.headers).toMatchObject({
      Authorization: "Bearer test-token",
      "content-type": "application/json",
    });
  });

  it("缓冲超过上限时丢弃最旧 span 并标记降级", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const backend = new OtlpBackend(logger);
    await backend.init({ ...config, backend: "otlp", maxBufferedSpans: 2 });
    await backend.exportSpans([span("1"), span("2"), span("3")]);
    expect(backend.getStatus()).toMatchObject({
      healthy: false,
      bufferedSpans: 2,
      droppedSpans: 1,
    });
    await backend.shutdown();
  });

  it("达到批量阈值时后台导出，不把 Collector 等待传回 Hook", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);
    const backend = new OtlpBackend(logger);
    await backend.init({ ...config, backend: "otlp", maxBufferedSpans: 100 });

    let enqueueCompleted = false;
    const enqueue = backend.exportSpans(
      Array.from({ length: 50 }, (_, index) => span(`batch-${index}`)),
    ).then(() => {
      enqueueCompleted = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(enqueueCompleted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(backend.getStatus().bufferedSpans).toBe(50);

    resolveFetch?.(new Response(null, { status: 200 }));
    await enqueue;
    await backend.shutdown();
  });

  it("单次 flush 将快照拆成最多 50 个 Span 的有界请求", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const backend = new OtlpBackend(logger);
    await backend.init({ ...config, backend: "otlp", maxBufferedSpans: 200 });
    await backend.exportSpans(Array.from({ length: 120 }, (_, index) => span(`bounded-${index}`)));
    await backend.shutdown();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const batchSizes = fetchMock.mock.calls.map((call) => {
      const payload = JSON.parse(String((call[1] as RequestInit).body));
      return payload.resourceSpans[0].scopeSpans[0].spans.length;
    });
    expect(batchSizes).toEqual([50, 50, 20]);
  });

  it("OTLP partialSuccess 拒绝 Span 时按失败批次重试", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        partialSuccess: { rejectedSpans: 1, errorMessage: "invalid attribute" },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const backend = new OtlpBackend(logger);
    await backend.init({ ...config, backend: "otlp", exportRetryAttempts: 2 });
    await backend.exportSpans([span("partial")]);
    await backend.shutdown();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(backend.getStatus()).toMatchObject({ healthy: true, bufferedSpans: 0 });
  });
});
