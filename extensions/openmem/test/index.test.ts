import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOpenMemSearchManager,
  normalizeTurn,
  OpenMemClient,
  OpenMemCoordinator,
  OpenMemSearchManager,
  resolveConfig,
} from "../src/index.js";
import type { OpenMemConfig } from "../src/config.js";

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function makeConfig(overrides: Partial<OpenMemConfig> = {}): OpenMemConfig {
  return resolveConfig({
    pluginConfig: { retryBaseDelayMs: 0, allowSharedRecall: true, ...overrides },
  } as never);
}

describe("OpenMem 配置", () => {
  it("拒绝非 loopback 明文 HTTP", () => {
    expect(() => resolveConfig({ pluginConfig: { baseUrl: "http://openmem.example.com" } } as never)).toThrow("HTTPS");
  });

  it("规范化 URL，并拒绝越界整数而不是静默截断", () => {
    const config = resolveConfig({ pluginConfig: { baseUrl: "http://127.0.0.1:3317/" } } as never);
    expect(config.baseUrl).toBe("http://127.0.0.1:3317");
    expect(config.maxAttempts).toBe(3);
    expect(config.allowSharedRecall).toBe(false);
    expect(() => resolveConfig({ pluginConfig: { maxAttempts: 99 } } as never)).toThrow("maxAttempts");
    expect(() => resolveConfig({ pluginConfig: { timeoutMs: "5000" } } as never)).toThrow("timeoutMs");
  });

  it("拒绝未知字段、错误布尔类型和 Header 注入", () => {
    expect(() => resolveConfig({ pluginConfig: { surprise: true } } as never)).toThrow("unknown config field");
    expect(() => resolveConfig({ pluginConfig: { required: "true" } } as never)).toThrow("required");
    expect(() => resolveConfig({ pluginConfig: { agentId: 123 } } as never)).toThrow("agentId");
    expect(() => resolveConfig({ pluginConfig: { authScheme: "Bearer\r\nX-Evil: 1" } } as never)).toThrow("authScheme");
  });

  it("配置密钥环境变量但变量缺失时失败", () => {
    expect(() => resolveConfig({ pluginConfig: { apiKeyEnv: "MISSING_OPENMEM_KEY" } } as never)).toThrow("not set");
  });
});

describe("OpenMemClient", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.OPENMEM_TEST_KEY; });

  it("对安全请求重试 503", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: "down" }, 503)).mockResolvedValueOnce(json({ status: "ok" }));
    const client = new OpenMemClient(makeConfig());
    await expect(client.get("/healthz")).resolves.toEqual({ status: "ok" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("注入可配置鉴权头且错误不泄露密钥", async () => {
    process.env.OPENMEM_TEST_KEY = "very-secret-token";
    vi.mocked(fetch).mockResolvedValueOnce(new Response("failed\nvery-secret-token\u0000", { status: 401 }));
    const client = new OpenMemClient(makeConfig({ apiKeyEnv: "OPENMEM_TEST_KEY", maxAttempts: 1 }));
    const error = await client.get("/healthz").catch((caught: unknown) => caught);
    const headers = new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer very-secret-token");
    expect(String(error)).toContain("[REDACTED]");
    expect(String(error)).not.toContain("very-secret-token");
    expect(String(error)).not.toContain("\u0000");
  });

  it("限制响应体大小", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ value: "x".repeat(2_000) }));
    const client = new OpenMemClient(makeConfig({ maxResponseBytes: 1024, maxAttempts: 1 }));
    await expect(client.get("/healthz")).rejects.toThrow("exceeds");
  });

  it("无 Content-Length 时也会流式截断并取消超大响应", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(800));
        controller.enqueue(new Uint8Array(800));
      },
      cancel() { cancelled = true; },
    });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(stream));
    const client = new OpenMemClient(makeConfig({ maxResponseBytes: 1024, maxAttempts: 1 }));
    await expect(client.get("/healthz")).rejects.toThrow("exceeds");
    expect(cancelled).toBe(true);
  });

  it("拒绝绝对 URL，避免内部调用点绕过 Sidecar 地址", async () => {
    const client = new OpenMemClient(makeConfig({ maxAttempts: 1 }));
    await expect(client.get("https://attacker.example/data")).rejects.toThrow("relative API path");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("拒绝无效 JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    const client = new OpenMemClient(makeConfig({ maxAttempts: 1 }));
    await expect(client.get("/healthz")).rejects.toThrow("invalid JSON");
  });

  it("close 会拒绝后续请求", async () => {
    const client = new OpenMemClient(makeConfig());
    client.close();
    await expect(client.get("/healthz")).rejects.toThrow("closed");
  });
});

describe("OpenMemSearchManager 真实 API 契约", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("读取实际 text 字段并保留 source/citation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({
      chunks: [{ text: "OpenMem FTS5 storage", score: 0.88, source: "memory:mem-1", recall_type: "knowledge" }],
      sources: ["memory:mem-1"],
    }));
    const manager = createOpenMemSearchManager("http://127.0.0.1:3317");
    const results = await manager.search("FTS5", { maxResults: 5 });
    expect(results[0]).toMatchObject({ path: "openmem/memory/mem-1", score: 0.88, snippet: "OpenMem FTS5 storage" });
    expect(results[0].citation).toBe("openmem/memory/mem-1#L1");
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.mode).toBe("hybrid");
  });

  it("跳过不符合 OpenMem Schema 的 chunk", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ chunks: [{ content: "old wrong field", score: 1 }], sources: [] }));
    expect(await createOpenMemSearchManager("http://127.0.0.1:3317").search("x")).toEqual([]);
  });

  it("readFile 优先读取搜索缓存并支持分页", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({
      chunks: [{ text: "line1\nline2\nline3", score: 1, source: "archive:a1", recall_type: "continuity" }], sources: [],
    }));
    const manager = createOpenMemSearchManager("http://127.0.0.1:3317");
    await manager.search("line");
    const result = await manager.readFile({ relPath: "openmem/archive/a1", from: 1, lines: 1 });
    expect(result.text).toBe("line2");
    expect(result.nextFrom).toBe(2);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("readFile 可按 source 调用正式详情端点", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ memory_id: "m1", lossless_restatement: "fact" }));
    const manager = createOpenMemSearchManager("http://127.0.0.1:3317");
    const result = await manager.readFile({ relPath: "openmem/memory/m1" });
    expect(result.text).toContain("lossless_restatement");
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/externalized-memories/m1");
  });

  it("健康探测真实调用 /healthz，但诚实报告无 embedding/vector", async () => {
    vi.mocked(fetch).mockImplementation(async () => json({ status: "ok" }));
    const manager = createOpenMemSearchManager("http://127.0.0.1:3317");
    expect((await manager.probeEmbeddingAvailability()).ok).toBe(false);
    expect(await manager.probeVectorAvailability()).toBe(false);
    expect(manager.status().fts?.available).toBe(true);
    expect(manager.status().vector?.enabled).toBe(false);
  });

  it("按字节预算淘汰最旧内容，避免条目数上限掩盖大对象内存占用", async () => {
    const large = "x".repeat(700_000);
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ chunks: [{ text: large, score: 1, source: "memory:first", recall_type: "knowledge" }], sources: [] }))
      .mockResolvedValueOnce(json({ chunks: [{ text: large, score: 1, source: "memory:second", recall_type: "knowledge" }], sources: [] }));
    const config = makeConfig({ maxCacheBytes: 1024 * 1024 });
    const client = new OpenMemClient(config);
    const manager = new OpenMemSearchManager(client, new OpenMemCoordinator(client, "main"), config);
    await manager.search("first");
    await manager.search("second");
    expect(manager.status().chunks).toBe(1);
    expect((manager.status().custom as { cacheBytes: number }).cacheBytes).toBeLessThanOrEqual(config.maxCacheBytes);
  });
});

describe("OpenMem session 生命周期", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("只截取当前轮并支持 OpenClaw 内容块", () => {
    expect(normalizeTurn([
      { role: "user", content: "old" }, { role: "assistant", content: "old answer" },
      { role: "user", content: [{ type: "text", text: "new" }] }, { role: "assistant", content: "answer" },
    ])).toEqual([{ role: "user", content: "new" }, { role: "assistant", content: "answer" }]);
  });

  it("start → ingest(idempotent eventId) → append → commit", async () => {
    const calls: Array<{ url: string; body?: any }> = [];
    let appendNotes: string[] = [];
    let ingestedEvents: any[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.includes("/sessions?status=ACTIVE")) return json({ sessions: [] });
      if (url.endsWith("/sessions/start")) return json({ session_id: "om-s1", agent_id: "main", thread_id: body.threadId, status: "ACTIVE", updated_at: "2026-07-15" }, 201);
      if (url.endsWith("/events/ingest")) {
        ingestedEvents = body.events;
        return json({ ingested: body.events, skipped: 0 }, 201);
      }
      if (url.endsWith("/sessions/om-s1")) return json({ session_id: "om-s1", metadata: { append_notes: appendNotes } });
      if (url.includes("/events?sessionId=om-s1")) return json({ events: ingestedEvents });
      if (url.endsWith("/sessions/om-s1/append")) {
        appendNotes = [body.content.slice(0, 500)];
        return json({ ok: true });
      }
      if (url.endsWith("/sessions/om-s1/commit")) return json({ archive: {} });
      throw new Error(`unexpected ${url}`);
    });
    const coordinator = new OpenMemCoordinator(new OpenMemClient(makeConfig()), "main");
    await coordinator.ingestTurn({ sessionKey: "openclaw-s1", runId: "run-1", messages: [{ role: "user", content: "hello" }] });
    await coordinator.endSession("openclaw-s1");
    const ingest = calls.find((call) => call.url.endsWith("/events/ingest"));
    expect(ingest?.body.events[0].eventId).toHaveLength(64);
    expect(ingest?.body.events[0].payload.openclawTurnId).toHaveLength(64);
    expect(calls.some((call) => call.url.endsWith("/sessions/om-s1/commit"))).toBe(true);
  });

  it("重启后根据持久事件补齐 ingest 与 append 之间的崩溃窗口", async () => {
    let threadId = "";
    let ingestedEvents: any[] = [];
    let appendAttempts = 0;
    let appendNotes: string[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (url.includes("/sessions?status=ACTIVE")) {
        return json({ sessions: threadId ? [{ session_id: "recover-s1", agent_id: "main", thread_id: threadId, status: "ACTIVE", updated_at: "2026-07-15" }] : [] });
      }
      if (url.endsWith("/sessions/start")) {
        threadId = body.threadId;
        return json({ session_id: "recover-s1", agent_id: "main", thread_id: threadId, status: "ACTIVE", updated_at: "2026-07-15" }, 201);
      }
      if (url.endsWith("/events/ingest")) {
        ingestedEvents = body.events;
        return json({ ingested: body.events, skipped: 0 }, 201);
      }
      if (url.includes("/events?sessionId=recover-s1")) return json({ events: ingestedEvents });
      if (url.endsWith("/sessions/recover-s1")) return json({ session_id: "recover-s1", metadata: { append_notes: appendNotes } });
      if (url.endsWith("/sessions/recover-s1/append")) {
        appendAttempts += 1;
        if (appendAttempts === 1) throw new Error("process terminated before append completed");
        appendNotes = [body.content.slice(0, 500)];
        return json({ ok: true });
      }
      throw new Error(`unexpected ${url}`);
    });

    const config = makeConfig({ maxAttempts: 1 });
    const first = new OpenMemCoordinator(new OpenMemClient(config), "main");
    await expect(first.ingestTurn({ sessionKey: "recover", runId: "run-recover", messages: [{ role: "user", content: "durable turn" }] })).rejects.toThrow();

    const restarted = new OpenMemCoordinator(new OpenMemClient(config), "main");
    await expect(restarted.startSession("recover")).resolves.toBe("recover-s1");
    expect(appendAttempts).toBe(2);
    expect(appendNotes[0]).toContain("[openclaw-turn:");
    expect(appendNotes[0]).toContain("durable turn");
  });

  it("安全默认优先对同 thread 的最新归档会话做 continuity 召回", async () => {
    let threadId = "";
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/sessions/start")) {
        const body = JSON.parse(String(init?.body)); threadId = body.threadId;
        return json({ session_id: "active", agent_id: "main", thread_id: threadId, status: "ACTIVE", updated_at: "2026-07-15" }, 201);
      }
      if (url.includes("/sessions?status=ACTIVE")) return json({ sessions: [] });
      if (url.includes("/sessions?status=ARCHIVED")) return json({ sessions: [{ session_id: "archived", agent_id: "main", thread_id: threadId, status: "ARCHIVED", updated_at: "2026-07-15" }] });
      if (url.endsWith("/inspect/search")) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ mode: "continuity", sessionId: "archived" });
        return json({ chunks: [{ text: "previous summary", score: 1, source: "archive:a", recall_type: "continuity" }], sources: [] });
      }
      throw new Error(`unexpected ${url}`);
    });
    const config = makeConfig({ allowSharedRecall: false });
    const client = new OpenMemClient(config);
    const coordinator = new OpenMemCoordinator(client, "main");
    await coordinator.startSession("same-thread");
    const manager = new OpenMemSearchManager(client, coordinator, config);
    expect((await manager.search("previous", { sessionKey: "same-thread" }))[0].snippet).toBe("previous summary");
  });

  it("重启后没有 ACTIVE 会话时回退到同 thread 最新归档", async () => {
    let threadId = "";
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/sessions?status=ACTIVE")) return json({ sessions: [] });
      if (url.endsWith("/sessions/start")) {
        const body = JSON.parse(String(init?.body));
        threadId = body.threadId;
        return json({ session_id: "seed", agent_id: "main", thread_id: threadId, status: "ACTIVE", updated_at: "2026-07-15" });
      }
      if (url.includes("/sessions?status=ARCHIVED")) {
        return json({ sessions: [{ session_id: "archived", agent_id: "main", thread_id: threadId, status: "ARCHIVED", updated_at: "2026-07-16" }] });
      }
      if (url.endsWith("/inspect/search")) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ mode: "continuity", sessionId: "archived" });
        return json({ chunks: [{ text: "archived summary", score: 1, source: "archive:a", recall_type: "continuity" }], sources: [] });
      }
      throw new Error(`unexpected ${url}`);
    });
    const config = makeConfig({ allowSharedRecall: false });
    const client = new OpenMemClient(config);
    // 第一个协调器创建 session 并取得真实 threadId；第二个协调器代表 Gateway 重启后的空缓存。
    const seeded = new OpenMemCoordinator(client, "main");
    await seeded.startSession("restart-thread");
    const restarted = new OpenMemCoordinator(client, "main");
    const manager = new OpenMemSearchManager(client, restarted, config);
    expect((await manager.search("archived", { sessionKey: "restart-thread" }))[0].snippet).toBe("archived summary");
  });
});
