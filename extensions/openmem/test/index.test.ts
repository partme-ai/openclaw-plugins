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
import plugin from "../src/index.js";

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

describe("OpenClaw prepared Agent registry", () => {
  it("同配置双 Gateway 生命周期重叠时共享 coordinator", async () => {
    const services: Array<{ stop: () => Promise<void> }> = [];
    let agentEnd: unknown;
    let rootAgentEnd: unknown;
    const api = {
      registrationMode: "full",
      source: "/installed/openmem/dist/index.js",
      pluginConfig: { baseUrl: "http://127.0.0.1:3318" },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      registerService(value: { stop: () => Promise<void> }) { services.push(value); },
      registerMemoryCapability() {},
      registerTool() {},
      on(name: string, handler: unknown) { if (name === "agent_end") agentEnd = handler; },
    };
    plugin.register!(api as never);
    rootAgentEnd = agentEnd;
    plugin.register!(api as never);
    expect(agentEnd).toBe(rootAgentEnd);
    agentEnd = undefined;
    plugin.register!({ ...api, registrationMode: "discovery" } as never);
    expect(agentEnd).toBe(rootAgentEnd);
    await services[0]!.stop();
    plugin.register!({ ...api, registrationMode: "discovery" } as never);
    expect(agentEnd).toBe(rootAgentEnd);
    await services[1]!.stop();
  });

  it("注册失败后相同配置可以重新注册而没有孤儿 coordinator", async () => {
    let service: { stop: () => Promise<void> } | undefined;
    let agentEnd: unknown;
    let failCapability = true;
    const api = {
      registrationMode: "full",
      pluginConfig: { baseUrl: "http://127.0.0.1:3319" },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      registerService(value: typeof service) { service = value; },
      registerMemoryCapability() { if (failCapability) throw new Error("registration failed"); },
      registerTool() {},
      on(name: string, handler: unknown) { if (name === "agent_end") agentEnd = handler; },
    };
    expect(() => plugin.register!(api as never)).toThrow("registration failed");
    failCapability = false;
    plugin.register!(api as never);
    agentEnd = undefined;
    plugin.register!({ ...api, registrationMode: "discovery" } as never);
    expect(typeof agentEnd).toBe("function");
    await service!.stop();
  });

  it("最后 full owner 停止后 discovery 晚到轮次仍摄取并提交归档", async () => {
    const services: Array<{ stop: () => Promise<void> }> = [];
    let agentEnd: any;
    let dispose: (() => void | Promise<void>) | undefined;
    const requests: string[] = [];
    let enteredIngest: (() => void) | undefined;
    let releaseIngest: (() => void) | undefined;
    const ingestEntered = new Promise<void>((resolve) => { enteredIngest = resolve; });
    const ingestGate = new Promise<void>((resolve) => { releaseIngest = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
      if (url.pathname === "/sessions" && url.searchParams.get("status") === "ACTIVE") return json({ sessions: [] });
      if (url.pathname === "/sessions/start") return json({ session_id: "late-session", status: "ACTIVE", updated_at: "now" }, 201);
      if (url.pathname === "/events/ingest") {
        enteredIngest?.();
        await ingestGate;
        return json({ ingested: 1, skipped: 0 }, 201);
      }
      if (url.pathname === "/sessions/late-session") return json({ session_id: "late-session", metadata: { append_notes: [] } });
      if (url.pathname === "/sessions/late-session/append") return json({ ok: true });
      if (url.pathname === "/events") return json({ events: [] });
      if (url.pathname === "/sessions/late-session/commit") return json({ session_id: "late-session", status: "ARCHIVED" });
      throw new Error(`unexpected ${url.pathname}`);
    }));
    const api = {
      registrationMode: "full",
      pluginConfig: { baseUrl: "http://127.0.0.1:3320" },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      registerService(value: (typeof services)[number]) { services.push(value); },
      registerMemoryCapability() {},
      registerTool() {},
      on(name: string, handler: unknown) { if (name === "agent_end") agentEnd = handler; },
    };
    try {
      plugin.register!(api as never);
      agentEnd = undefined;
      plugin.register!({
        ...api,
        registrationMode: "discovery",
        lifecycle: { onDispose(callback: typeof dispose) { dispose = callback; } },
      } as never);
      await services[0]!.stop();
      const lateTurn = agentEnd(
        { success: true, runId: "retained-generation", messages: [{ role: "user", content: "retained" }] },
        { agentId: "main", sessionKey: "late-session-key" },
      );
      await ingestEntered;
      // 旧 generation 摄取期间，新的 full owner 已接管；提交仍归属旧轮次。
      plugin.register!(api as never);
      releaseIngest?.();
      await lateTurn;
      expect(requests).toContain("POST /events/ingest");
      expect(requests).toContain("POST /sessions/late-session/commit");
      expect(requests.indexOf("POST /sessions/late-session/commit"))
        .toBeGreaterThan(requests.indexOf("POST /events/ingest"));
    } finally {
      releaseIngest?.();
      await Promise.all(services.map((service) => service.stop()));
      await dispose?.();
      vi.unstubAllGlobals();
    }
  });

  it("最后 discovery 释放等待已进入的摄取和提交", async () => {
    let service: { stop: () => Promise<void> } | undefined;
    let agentEnd: any;
    let dispose: (() => void | Promise<void>) | undefined;
    let enteredIngest: (() => void) | undefined;
    let releaseIngest: (() => void) | undefined;
    const ingestEntered = new Promise<void>((resolve) => { enteredIngest = resolve; });
    const ingestGate = new Promise<void>((resolve) => { releaseIngest = resolve; });
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
      if (url.pathname === "/sessions" && url.searchParams.get("status") === "ACTIVE") return json({ sessions: [] });
      if (url.pathname === "/sessions/start") return json({ session_id: "drain-session", status: "ACTIVE", updated_at: "now" }, 201);
      if (url.pathname === "/events/ingest") {
        enteredIngest?.();
        await ingestGate;
        return json({ ingested: 1, skipped: 0 }, 201);
      }
      if (url.pathname === "/sessions/drain-session") return json({ session_id: "drain-session", status: "ACTIVE", metadata: { append_notes: [] } });
      if (url.pathname === "/sessions/drain-session/append") return json({ ok: true });
      if (url.pathname === "/events") return json({ events: [] });
      if (url.pathname === "/sessions/drain-session/commit") return json({ status: "ARCHIVED" });
      throw new Error(`unexpected ${url.pathname}`);
    }));
    const api = {
      registrationMode: "full",
      pluginConfig: { baseUrl: "http://127.0.0.1:3322" },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      registerService(value: typeof service) { service = value; },
      registerMemoryCapability() {},
      registerTool() {},
      on(name: string, handler: unknown) { if (name === "agent_end") agentEnd = handler; },
    };
    try {
      plugin.register!(api as never);
      plugin.register!({
        ...api,
        registrationMode: "discovery",
        lifecycle: { onDispose(callback: typeof dispose) { dispose = callback; } },
      } as never);
      await service!.stop();
      const turn = agentEnd(
        { success: true, runId: "drain-run", messages: [{ role: "user", content: "drain" }] },
        { agentId: "main", sessionKey: "drain-key" },
      );
      await ingestEntered;
      const stopping = dispose?.();
      releaseIngest?.();
      await Promise.all([turn, stopping]);
      expect(requests).toContain("POST /sessions/drain-session/append");
      expect(requests).toContain("POST /sessions/drain-session/commit");
    } finally {
      releaseIngest?.();
      await service?.stop();
      await dispose?.();
      vi.unstubAllGlobals();
    }
  });

  it("晚到轮次提交结果不明时最后 owner 只核对状态而不重放 POST", async () => {
    let service: { stop: () => Promise<void> } | undefined;
    let agentEnd: any;
    let sessionEnd: any;
    let dispose: (() => void | Promise<void>) | undefined;
    let commitAttempts = 0;
    let threadId = "";
    const eventIds = new Set<string>();
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
      if (url.pathname === "/sessions" && url.searchParams.get("status") === "ACTIVE") return json({ sessions: threadId ? [{ session_id: "retry-session", agent_id: "main", thread_id: threadId, status: "ACTIVE", updated_at: "now" }] : [] });
      if (url.pathname === "/sessions" && url.searchParams.get("status") === "ARCHIVED") return json({ sessions: [] });
      if (url.pathname === "/sessions/start") {
        threadId = JSON.parse(String(init?.body)).threadId;
        return json({ session_id: "retry-session", status: "ACTIVE", updated_at: "now" }, 201);
      }
      if (url.pathname === "/events/ingest") {
        const events = JSON.parse(String(init?.body)).events as Array<{ eventId: string }>;
        const ingested = events.filter((event) => !eventIds.has(event.eventId));
        for (const event of ingested) eventIds.add(event.eventId);
        return json({ ingested: ingested.map((event) => ({ event_id: event.eventId })), skipped: events.length - ingested.length }, 201);
      }
      if (url.pathname === "/events") return json({ events: [] });
      if (url.pathname === "/sessions/retry-session") return json({ session_id: "retry-session", status: "ACTIVE", metadata: { append_notes: [] } });
      if (url.pathname === "/sessions/retry-session/append") return json({ ok: true });
      if (url.pathname === "/sessions/retry-session/commit") {
        if (init?.method === "GET") return json({ error: "unsupported" }, 404);
        commitAttempts += 1;
        return commitAttempts === 1 ? json({ error: "temporary failure" }, 503) : json({ status: "ARCHIVED" });
      }
      throw new Error(`unexpected ${url.pathname}`);
    }));
    const api = {
      registrationMode: "full",
      pluginConfig: { baseUrl: "http://127.0.0.1:3321", maxAttempts: 1 },
      logger: { info() {}, warn: vi.fn(), error() {}, debug() {} },
      registerService(value: typeof service) { service = value; },
      registerMemoryCapability() {},
      registerTool() {},
      on(name: string, handler: unknown) {
        if (name === "agent_end") agentEnd = handler;
        if (name === "session_end") sessionEnd = handler;
      },
    };
    try {
      plugin.register!(api as never);
      plugin.register!({
        ...api,
        registrationMode: "discovery",
        lifecycle: { onDispose(callback: typeof dispose) { dispose = callback; } },
      } as never);
      await service!.stop();
      await agentEnd(
        { success: true, runId: "retry-run", messages: [{ role: "user", content: "retry" }] },
        { agentId: "main", sessionKey: "retry-session-key" },
      );
      expect(commitAttempts).toBe(1);
      await dispose?.();
      expect(commitAttempts).toBe(1);
      expect(requests.filter((request) => request === "GET /sessions/retry-session").length).toBeGreaterThan(2);
      expect(api.logger.warn).toHaveBeenCalledWith(expect.stringContaining("manual reconciliation"));
      // 新 Gateway/runtime 已失去内存状态，持久 intent 仍阻止同一非幂等 POST 重放。
      plugin.register!(api as never);
      await sessionEnd({ sessionKey: "retry-session-key" }, { agentId: "main" });
      expect(commitAttempts).toBe(1);
    } finally {
      await service?.stop();
      await dispose?.();
      vi.unstubAllGlobals();
    }
  });

  it("discovery borrows the Gateway coordinator without registering another service", async () => {
    const hooks = new Map<string, unknown>();
    let service: { stop: () => Promise<void> } | undefined;
    let tool: unknown;
    const api = {
      registrationMode: "full",
      pluginConfig: { baseUrl: "http://127.0.0.1:3317" },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      registerService(value: typeof service) { service = value; },
      registerMemoryCapability() {},
      registerTool(value: unknown) { tool = value; },
      on(name: string, handler: unknown) { hooks.set(name, handler); },
    };
    plugin.register!(api as never);
    const rootService = service;
    const rootAgentEnd = hooks.get("agent_end");
    hooks.clear();
    service = undefined;
    tool = undefined;
    plugin.register!({ ...api, registrationMode: "discovery" } as never);
    expect(service).toBeUndefined();
    expect(typeof tool).toBe("function");
    expect(typeof hooks.get("agent_end")).toBe("function");
    expect(hooks.has("session_start")).toBe(false);
    expect(hooks.has("session_end")).toBe(false);
    expect(hooks.get("agent_end")).toBe(rootAgentEnd);
    await rootService!.stop();
  });
});

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
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      "failed\nvery-secret-token\u0000 Bearer proxy-secret sk-anothersecret123",
      { status: 401 },
    ));
    const client = new OpenMemClient(makeConfig({ apiKeyEnv: "OPENMEM_TEST_KEY", maxAttempts: 1 }));
    const error = await client.get("/healthz").catch((caught: unknown) => caught);
    const headers = new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer very-secret-token");
    expect(String(error)).toContain("[REDACTED]");
    expect(String(error)).not.toContain("very-secret-token");
    expect(String(error)).not.toContain("\u0000");
    expect(String(error)).not.toContain("proxy-secret");
    expect(String(error)).not.toContain("anothersecret123");
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

  it("在发出请求前拒绝超出字节预算的 JSON Body", async () => {
    const client = new OpenMemClient(makeConfig({ maxRequestBytes: 1024, maxAttempts: 1 }));
    await expect(client.post("/events/ingest", { content: "界".repeat(500) })).rejects.toThrow("request exceeds");
    expect(fetch).not.toHaveBeenCalled();
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

  it("close 会立即取消重试退避而不是等待定时器", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: "down" }, 503));
    const client = new OpenMemClient(makeConfig({ retryBaseDelayMs: 5_000, maxAttempts: 3 }));
    const pending = client.get("/healthz");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    client.close();
    // 关闭发生在首次 503 已返回之后，保留该原始故障，但不得再等待或发起第二次请求。
    await expect(pending).rejects.toThrow("OpenMem 503");
    expect(fetch).toHaveBeenCalledOnce();
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

  it("拒绝异常长 query 与负分 chunk", async () => {
    const manager = createOpenMemSearchManager("http://127.0.0.1:3317");
    await expect(manager.search("x".repeat(4_001))).rejects.toThrow("4000");
    vi.mocked(fetch).mockResolvedValueOnce(json({
      chunks: [{ text: "bad", score: -1, source: "memory:m1", recall_type: "knowledge" }],
      sources: [],
    }));
    await expect(manager.search("bad")).resolves.toEqual([]);
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

  it("把异常长当前轮限制为 100 条并保留起始 user 与最新回复", () => {
    const messages = [
      { role: "user", content: "question" },
      ...Array.from({ length: 150 }, (_, index) => ({ role: "tool", content: `tool-${index}` })),
      { role: "assistant", content: "answer" },
    ];
    const normalized = normalizeTurn(messages);
    expect(normalized).toHaveLength(100);
    expect(normalized[0]?.content).toBe("question");
    expect(normalized.at(-1)?.content).toBe("answer");
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
        return json({ ingested: body.events.map((event: { eventId: string }) => ({ ...event, event_id: event.eventId })), skipped: 0 }, 201);
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

  it("提交响应丢失但远端已经归档时不重放 POST", async () => {
    let threadId = "";
    let status: "ACTIVE" | "ARCHIVED" = "ACTIVE";
    let commitAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/sessions" && url.searchParams.get("status") === "ACTIVE") return json({ sessions: [] });
      if (url.pathname === "/sessions/start") {
        threadId = JSON.parse(String(init?.body)).threadId;
        return json({ session_id: "uncertain-session", agent_id: "main", thread_id: threadId, status, updated_at: "now" }, 201);
      }
      if (url.pathname === "/events/ingest") return json({ ingested: 1, skipped: 0 }, 201);
      if (url.pathname === "/events") return json({ events: [] });
      if (url.pathname === "/sessions/uncertain-session") return json({ session_id: "uncertain-session", status, metadata: { append_notes: [] } });
      if (url.pathname === "/archives") return json({ archives: [{ session_id: "uncertain-session", facts: [] }] });
      if (url.pathname === "/sessions/uncertain-session/append") return json({ ok: true });
      if (url.pathname === "/sessions/uncertain-session/commit") {
        commitAttempts += 1;
        status = "ARCHIVED";
        return json({ error: "response lost" }, 503);
      }
      throw new Error(`unexpected ${url.pathname}`);
    });
    const coordinator = new OpenMemCoordinator(new OpenMemClient(makeConfig({ maxAttempts: 1 })), "main");
    await coordinator.ingestTurn({ sessionKey: "uncertain-key", runId: "uncertain-run", messages: [{ role: "user", content: "hello" }] });
    await coordinator.endSession("uncertain-key");
    expect(commitAttempts).toBe(1);
  });

  it("重启后遇到已持久化提交意图时只在 Sidecar 声明幂等协议后恢复", async () => {
    let threadId = "";
    let status: "ACTIVE" | "ARCHIVED" = "ACTIVE";
    let intentWrites = 0;
    let commitAttempts = 0;
    let capabilityAvailable = false;
    let sessionStarts = 0;
    let intentEvent: { event_id: string; type: string } | undefined;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/sessions" && url.searchParams.get("status") === "ACTIVE") {
        return json({ sessions: threadId && status === "ACTIVE" ? [{ session_id: "resume-session", agent_id: "main", thread_id: threadId, status, updated_at: "now" }] : [] });
      }
      if (url.pathname === "/sessions/start") {
        threadId = JSON.parse(String(init?.body)).threadId;
        sessionStarts += 1;
        return json({ session_id: sessionStarts === 1 ? "resume-session" : "resume-session-2", agent_id: "main", thread_id: threadId, status: "ACTIVE", updated_at: "now" }, 201);
      }
      if (url.pathname === "/events") return json({ events: intentEvent ? [intentEvent] : [] });
      if (url.pathname === "/events/ingest") {
        intentWrites += 1;
        const event = JSON.parse(String(init?.body)).events[0];
        intentEvent = { event_id: event.eventId, type: "openclaw_commit_intent" };
        return intentWrites === 1 ? json({ ingested: [{ event_id: event.eventId }], skipped: 0 }, 201) : json({ ingested: [], skipped: 1 }, 201);
      }
      if (url.pathname === "/sessions/resume-session") return json({ session_id: "resume-session", status, metadata: { append_notes: [] } });
      if (url.pathname === "/archives") return json({ archives: [{ session_id: "resume-session", facts: [] }] });
      if (url.pathname === "/sessions/resume-session/commit" && init?.method === "GET") {
        return capabilityAvailable ? json({ idempotent: true, recoverable: true, status }) : json({ error: "unavailable" }, 503);
      }
      if (url.pathname === "/sessions/resume-session/commit" && init?.method === "POST") {
        commitAttempts += 1;
        if (commitAttempts === 1) throw new Error("connection lost before commit reached Sidecar");
        status = "ARCHIVED";
        return json({ archive: { archive_id: "stable" } });
      }
      throw new Error(`unexpected ${url.pathname}`);
    });

    const first = new OpenMemCoordinator(new OpenMemClient(makeConfig({ maxAttempts: 1 })), "main");
    await first.startSession("resume-key");
    await expect(first.endSession("resume-key")).rejects.toThrow();
    expect(status).toBe("ACTIVE");
    capabilityAvailable = true;
    const restarted = new OpenMemCoordinator(new OpenMemClient(makeConfig({ maxAttempts: 1 })), "main");
    expect(await restarted.startSession("resume-key")).toBe("resume-session-2");
    expect(commitAttempts).toBe(2);
    expect(status).toBe("ARCHIVED");
  });

  it("ARCHIVED 但缺少归档产物时保持结果不明且不重放提交", async () => {
    let status: "ACTIVE" | "ARCHIVED" = "ACTIVE";
    let commitAttempts = 0;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/sessions" && url.searchParams.get("status") === "ACTIVE") return json({ sessions: [] });
      if (url.pathname === "/sessions/start") return json({ session_id: "missing-archive", status: "ACTIVE", updated_at: "now" }, 201);
      if (url.pathname === "/events/ingest") {
        const events = JSON.parse(String(init?.body)).events as Array<{ eventId: string }>;
        return json({ ingested: events.map((event) => ({ event_id: event.eventId })), skipped: 0 }, 201);
      }
      if (url.pathname === "/events") return json({ events: [] });
      if (url.pathname === "/sessions/missing-archive") return json({ session_id: "missing-archive", status, metadata: { append_notes: [] } });
      if (url.pathname === "/sessions/missing-archive/append") return json({ ok: true });
      if (url.pathname === "/sessions/missing-archive/commit") {
        if (init?.method === "GET") return json({ error: "unsupported" }, 404);
        commitAttempts += 1;
        status = "ARCHIVED";
        return json({ error: "archive failed" }, 503);
      }
      if (url.pathname === "/archives") return json({ archives: [] });
      throw new Error(`unexpected ${url.pathname}`);
    });
    const coordinator = new OpenMemCoordinator(new OpenMemClient(makeConfig({ maxAttempts: 1 })), "main");
    await coordinator.ingestTurn({ sessionKey: "missing-archive-key", runId: "missing-run", messages: [{ role: "user", content: "hello" }] });
    await expect(coordinator.endSession("missing-archive-key")).rejects.toThrow("manual reconciliation");
    await expect(coordinator.startSession("missing-archive-key")).rejects.toThrow("archive is incomplete");
    await expect(coordinator.endSession("missing-archive-key")).rejects.toThrow("archive is incomplete");
    expect(commitAttempts).toBe(1);
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
