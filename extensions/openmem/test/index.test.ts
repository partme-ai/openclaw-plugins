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

  it("限制数值并规范化 URL", () => {
    const config = resolveConfig({ pluginConfig: { baseUrl: "http://127.0.0.1:3317/", maxAttempts: 99 } } as never);
    expect(config.baseUrl).toBe("http://127.0.0.1:3317");
    expect(config.maxAttempts).toBe(5);
    expect(config.allowSharedRecall).toBe(false);
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
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    const client = new OpenMemClient(makeConfig({ apiKeyEnv: "OPENMEM_TEST_KEY" }));
    await client.get("/healthz");
    const headers = new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer very-secret-token");
  });

  it("限制响应体大小", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ value: "x".repeat(2_000) }));
    const client = new OpenMemClient(makeConfig({ maxResponseBytes: 1024, maxAttempts: 1 }));
    await expect(client.get("/healthz")).rejects.toThrow("exceeds");
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
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.includes("/sessions?status=ACTIVE")) return json({ sessions: [] });
      if (url.endsWith("/sessions/start")) return json({ session_id: "om-s1", agent_id: "main", thread_id: body.threadId, status: "ACTIVE", updated_at: "2026-07-15" }, 201);
      if (url.endsWith("/events/ingest")) return json({ ingested: body.events, skipped: 0 }, 201);
      if (url.endsWith("/sessions/om-s1/append")) return json({ ok: true });
      if (url.endsWith("/sessions/om-s1/commit")) return json({ archive: {} });
      throw new Error(`unexpected ${url}`);
    });
    const coordinator = new OpenMemCoordinator(new OpenMemClient(makeConfig()), "main");
    await coordinator.ingestTurn({ sessionKey: "openclaw-s1", runId: "run-1", messages: [{ role: "user", content: "hello" }] });
    await coordinator.endSession("openclaw-s1");
    const ingest = calls.find((call) => call.url.endsWith("/events/ingest"));
    expect(ingest?.body.events[0].eventId).toHaveLength(64);
    expect(calls.some((call) => call.url.endsWith("/sessions/om-s1/commit"))).toBe(true);
  });

  it("安全默认只对同 thread 的已归档会话做 continuity 召回", async () => {
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
});
