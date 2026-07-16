/**
 * Plugin Hooks 与 trace-store 单元测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerTracingPluginHooks } from "./hooks.js";
import { TracingSampler } from "./sampler.js";
import {
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
  sampleRate: 1,
  traceDir: "./traces",
  traceRetentionDays: 7,
  maxSpansPerTrace: 10,
  maxBufferedSpans: 100,
  flushIntervalMs: 5000,
  exportTimeoutMs: 1000,
  exportRetryAttempts: 1,
  captureMessageBody: false,
};

describe("registerTracingPluginHooks", () => {
  beforeEach(() => {
    resetTraceStore();
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
});
