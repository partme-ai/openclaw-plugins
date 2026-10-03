/**
 * Plugin Hooks 与 trace-store 单元测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerTracingPluginHooks, reserveTelemetryEvent } from "./hooks.js";
import { emitDeliveryTelemetry } from "../../../message-sdk/src/transport/telemetry.js";
import { emitDiagnosticEvent, waitForDiagnosticEventsDrained } from "openclaw/plugin-sdk/diagnostic-runtime";
import { TracingSampler } from "./sampler.js";
import {
  createTraceStore,
  createSpan,
  finishAllActiveTraces,
  getActiveSpanCount,
  getRecentTraceCount,
  getTraceSpans,
  resetTraceStore,
} from "./trace-store.js";
import type { TracingBackend, TracingConfig } from "../shared/types.js";

function createMockBackend(): TracingBackend {
  return {
    name: "mock",
    init: vi.fn(async () => {}),
    exportSpans: vi.fn(async () => {}),
    getStatus: vi.fn(() => ({ healthy: true, bufferedSpans: 0, droppedSpans: 0 })),
    shutdown: vi.fn(async () => {}),
  };
}

function createMockApi() {
  const handlers = new Map<string, Array<(event: Record<string, unknown>, ctx: Record<string, unknown>) => void>>();
  return {
    handlers,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    on: vi.fn((name: string, handler: (event: Record<string, unknown>, ctx: Record<string, unknown>) => void) => {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    }),
    async emit(name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) {
      await Promise.all((handlers.get(name) ?? []).map((handler) => handler(event, ctx)));
    },
  };
}

const baseConfig: TracingConfig = {
  enabled: true,
  backend: "log",
  otlpEndpoint: "http://localhost:4318",
  otlpHeaders: {},
  sampleRate: 1,
  traceDir: "./traces",
  traceRetentionDays: 7,
  maxSpansPerTrace: 10,
  maxActiveTraces: 100,
  maxBufferedSpans: 100,
  flushIntervalMs: 5000,
  exportTimeoutMs: 1000,
  exportRetryAttempts: 1,
  shutdownTimeoutMs: 1000,
  captureMessageBody: false,
};

describe("registerTracingPluginHooks", () => {
  it("links delivery start and final settlement by one pseudonymous ID", async () => {
    const backend = createMockBackend();
    const api = createMockApi();
    const stop = registerTracingPluginHooks(api as never, () => ({ backend,
      sampler: new TracingSampler(1), config: baseConfig }));
    emitDeliveryTelemetry({ event: "started", channel: "mqtt", deliveryId: "private-delivery" });
    emitDeliveryTelemetry({ event: "settlement", channel: "mqtt", outcome: "delivered", deliveryId: "private-delivery" });
    emitDiagnosticEvent({ type: "log.record", level: "info", loggerName: "partme.delivery-recall.v1",
      message: "delivery telemetry", attributes: { event: "started", channel: "mqtt", delivery_id: "raw-id" } });
    emitDiagnosticEvent({ type: "log.record", level: "info", loggerName: "partme.delivery-recall.v1",
      message: "delivery telemetry", attributes: { event: "started", channel: "mqtt", delivery_id: "id_000000000000000000000000",
        outcome: "failed" } });
    await waitForDiagnosticEventsDrained();
    await vi.waitFor(() => expect(backend.exportSpans).toHaveBeenCalledTimes(2));
    const spans = vi.mocked(backend.exportSpans).mock.calls.flatMap(([items]) => items);
    expect(spans.map((span) => span.name).sort()).toEqual(["delivery.settlement", "delivery.started"]);
    expect(spans[0]?.attributes["partme.delivery_id"]).toBe(spans[1]?.attributes["partme.delivery_id"]);
    expect(JSON.stringify(spans)).not.toContain("private-delivery");
    await stop();
  });
  it("exports one delivery fact when two hook registrations share a Gateway process", async () => {
    const backend = createMockBackend();
    const first = createMockApi();
    const second = createMockApi();
    const context = () => ({ backend, sampler: new TracingSampler(1), config: baseConfig });
    const stopFirst = registerTracingPluginHooks(first as never, context);
    const stopSecond = registerTracingPluginHooks(second as never, context);
    emitDeliveryTelemetry({ event: "started", channel: "mqtt", deliveryId: "shared-delivery" });
    await waitForDiagnosticEventsDrained();
    await vi.waitFor(() => expect(backend.exportSpans).toHaveBeenCalledTimes(1));
    await stopFirst();
    emitDeliveryTelemetry({ event: "settlement", channel: "mqtt", outcome: "delivered", deliveryId: "shared-delivery" });
    await waitForDiagnosticEventsDrained();
    await vi.waitFor(() => expect(backend.exportSpans).toHaveBeenCalledTimes(2));
    await stopSecond();
  });
  it("exports a diagnostic fact independently to distinct backends in one Gateway process", async () => {
    const firstBackend = createMockBackend();
    const secondBackend = createMockBackend();
    const first = createMockApi();
    const second = createMockApi();
    const stopFirst = registerTracingPluginHooks(first as never, () => ({
      backend: firstBackend, sampler: new TracingSampler(1), config: baseConfig,
    }));
    const stopSecond = registerTracingPluginHooks(second as never, () => ({
      backend: secondBackend, sampler: new TracingSampler(1), config: baseConfig,
    }));
    emitDeliveryTelemetry({ event: "started", channel: "mqtt", deliveryId: "two-backends" });
    await waitForDiagnosticEventsDrained();
    await vi.waitFor(() => expect(firstBackend.exportSpans).toHaveBeenCalledTimes(1));
    expect(secondBackend.exportSpans).toHaveBeenCalledTimes(1);
    await stopFirst();
    await stopSecond();
  });
  it("exports one fact when distinct backend objects target the same OTLP sink", async () => {
    const firstBackend = createMockBackend();
    const secondBackend = createMockBackend();
    const config = { ...baseConfig, backend: "otlp" as const, otlpEndpoint: "https://collector.example/v1/traces",
      otlpHeaders: { Authorization: "Bearer private-token", "X-Scope": "one" } };
    const reordered = { ...config, otlpHeaders: { "X-Scope": "one", Authorization: "Bearer private-token" } };
    const first = createMockApi();
    const second = createMockApi();
    const stopFirst = registerTracingPluginHooks(first as never, () => ({
      backend: firstBackend, sampler: new TracingSampler(1), config,
    }));
    const stopSecond = registerTracingPluginHooks(second as never, () => ({
      backend: secondBackend, sampler: new TracingSampler(1), config: reordered,
    }));
    emitDeliveryTelemetry({ event: "started", channel: "mqtt", deliveryId: "one-otlp-sink" });
    await waitForDiagnosticEventsDrained();
    await vi.waitFor(() => expect(vi.mocked(firstBackend.exportSpans).mock.calls.length +
      vi.mocked(secondBackend.exportSpans).mock.calls.length).toBe(1));
    await stopFirst();
    await stopSecond();
  });
  it("keeps same-sink claims best effort when the chosen async exporter fails", async () => {
    const firstBackend = createMockBackend();
    const secondBackend = createMockBackend();
    vi.mocked(firstBackend.exportSpans).mockRejectedValueOnce(new Error("export unavailable"));
    const config = { ...baseConfig, backend: "otlp" as const, otlpEndpoint: "https://failed.example/v1/traces" };
    const first = createMockApi();
    const second = createMockApi();
    const stopFirst = registerTracingPluginHooks(first as never, () => ({
      backend: firstBackend, sampler: new TracingSampler(1), config,
    }));
    const stopSecond = registerTracingPluginHooks(second as never, () => ({
      backend: secondBackend, sampler: new TracingSampler(1), config,
    }));
    emitDeliveryTelemetry({ event: "retry", channel: "mqtt", deliveryId: "failed-export" });
    await waitForDiagnosticEventsDrained();
    await vi.waitFor(() => expect(firstBackend.exportSpans).toHaveBeenCalledTimes(1));
    expect(secondBackend.exportSpans).not.toHaveBeenCalled();
    expect(first.logger.error).toHaveBeenCalledWith(expect.stringContaining("telemetry export failed"));
    await stopFirst();
    await stopSecond();
  });
  it("exports independently to different OTLP endpoints or header scopes", async () => {
    const backends = [createMockBackend(), createMockBackend(), createMockBackend()];
    const apis = backends.map(() => createMockApi());
    const configs = [
      { ...baseConfig, backend: "otlp" as const, otlpEndpoint: "https://first.example/v1/traces",
        otlpHeaders: { Authorization: "Bearer first", "X-Scope": "a" } },
      { ...baseConfig, backend: "otlp" as const, otlpEndpoint: "https://second.example/v1/traces",
        otlpHeaders: { "X-Scope": "a", Authorization: "Bearer first" } },
      { ...baseConfig, backend: "otlp" as const, otlpEndpoint: "https://first.example/v1/traces",
        otlpHeaders: { "X-Scope": "a", Authorization: "Bearer second" } },
    ];
    const stops = apis.map((api, index) => registerTracingPluginHooks(api as never, () => ({
      backend: backends[index]!, sampler: new TracingSampler(1), config: configs[index]!,
    })));
    emitDeliveryTelemetry({ event: "started", channel: "mqtt", deliveryId: "many-otlp-sinks" });
    await waitForDiagnosticEventsDrained();
    await vi.waitFor(() => expect(backends.every((backend) => vi.mocked(backend.exportSpans).mock.calls.length === 1)).toBe(true));
    for (const stop of stops) await stop();
  });
  it("bounds sink claims to the diagnostic event lifetime across configuration changes", async () => {
    const backends = Array.from({ length: 70 }, () => createMockBackend());
    const stops = backends.map((backend, index) => registerTracingPluginHooks(createMockApi() as never, () => ({
      backend, sampler: new TracingSampler(1), config: { ...baseConfig, backend: "otlp",
        otlpEndpoint: `https://collector-${index}.example/v1/traces`,
        otlpHeaders: { Authorization: "Bearer private-token" } },
    })));
    emitDeliveryTelemetry({ event: "started", channel: "mqtt", deliveryId: "bounded-sinks" });
    await waitForDiagnosticEventsDrained();
    await vi.waitFor(() => expect(backends.every((backend) => vi.mocked(backend.exportSpans).mock.calls.length === 1)).toBe(true));
    const events = (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("partme.tracing.deliveryTelemetryEvents.v1")];
    expect(events).toBeInstanceOf(Map);
    await vi.waitFor(() => expect((events as Map<number, unknown>).size).toBe(0));
    for (const stop of stops) await stop();
  });
  it("does not export twice when 65 other sinks occur between two listeners for one sink", async () => {
    const backends = Array.from({ length: 67 }, () => createMockBackend());
    const sinkA = { ...baseConfig, backend: "otlp" as const, otlpEndpoint: "https://sink-a.example/v1/traces" };
    const stops = backends.map((backend, index) => registerTracingPluginHooks(createMockApi() as never, () => ({
      backend, sampler: new TracingSampler(1), config: index === 0 || index === 66 ? sinkA :
        { ...sinkA, otlpEndpoint: `https://sink-${index}.example/v1/traces` },
    })));
    emitDeliveryTelemetry({ event: "started", channel: "mqtt", deliveryId: "sink-order" });
    await waitForDiagnosticEventsDrained();
    await vi.waitFor(() => expect(backends.slice(0, 66).every((backend) =>
      vi.mocked(backend.exportSpans).mock.calls.length === 1)).toBe(true));
    const events = (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("partme.tracing.deliveryTelemetryEvents.v1")] as
      Map<number, unknown>;
    await vi.waitFor(() => expect(events.size).toBe(0));
    expect(vi.mocked(backends[66]!.exportSpans).mock.calls.length).toBe(0);
    for (const stop of stops) await stop();
  });
  it("keeps a pending same-sink ticket after more than 2048 later diagnostics", async () => {
    const gate = Promise.withResolvers<void>();
    const firstBackend = createMockBackend();
    const secondBackend = createMockBackend();
    const config = { ...baseConfig, backend: "otlp" as const,
      otlpEndpoint: "https://slow-provider.example/v1/traces" };
    const first = registerTracingPluginHooks(createMockApi() as never, () => ({
      backend: firstBackend, sampler: new TracingSampler(1), config,
    }));
    let calls = 0;
    const second = registerTracingPluginHooks(createMockApi() as never, async () => {
      if (++calls === 1) await gate.promise;
      return { backend: secondBackend, sampler: new TracingSampler(1), config };
    });
    emitDeliveryTelemetry({ event: "started", channel: "mqtt", deliveryId: "slow-first" });
    await waitForDiagnosticEventsDrained();
    await vi.waitFor(() => expect(firstBackend.exportSpans).toHaveBeenCalledTimes(1));
    const events = (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("partme.tracing.deliveryTelemetryEvents.v1")] as
      Map<number, { pending: number }>;
    const firstEntry = [...events.values()][0]!;
    expect(firstEntry.pending).toBe(1);
    for (let index = 0; index < 2050; index += 1) {
      emitDeliveryTelemetry({ event: "retry", channel: "mqtt", deliveryId: `later-${index}` });
    }
    await waitForDiagnosticEventsDrained();
    gate.resolve();
    await vi.waitFor(() => expect(firstEntry.pending).toBe(0));
    expect(calls).toBeGreaterThan(2048);
    expect(secondBackend.exportSpans).not.toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: "delivery.started" }),
    ]));
    await first();
    await second();
  });
  it("refuses a late export after the bounded diagnostic ticket expires", async () => {
    const gate = Promise.withResolvers<void>();
    const backend = createMockBackend();
    const originalSetTimeout = globalThis.setTimeout;
    let expire: (() => void) | undefined;
    const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) => {
      if (delay === 30_000) {
        expire = callback;
        return { unref() {} } as ReturnType<typeof setTimeout>;
      }
      return originalSetTimeout(callback, delay);
    }) as typeof setTimeout);
    const stop = registerTracingPluginHooks(createMockApi() as never, async () => {
      await gate.promise;
      return { backend, sampler: new TracingSampler(1), config: baseConfig };
    });
    try {
      emitDeliveryTelemetry({ event: "started", channel: "mqtt", deliveryId: "expired" });
      await waitForDiagnosticEventsDrained();
      expect(expire).toBeTypeOf("function");
      const events = (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("partme.tracing.deliveryTelemetryEvents.v1")] as
        Map<number, { pending: number }>;
      const entry = [...events.values()][0]!;
      expect(entry.pending).toBe(1);
      expire!();
      gate.resolve();
      await vi.waitFor(() => expect(entry.pending).toBe(0));
      expect(backend.exportSpans).not.toHaveBeenCalled();
      expect(events.size).toBe(0);
      await stop();
    } finally {
      gate.resolve();
      timer.mockRestore();
    }
  });
  it("drops new event tickets at capacity and limits sink claims per event", async () => {
    const tickets = Array.from({ length: 1024 }, (_, index) => reserveTelemetryEvent(10_000_000 + index));
    expect(tickets.every(Boolean)).toBe(true);
    expect(reserveTelemetryEvent(11_000_000)).toBeUndefined();
    expect(reserveTelemetryEvent(11_000_000)).toBeUndefined();
    await Promise.resolve();
    const backend = createMockBackend();
    const config = { ...baseConfig, backend: "otlp" as const };
    for (let index = 0; index < 128; index += 1) {
      expect(tickets[0]!.claim(backend, { ...config,
        otlpEndpoint: `https://bounded-${index}.example/v1/traces` })).toBe(true);
    }
    expect(tickets[0]!.claim(backend, { ...config,
      otlpEndpoint: "https://bounded-overflow.example/v1/traces" })).toBe(false);
    for (const ticket of tickets) ticket!.release();
    const events = (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("partme.tracing.deliveryTelemetryEvents.v1")];
    expect((events as Map<number, unknown>).size).toBe(0);
  });
  it("exports a redacted final delivery span and stops listening after shutdown", async () => {
    const backend = createMockBackend();
    const api = createMockApi();
    const stop = registerTracingPluginHooks(api as never, () => ({ backend,
      sampler: new TracingSampler(1), config: baseConfig }));
    emitDeliveryTelemetry({ event: "settlement", channel: "mqtt", outcome: "ambiguous",
      runId: "run-private", messageId: "message-private", deliveryId: "delivery-private" });
    emitDiagnosticEvent({ type: "log.record", level: "info", loggerName: "partme.delivery-recall.v1",
      message: "delivery telemetry", attributes: { event: "settlement", channel: "mqtt", outcome: "failed",
        delivery_id: "Bearer raw-credential" } });
    emitDiagnosticEvent({ type: "log.record", level: "info", loggerName: "partme.delivery-recall.v1",
      message: "delivery telemetry", attributes: { event: "settlement", channel: "attacker", outcome: "failed" } });
    emitDiagnosticEvent({ type: "log.record", level: "info", loggerName: "partme.delivery-recall.v1",
      message: "recall telemetry", attributes: { event: "recall", plugin: "memory", duration_ms: 1,
        delivery_id: "id_000000000000000000000000" } });
    await waitForDiagnosticEventsDrained();
    expect(backend.exportSpans).toHaveBeenCalledTimes(1);
    const spans = vi.mocked(backend.exportSpans).mock.calls.flatMap(([items]) => items);
    expect(spans.some((span) => span.name === "delivery.settlement")).toBe(true);
    expect(JSON.stringify(spans)).not.toMatch(/run-private|message-private|delivery-private/);
    await stop();
    emitDeliveryTelemetry({ event: "retry", channel: "mqtt", deliveryId: "other-private" });
    await waitForDiagnosticEventsDrained();
    expect(backend.exportSpans).toHaveBeenCalledTimes(1);
    await api.emit("gateway_start", {}, {});
    emitDeliveryTelemetry({ event: "retry", channel: "mqtt", deliveryId: "after-restart" });
    await waitForDiagnosticEventsDrained();
    await vi.waitFor(() => expect(backend.exportSpans).toHaveBeenCalledTimes(2));
    await stop();
  });
  it("resubscribes a new generation while an old stop is still draining", async () => {
    const gate = Promise.withResolvers<void>();
    const backend = createMockBackend();
    vi.mocked(backend.exportSpans).mockImplementationOnce(() => gate.promise);
    const api = createMockApi();
    const stop = registerTracingPluginHooks(api as never, () => ({ backend,
      sampler: new TracingSampler(1), config: baseConfig }));
    emitDeliveryTelemetry({ event: "retry", channel: "mqtt", deliveryId: "before-stop" });
    await waitForDiagnosticEventsDrained();
    await vi.waitFor(() => expect(backend.exportSpans).toHaveBeenCalledTimes(1));
    const stopping = stop();
    await api.emit("gateway_start", {}, {});
    emitDeliveryTelemetry({ event: "retry", channel: "mqtt", deliveryId: "after-start" });
    await waitForDiagnosticEventsDrained();
    await vi.waitFor(() => expect(backend.exportSpans).toHaveBeenCalledTimes(2));
    gate.resolve();
    await stopping;
    await stop();
  });
  beforeEach(() => {
    resetTraceStore();
  });

  it("old TTL cleanup cannot close a same-key trace created after store reset", async () => {
    const store = createTraceStore();
    const gate = Promise.withResolvers<void>();
    const backend = createMockBackend();
    vi.mocked(backend.exportSpans).mockImplementationOnce(() => gate.promise);
    const register = (sessionKey: string, runId: string, traceId: string, withChild = false) => {
      const root = store.createSpan("message.received", { traceId });
      store.registerActiveTrace({ traceId, rootSpanId: root.spanId, spanCount: withChild ? 2 : 1,
        sessionKey, runId, createdAtMs: 1, lastTouchedAtMs: 1 });
      if (withChild) store.createSpan("tool:old", { traceId, parentSpanId: root.spanId });
    };
    register("first-session", "first-run", "1".repeat(32), true);
    register("same-session", "same-run", "2".repeat(32));
    const cleanup = store.cleanupSessionTraces(backend, Date.now() + 1_000, 1);
    await vi.waitFor(() => expect(backend.exportSpans).toHaveBeenCalledTimes(1));
    store.resetTraceStore();
    register("same-session", "same-run", "3".repeat(32));
    gate.resolve();
    await cleanup;
    expect(store.getActiveTraceCount()).toBe(1);
  });

  it("message_received 创建 root span，final reply 结束并导出", async () => {
    const backend = createMockBackend();
    const api = createMockApi();

    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler: new TracingSampler(1),
      config: baseConfig,
    }));

    await api.emit(
      "message_received",
      { content: "hello" },
      { sessionKey: "agent:main:direct:user1", runId: "run-1", channelId: "wecom" },
    );

    expect(getActiveSpanCount()).toBe(1);

    await api.emit(
      "reply_payload_sending",
      { kind: "final", sessionKey: "agent:main:direct:user1", runId: "run-1", payload: { text: "done" } },
      { sessionKey: "agent:main:direct:user1", runId: "run-1" },
    );

    expect(getActiveSpanCount()).toBe(0);
    expect(getRecentTraceCount()).toBe(1);
    expect(backend.exportSpans).toHaveBeenCalled();
  });

  it("非 final 回复分片不会提前关闭 root span", async () => {
    const backend = createMockBackend();
    const api = createMockApi();
    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler: new TracingSampler(1),
      config: baseConfig,
    }));
    await api.emit("message_received", {}, { sessionKey: "sk-chunk", runId: "run-chunk" });
    await api.emit(
      "reply_payload_sending",
      { kind: "block", sessionKey: "sk-chunk", runId: "run-chunk", payload: { text: "part" } },
      { sessionKey: "sk-chunk", runId: "run-chunk" },
    );
    expect(getActiveSpanCount()).toBe(1);
  });

  it("agent_end 为不触发标准出站 hook 的自定义 channel 关闭 trace", async () => {
    const backend = createMockBackend();
    const api = createMockApi();
    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler: new TracingSampler(1),
      config: baseConfig,
    }));

    await api.emit("message_received", {}, { sessionKey: "sk-wire", channelId: "mqtt" });
    await api.emit(
      "agent_end",
      { runId: "run-wire", messages: [], success: true },
      { sessionKey: "sk-wire", runId: "run-wire", channel: "mqtt" },
    );

    expect(getActiveSpanCount()).toBe(0);
    const exported = vi.mocked(backend.exportSpans).mock.calls.flatMap(([spans]) => spans);
    expect(exported).toHaveLength(1);
    expect(exported[0]?.status).toBe("ok");
    expect(exported[0]?.attributes["openclaw.end_reason"]).toBe("agent_end_success");
  });

  it("缺少 message_received 时仍为真实 Agent 终态导出可辨认的 span", async () => {
    const backend = createMockBackend();
    const api = createMockApi();
    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler: new TracingSampler(1),
      config: baseConfig,
    }));

    await api.emit("agent_end", { runId: "run-without-inbound-hook", success: true, durationMs: 1_234 }, {
      sessionKey: "agent:main:main",
      runId: "run-without-inbound-hook",
    });

    const exported = vi.mocked(backend.exportSpans).mock.calls.flatMap(([spans]) => spans);
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({
      name: "agent.run",
      status: "ok",
      attributes: {
        "openclaw.session_key": expect.stringMatching(/^id_[a-f0-9]{24}$/),
        "openclaw.run_id": expect.stringMatching(/^id_[a-f0-9]{24}$/),
        "openclaw.end_reason": "agent_end_success",
      },
    });
    expect(getActiveSpanCount()).toBe(0);
    expect(exported[0]!.endTimeMs! - exported[0]!.startTimeMs).toBe(1_234);
    await api.emit("agent_end", { runId: "run-without-inbound-hook", success: true }, {
      sessionKey: "agent:main:main",
      runId: "run-without-inbound-hook",
    });
    expect(vi.mocked(backend.exportSpans).mock.calls).toHaveLength(1);
  });

  it("显式采集正文时 fallback agent.run 保留本轮最后 user 文本供端到端关联", async () => {
    const backend = createMockBackend();
    const api = createMockApi();
    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler: new TracingSampler(1),
      config: { ...baseConfig, captureMessageBody: true },
    }));

    await api.emit("agent_end", {
      runId: "nonce-run",
      success: true,
      messages: [
        { role: "user", content: [{ type: "text", text: "old turn" }] },
        { role: "assistant", content: [{ type: "text", text: "old reply" }] },
        { role: "user", content: [{ type: "text", text: "Return tracing fixture nonce-42" }] },
        { role: "assistant", content: [{ type: "text", text: "fixture reply" }] },
      ],
    }, { sessionKey: "nonce-session", runId: "nonce-run" });

    const exported = vi.mocked(backend.exportSpans).mock.calls.flatMap(([spans]) => spans);
    expect(exported[0]?.attributes["openclaw.message_text"]).toBe("Return tracing fixture nonce-42");
  });

  it("入站已被采样拒绝时 agent_end 不补造 span", async () => {
    const backend = createMockBackend();
    const api = createMockApi();
    const sampler = new TracingSampler(0.5);
    vi.spyOn(sampler, "shouldSample").mockReturnValueOnce(false).mockReturnValue(true);
    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler,
      config: { ...baseConfig, sampleRate: 0.5 },
    }));
    await api.emit("message_received", {}, { sessionKey: "sampled-out" });
    await api.emit("agent_end", { runId: "sampled-out-run", success: true }, {
      sessionKey: "sampled-out", runId: "sampled-out-run",
    });
    expect(backend.exportSpans).not.toHaveBeenCalled();
  });

  it("入站因活动上限被拒绝时 agent_end 不绕过上限导出", async () => {
    const backend = createMockBackend();
    const api = createMockApi();
    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler: new TracingSampler(1),
      config: { ...baseConfig, maxActiveTraces: 1 },
    }));
    await api.emit("message_received", {}, { sessionKey: "active-1", runId: "active-run-1" });
    await api.emit("message_received", {}, { sessionKey: "capped-2" });
    await api.emit("agent_end", { runId: "active-run-1", success: true }, {
      sessionKey: "active-1", runId: "active-run-1",
    });
    vi.mocked(backend.exportSpans).mockClear();
    await api.emit("agent_end", { runId: "capped-run-2", success: true }, {
      sessionKey: "capped-2", runId: "capped-run-2",
    });
    expect(backend.exportSpans).not.toHaveBeenCalled();
    expect(getActiveSpanCount()).toBe(0);
  });

  it("同一 session 后续入站建根时清除旧拒绝，不污染再下一次无入站终态", async () => {
    const backend = createMockBackend();
    const api = createMockApi();
    const sampler = new TracingSampler(0.5);
    vi.spyOn(sampler, "shouldSample")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true);
    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler,
      config: { ...baseConfig, sampleRate: 0.5 },
    }));
    await api.emit("message_received", {}, { sessionKey: "reused-session" });
    await api.emit("message_received", {}, { sessionKey: "reused-session", runId: "accepted-run" });
    await api.emit("reply_payload_sending", { kind: "final", sessionKey: "reused-session", runId: "accepted-run" }, {
      sessionKey: "reused-session", runId: "accepted-run",
    });
    vi.mocked(backend.exportSpans).mockClear();
    await api.emit("agent_end", { runId: "fallback-run", success: true }, {
      sessionKey: "reused-session", runId: "fallback-run",
    });
    const exported = vi.mocked(backend.exportSpans).mock.calls.flatMap(([spans]) => spans);
    expect(exported.map((span) => span.name)).toEqual(["agent.run"]);
  });

  it("gateway_stop 后迟到的 session_end 不重新获取或初始化后端", async () => {
    const backend = createMockBackend();
    const api = createMockApi();
    const getContext = vi.fn(() => ({ backend, sampler: new TracingSampler(1), config: baseConfig }));
    registerTracingPluginHooks(api as never, getContext);
    await api.emit("gateway_stop", {}, {});
    await api.emit("session_end", {}, { sessionKey: "stopped-session", runId: "stopped-run" });
    expect(getContext).not.toHaveBeenCalled();
    await api.emit("gateway_start", {}, {});
    await api.emit("message_received", {}, { sessionKey: "new-session", runId: "new-run" });
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("agent_end 失败会把 root 与悬挂 tool span 标记为错误", async () => {
    const backend = createMockBackend();
    const api = createMockApi();
    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler: new TracingSampler(1),
      config: baseConfig,
    }));

    await api.emit("message_received", {}, { sessionKey: "sk-agent-error", runId: "run-agent-error" });
    await api.emit(
      "before_tool_call",
      { toolName: "broken", toolCallId: "tc-agent-error" },
      { sessionKey: "sk-agent-error", runId: "run-agent-error" },
    );
    await api.emit(
      "agent_end",
      { runId: "run-agent-error", messages: [], success: false, error: "failed" },
      { sessionKey: "sk-agent-error", runId: "run-agent-error" },
    );

    expect(getActiveSpanCount()).toBe(0);
    const exported = vi.mocked(backend.exportSpans).mock.calls.flatMap(([spans]) => spans);
    expect(exported).toHaveLength(2);
    expect(exported.every((span) => span.status === "error")).toBe(true);
  });

  it("before_tool_call / after_tool_call 创建并结束 tool span", async () => {
    const backend = createMockBackend();
    const api = createMockApi();

    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler: new TracingSampler(1),
      config: baseConfig,
    }));

    await api.emit(
      "message_received",
      {},
      { sessionKey: "sk-1", runId: "run-2", channelId: "mqtt" },
    );

    await api.emit(
      "before_tool_call",
      { toolName: "web_search", toolCallId: "tc-1" },
      { sessionKey: "sk-1", runId: "run-2" },
    );

    expect(getActiveSpanCount()).toBe(2);

    await api.emit(
      "after_tool_call",
      { toolCallId: "tc-1", durationMs: 50 },
      { sessionKey: "sk-1", runId: "run-2" },
    );

    expect(getActiveSpanCount()).toBe(1);
    const exported = vi.mocked(backend.exportSpans).mock.calls.flatMap(([spans]) => spans);
    const toolSpan = exported.find((span) => span.name === "tool:web_search");
    expect(toolSpan?.endTimeMs! - toolSpan?.startTimeMs!).toBe(50);
  });

  it("缺少 toolCallId 时不创建无法回收的 span", async () => {
    const backend = createMockBackend();
    const api = createMockApi();
    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler: new TracingSampler(1),
      config: baseConfig,
    }));
    await api.emit("message_received", {}, { sessionKey: "sk-missing", runId: "run-missing" });
    await api.emit("before_tool_call", { toolName: "broken" }, { sessionKey: "sk-missing", runId: "run-missing" });
    expect(getActiveSpanCount()).toBe(1);
  });

  it("session_end 会关闭 root 和未完成的 tool span", async () => {
    const backend = createMockBackend();
    const api = createMockApi();
    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler: new TracingSampler(1),
      config: baseConfig,
    }));
    await api.emit("message_received", {}, { sessionKey: "sk-orphan", runId: "run-orphan" });
    await api.emit(
      "before_tool_call",
      { toolName: "slow", toolCallId: "tc-orphan" },
      { sessionKey: "sk-orphan", runId: "run-orphan" },
    );
    expect(getActiveSpanCount()).toBe(2);
    await api.emit("session_end", {}, { sessionKey: "sk-orphan", runId: "run-orphan" });
    expect(getActiveSpanCount()).toBe(0);
    const exported = vi.mocked(backend.exportSpans).mock.calls.flatMap(([spans]) => spans);
    expect(exported).toHaveLength(2);
    expect(exported.every((span) => span.status === "error")).toBe(true);
  });

  it("后端导出失败时仍回收同一 trace 的所有 span", async () => {
    const backend = createMockBackend();
    vi.mocked(backend.exportSpans).mockRejectedValue(new Error("collector down"));
    const api = createMockApi();
    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler: new TracingSampler(1),
      config: baseConfig,
    }));
    await api.emit("message_received", {}, { sessionKey: "sk-fail", runId: "run-fail" });
    await api.emit(
      "before_tool_call",
      { toolName: "slow", toolCallId: "tc-fail" },
      { sessionKey: "sk-fail", runId: "run-fail" },
    );
    await api.emit("session_end", {}, { sessionKey: "sk-fail", runId: "run-fail" });
    expect(getActiveSpanCount()).toBe(0);
    expect(backend.exportSpans).toHaveBeenCalledTimes(2);
    expect(api.logger.error).toHaveBeenCalledWith(expect.stringContaining("collector down"));
  });

  it("provider 返回 null 时 hooks 保持静默", async () => {
    const api = createMockApi();
    registerTracingPluginHooks(api as never, () => null);
    await api.emit("message_received", {}, { sessionKey: "disabled" });
    expect(getActiveSpanCount()).toBe(0);
  });

  it("惰性初始化失败时记录错误并 fail-open，不把异常抛回主 Hook", async () => {
    const api = createMockApi();
    registerTracingPluginHooks(api as never, async () => {
      throw new Error("backend init failed");
    });
    await expect(api.emit("message_received", {}, { sessionKey: "sk-init-fail" })).resolves.toBeUndefined();
    expect(api.logger.error).toHaveBeenCalledWith(expect.stringContaining("backend init failed"));
    expect(getActiveSpanCount()).toBe(0);
  });

  it("缺少 sessionKey 和 runId 时不创建无法关联结束事件的孤儿 root span", async () => {
    const backend = createMockBackend();
    const api = createMockApi();
    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler: new TracingSampler(1),
      config: baseConfig,
    }));
    await api.emit("message_received", {}, { channelId: "unknown" });
    expect(getActiveSpanCount()).toBe(0);
    expect(api.logger.warn).toHaveBeenCalledWith(expect.stringContaining("both sessionKey and runId are missing"));
  });

  it("活动 Trace 达到上限时跳过新会话并报告容量错误", async () => {
    const backend = createMockBackend();
    const api = createMockApi();
    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler: new TracingSampler(1),
      config: { ...baseConfig, maxActiveTraces: 1 },
    }));
    await api.emit("message_received", {}, { sessionKey: "sk-limit-1", runId: "run-limit-1" });
    await api.emit("message_received", {}, { sessionKey: "sk-limit-2", runId: "run-limit-2" });
    expect(getActiveSpanCount()).toBe(1);
    expect(api.logger.error).toHaveBeenCalledWith(expect.stringContaining("active trace limit reached"));
  });

  it("相同 toolCallId 在不同 Trace 中不会互相覆盖绑定", async () => {
    const backend = createMockBackend();
    const api = createMockApi();
    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler: new TracingSampler(1),
      config: baseConfig,
    }));
    const trace1 = "11111111111111111111111111111111";
    const trace2 = "22222222222222222222222222222222";
    await api.emit("message_received", {}, { sessionKey: "sk-tool-1", runId: "run-tool-1", traceId: trace1 });
    await api.emit("message_received", {}, { sessionKey: "sk-tool-2", runId: "run-tool-2", traceId: trace2 });
    await api.emit("before_tool_call", { toolName: "shared", toolCallId: "call-1" }, { sessionKey: "sk-tool-1", runId: "run-tool-1" });
    await api.emit("before_tool_call", { toolName: "shared", toolCallId: "call-1" }, { sessionKey: "sk-tool-2", runId: "run-tool-2" });
    await api.emit("after_tool_call", { toolCallId: "call-1" }, { sessionKey: "sk-tool-1", runId: "run-tool-1" });
    await api.emit("after_tool_call", { toolCallId: "call-1" }, { sessionKey: "sk-tool-2", runId: "run-tool-2" });

    const toolSpans = vi.mocked(backend.exportSpans).mock.calls
      .flatMap(([spans]) => spans)
      .filter((span) => span.name === "tool:shared");
    expect(toolSpans.map((span) => span.traceId).sort()).toEqual([trace1, trace2]);
  });
});

describe("trace-store getTraceSpans", () => {
  beforeEach(() => {
    resetTraceStore();
  });

  it("返回已完成的 trace spans", async () => {
    const backend = createMockBackend();
    const api = createMockApi();

    registerTracingPluginHooks(api as never, () => ({
      backend,
      sampler: new TracingSampler(1),
      config: baseConfig,
    }));

    await api.emit("message_received", {}, { sessionKey: "sk-3", runId: "run-4", channelId: "mqtt", traceId: "abc123abc123abc1abc123abc123abc1" });
    await api.emit(
      "reply_payload_sending",
      { kind: "final", sessionKey: "sk-3", runId: "run-4", payload: { text: "done" } },
      { sessionKey: "sk-3", runId: "run-4" },
    );

    const traces = getTraceSpans("abc123abc123abc1abc123abc123abc1");
    expect(traces?.length).toBe(1);
    expect(traces?.[0]?.name).toBe("message.received");
    traces![0]!.name = "mutated";
    expect(getTraceSpans("abc123abc123abc1abc123abc123abc1")?.[0]?.name).toBe("message.received");
  });

  it("Gateway 关闭时导出没有 session/run 索引的孤儿 Span", async () => {
    const backend = createMockBackend();
    createSpan("orphan.operation");

    await finishAllActiveTraces(backend, "gateway_shutdown");

    expect(getActiveSpanCount()).toBe(0);
    const exported = vi.mocked(backend.exportSpans).mock.calls.flatMap(([spans]) => spans);
    expect(exported).toHaveLength(1);
    expect(exported[0]?.status).toBe("error");
    expect(exported[0]?.attributes["openclaw.end_reason"]).toBe("gateway_shutdown");
  });

  it("Span 名称在进入查询与后端前统一脱敏并限制长度", async () => {
    const backend = createMockBackend();
    const created = createSpan(`tool:Bearer private-token\n${"x".repeat(600)}`);

    await finishAllActiveTraces(backend, "test_cleanup");

    const exported = vi.mocked(backend.exportSpans).mock.calls.flatMap(([spans]) => spans);
    expect(created.name).not.toContain("private-token");
    expect(created.name).not.toContain("\n");
    expect(exported[0]?.name.length).toBeLessThanOrEqual(500);
  });
});
