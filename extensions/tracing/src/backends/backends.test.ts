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
  sampleRate: 1,
  traceDir: "./traces",
  traceRetentionDays: 7,
  maxSpansPerTrace: 100,
  maxBufferedSpans: 100,
  flushIntervalMs: 60_000,
  exportTimeoutMs: 1_000,
  exportRetryAttempts: 1,
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
    await backend.init({ ...config, backend: "otlp" });
    await backend.exportSpans([span("b")]);
    await backend.shutdown();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:4318/v1/traces");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(request.body)).toContain('"doubleValue":0.5');
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
});
