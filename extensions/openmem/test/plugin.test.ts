import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import plugin from "../src/index.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function createApi(pluginConfig: Record<string, unknown> = {}) {
  const hooks = new Map<string, (...args: any[]) => any>();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    registrationMode: "full",
    pluginConfig,
    logger,
    hooks,
    registerService: vi.fn(),
    registerMemoryCapability: vi.fn(),
    registerTool: vi.fn(),
    on: vi.fn((name: string, handler: (...args: any[]) => any) => hooks.set(name, handler)),
  };
}

function registerPlugin(api: ReturnType<typeof createApi>): void {
  if (!plugin.register) throw new Error("plugin register hook is missing");
  plugin.register(api as never);
}

describe("openmem OpenClaw 2026.7.1 contract", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("disabled 时不注册副作用", () => {
    const api = createApi({ enabled: false });
    registerPlugin(api);
    expect(api.registerService).not.toHaveBeenCalled();
    expect(api.registerMemoryCapability).not.toHaveBeenCalled();
    expect(api.logger.info).toHaveBeenCalledWith("[openmem] disabled");
  });

  it("注册 service、memory capability、tool factory 和三个生命周期 hook", () => {
    const api = createApi();
    registerPlugin(api);
    expect(api.registerService).toHaveBeenCalledOnce();
    expect(api.registerMemoryCapability).toHaveBeenCalledOnce();
    expect(typeof api.registerTool.mock.calls[0][0]).toBe("function");
    expect([...api.hooks.keys()].sort()).toEqual(["agent_end", "session_end", "session_start"]);
  });

  it("required=false 时 sidecar 启动失败只降级告警", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("connection refused"));
    const api = createApi({ maxAttempts: 1 });
    registerPlugin(api);
    const service = api.registerService.mock.calls[0][0];
    await expect(service.start({ logger: api.logger })).resolves.toBeUndefined();
    expect(api.logger.warn).toHaveBeenCalledWith(expect.stringContaining("sidecar unavailable"));
  });

  it("required=true 时 sidecar 启动失败会 fail-fast", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("connection refused"));
    const api = createApi({ required: true, maxAttempts: 1 });
    registerPlugin(api);
    const service = api.registerService.mock.calls[0][0];
    await expect(service.start({ logger: api.logger })).rejects.toThrow("request failed");
  });

  it("runtime 和 tool 都拒绝非目标 Agent", async () => {
    const api = createApi({ agentId: "main" });
    registerPlugin(api);
    const runtime = api.registerMemoryCapability.mock.calls[0][0].runtime;
    expect((await runtime.getMemorySearchManager({ agentId: "other" })).manager).toBeNull();
    const factory = api.registerTool.mock.calls[0][0];
    expect(factory({ agentId: "other" })).toBeNull();
  });

  it("tool 使用可信 sessionKey 并按 maxSearchResults 限制", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/sessions?status=ACTIVE") || url.includes("/sessions?status=ARCHIVED")) {
        return json({ sessions: [] });
      }
      if (url.endsWith("/inspect/search")) {
        const body = JSON.parse(String(init?.body));
        expect(body.limit).toBe(3);
        return json({ chunks: [{ text: "shared fact", score: 0.9, source: "memory:m1", recall_type: "knowledge" }], sources: [] });
      }
      throw new Error(`unexpected ${url}`);
    });
    const api = createApi({ allowSharedRecall: true, maxSearchResults: 3 });
    registerPlugin(api);
    const factory = api.registerTool.mock.calls[0][0];
    const tool = factory({ agentId: "main", sessionKey: "s1" });
    const result = await tool.execute("call-1", { query: "fact", limit: 999 });
    expect(result.details.count).toBe(1);
    expect(result.content[0].text).toContain("shared fact");
  });

  it("agent_end 仅上传当前轮且 eventId 可幂等", async () => {
    const calls: Array<{ url: string; body?: any }> = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.includes("/sessions?status=ACTIVE")) return json({ sessions: [] });
      if (url.endsWith("/sessions/start")) return json({ session_id: "om1", status: "ACTIVE", updated_at: "now" }, 201);
      if (url.endsWith("/events/ingest")) return json({ ingested: body.events, skipped: 0 }, 201);
      if (url.endsWith("/sessions/om1")) return json({ session_id: "om1", metadata: { append_notes: [] } });
      if (url.endsWith("/sessions/om1/append")) return json({ ok: true });
      throw new Error(`unexpected ${url}`);
    });
    const api = createApi();
    registerPlugin(api);
    await api.hooks.get("agent_end")?.(
      { success: true, runId: "run-1", messages: [
        { role: "user", content: "old" }, { role: "assistant", content: "old answer" },
        { role: "user", content: "new" }, { role: "assistant", content: "new answer" },
      ] },
      { agentId: "main", sessionKey: "s1" },
    );
    const ingest = calls.find((call) => call.url.endsWith("/events/ingest"));
    expect(ingest?.body.events.map((event: any) => event.content)).toEqual(["new", "new answer"]);
    expect(ingest?.body.events[0].eventId).toHaveLength(64);
  });

  it("service stop 关闭客户端，后续 sync 失败", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ status: "ok" }));
    const api = createApi();
    registerPlugin(api);
    const service = api.registerService.mock.calls[0][0];
    await service.start({ logger: api.logger });
    await service.stop();
    const runtime = api.registerMemoryCapability.mock.calls[0][0].runtime;
    const { manager } = await runtime.getMemorySearchManager({ agentId: "main" });
    await expect(manager.sync()).rejects.toThrow("closed");
  });

  it("service stop 取消并排空已经进入会话串行队列的 Hook", async () => {
    vi.mocked(fetch).mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const api = createApi({ maxAttempts: 1, timeoutMs: 120_000 });
    registerPlugin(api);
    const hook = api.hooks.get("agent_end")!;
    const pendingHook = hook(
      { success: true, runId: "shutdown-run", messages: [{ role: "user", content: "pending" }] },
      { agentId: "main", sessionKey: "shutdown-session" },
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const service = api.registerService.mock.calls[0][0];
    await expect(service.stop()).resolves.toBeUndefined();
    await expect(pendingHook).resolves.toBeUndefined();
    expect(api.logger.warn).toHaveBeenCalledWith(expect.stringContaining("ingest failed"));
  });
});
