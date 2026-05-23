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
import type { TracingBackend, TracingConfig } from "./types.js";

function createMockBackend(): TracingBackend {
  return {
    name: "mock",
    init: vi.fn(async () => {}),
    exportSpans: vi.fn(async () => {}),
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
    emit(name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) {
      for (const handler of handlers.get(name) ?? []) {
        void handler(event, ctx);
      }
    },
  };
}

const baseConfig: TracingConfig = {
  enabled: true,
  backend: "log",
  otlpEndpoint: "http://localhost:4318",
  sampleRate: 1,
  traceDir: "./traces",
  maxSpansPerTrace: 10,
  captureMessageBody: false,
};

describe("registerTracingPluginHooks", () => {
  beforeEach(() => {
    resetTraceStore();
  });

  it("message_received 创建 root span，agent_end 结束并导出", async () => {
    const backend = createMockBackend();
    const api = createMockApi();

    registerTracingPluginHooks(api as never, {
      backend,
      sampler: new TracingSampler(1),
      config: baseConfig,
    });

    api.emit(
      "message_received",
      { content: "hello" },
      { sessionKey: "agent:main:direct:user1", runId: "run-1", channelId: "wecom" },
    );

    expect(getActiveSpanCount()).toBe(1);

    await api.emit("agent_end", { success: true }, { sessionKey: "agent:main:direct:user1", runId: "run-1" });

    expect(getActiveSpanCount()).toBe(0);
    expect(getRecentTraceCount()).toBe(1);
    expect(backend.exportSpans).toHaveBeenCalled();
  });

  it("before_tool_call / after_tool_call 创建并结束 tool span", async () => {
    const backend = createMockBackend();
    const api = createMockApi();

    registerTracingPluginHooks(api as never, {
      backend,
      sampler: new TracingSampler(1),
      config: baseConfig,
    });

    api.emit(
      "message_received",
      {},
      { sessionKey: "sk-1", runId: "run-2", channelId: "mqtt" },
    );

    api.emit(
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
  });
});

describe("trace-store getTraceSpans", () => {
  beforeEach(() => {
    resetTraceStore();
  });

  it("返回已完成的 trace spans", async () => {
    const backend = createMockBackend();
    const api = createMockApi();

    registerTracingPluginHooks(api as never, {
      backend,
      sampler: new TracingSampler(1),
      config: baseConfig,
    });

    api.emit("message_received", {}, { sessionKey: "sk-3", runId: "run-4", channelId: "mqtt", traceId: "abc123" });
    await api.emit("agent_end", { success: true }, { sessionKey: "sk-3", runId: "run-4" });

    const traces = getTraceSpans("abc123");
    expect(traces?.length).toBe(1);
    expect(traces?.[0]?.name).toBe("message.received");
  });
});
