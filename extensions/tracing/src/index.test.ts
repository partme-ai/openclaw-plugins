import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "./index.js";
import { SharedTraceJournal } from "./runtime/shared-trace-journal.js";
import { resolveStateDir } from "openclaw/plugin-sdk/state-paths";

type Hook = (event?: Record<string, unknown>, ctx?: Record<string, unknown>) => Promise<void> | void;
let testTraceDir: string;
beforeEach(async () => {
  testTraceDir = await mkdtemp(join(tmpdir(), "tracing-index-test-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", testTraceDir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(testTraceDir, { recursive: true, force: true });
});

async function emit(hooks: Map<string, Hook[]>, name: string, event = {}, ctx = {}) {
  for (const handler of hooks.get(name) ?? []) await handler(event, ctx);
}

function response() {
  return {
    status: 0,
    headers: {} as Record<string, string>,
    body: "",
    setHeader: vi.fn(),
    writeHead(status: number, headers: Record<string, string>) {
      this.status = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body = body;
    },
  };
}

describe("tracing plugin", () => {
  it("ID、生命周期和 Gateway 认证 GET-only 路由与 OpenClaw 2026.9.6 对齐", async () => {
    const hooks = new Map<string, Hook[]>();
    const routes = new Map<string, { auth?: string; match?: string; handler: Hook }>();
    const api = {
      config: {},
      pluginConfig: { enabled: true, backend: "log", sampleRate: 1, traceDir: testTraceDir },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      on(name: string, handler: Hook) {
        hooks.set(name, [...(hooks.get(name) ?? []), handler]);
      },
      registerHttpRoute(route: { path: string; auth?: string; match?: string; handler: Hook }) {
        routes.set(route.path, route);
      },
    };

    expect(plugin.id).toBe("tracing");
    plugin.register(api as never);
    expect(routes.size).toBe(3);
    expect([...routes.values()].every((route) => route.auth === "gateway")).toBe(true);
    expect([...routes.values()].every((route) => route.match === "exact")).toBe(true);
    expect(hooks.get("message_received")).toHaveLength(1);
    expect(hooks.get("reply_payload_sending")).toHaveLength(1);
    expect(hooks.get("agent_end")).toHaveLength(1);

    await emit(hooks, "gateway_start");
    const statusResponse = response();
    await routes.get("/tracing/status")?.handler(
      { method: "GET", url: "/tracing/status", headers: {} },
      statusResponse as never,
    );
    expect(statusResponse.status).toBe(200);
    expect(JSON.parse(statusResponse.body)).toMatchObject({
      ok: true,
      data: { plugin: "tracing", status: "active", backend: "log" },
    });

    const methodResponse = response();
    await routes.get("/tracing/status")?.handler(
      { method: "POST", url: "/tracing/status", headers: {} },
      methodResponse as never,
    );
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.setHeader).toHaveBeenCalledWith("Allow", "GET");

    const limitResponse = response();
    await routes.get("/tracing/traces")?.handler(
      { method: "GET", url: "/tracing/traces?limit=NaN", headers: {} },
      limitResponse as never,
    );
    expect(limitResponse.status).toBe(400);

    await emit(hooks, "gateway_stop");
  });

  it("gateway_start 与首个 Hook 并发时复用同一初始化 Promise，不漏首条 Trace", async () => {
    const hooks = new Map<string, Hook[]>();
    const routes = new Map<string, { handler: Hook }>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const api = {
      config: {},
      pluginConfig: { enabled: true, backend: "log", sampleRate: 1, traceDir: testTraceDir },
      logger,
      on(name: string, handler: Hook) {
        hooks.set(name, [...(hooks.get(name) ?? []), handler]);
      },
      registerHttpRoute(route: { path: string; handler: Hook }) {
        routes.set(route.path, route);
      },
    };
    plugin.register(api as never);

    await Promise.all([
      emit(hooks, "gateway_start"),
      hooks.get("message_received")?.[0]?.(
        { content: "first" },
        { sessionKey: "sk-concurrent-init", runId: "run-concurrent-init", channelId: "wecom" },
      ),
    ]);

    const statusResponse = response();
    await routes.get("/tracing/status")?.handler(
      { method: "GET", url: "/tracing/status", headers: {} },
      statusResponse as never,
    );
    expect(JSON.parse(statusResponse.body)).toMatchObject({
      data: { status: "active", activeSpans: 1, activeTraces: 1 },
    });
    expect(logger.info.mock.calls.filter(([message]) => String(message).includes("Log backend initialized"))).toHaveLength(1);
    await emit(hooks, "gateway_stop");
  });

  it("停止后的迟到 Hook 不复活后端，新一轮启动可恢复", async () => {
    const hooks = new Map<string, Hook[]>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const api = {
      config: {}, pluginConfig: { enabled: true, backend: "log", sampleRate: 1, traceDir: testTraceDir }, logger,
      on(name: string, handler: Hook) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
      registerHttpRoute: vi.fn(),
    };
    plugin.register(api as never);
    await emit(hooks, "gateway_start");
    await emit(hooks, "gateway_stop");
    const initializations = () => logger.info.mock.calls.filter(([message]) => String(message).includes("Log backend initialized")).length;
    expect(initializations()).toBe(1);
    await emit(hooks, "session_end", {}, { sessionKey: "late-session", runId: "late-run" });
    expect(initializations()).toBe(1);
    await emit(hooks, "gateway_start");
    expect(initializations()).toBe(2);
    await emit(hooks, "gateway_stop");
  });

  it("Gateway 查询读取另一个 runtime 写入的同一 traceId", async () => {
    const traceDir = await mkdtemp(join(tmpdir(), "tracing-route-test-"));
    try {
      const routes = new Map<string, { auth?: string; handler: Hook }>();
      const api = {
        config: {}, pluginConfig: { enabled: true, backend: "log", traceDir },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        on: vi.fn(),
        registerHttpRoute(route: { path: string; auth?: string; handler: Hook }) { routes.set(route.path, route); },
      };
      plugin.register(api as never);
      const traceId = "e".repeat(32);
      const writer = new SharedTraceJournal(join(testTraceDir, "plugins", "tracing", "journal"), { scopeRoot: testTraceDir });
      await writer.writeSpan({ traceId, spanId: "f".repeat(16), name: "agent.run", kind: "internal",
        startTimeMs: 1, endTimeMs: 2, attributes: {}, events: [], status: "ok" });
      const status = response();
      await routes.get("/tracing/status")?.handler({ method: "GET", url: "/tracing/status", headers: {} }, status as never);
      expect(JSON.parse(status.body).data.recentTraces).toBe(1);
      const list = response();
      await routes.get("/tracing/traces")?.handler({ method: "GET", url: "/tracing/traces", headers: {} }, list as never);
      expect(JSON.parse(list.body).data).toMatchObject([{ traceId, rootSpan: "agent.run" }]);
      const detail = response();
      await routes.get("/tracing/trace")?.handler({ method: "GET", url: `/tracing/trace?traceId=${traceId}`, headers: {} }, detail as never);
      expect(JSON.parse(detail.body).data).toMatchObject({ traceId, spans: [{ spanId: "f".repeat(16) }] });
      expect([...routes.values()].every((route) => route.auth === "gateway")).toBe(true);
    } finally {
      await rm(traceDir, { recursive: true, force: true });
    }
  });

  it("公开 state-paths 契约把两个 profile 的查询 journal 隔离", async () => {
    const secondProfile = await mkdtemp(join(tmpdir(), "tracing-profile-b-"));
    try {
      const register = () => {
        const routes = new Map<string, Hook>();
        plugin.register({
          config: {}, pluginConfig: { enabled: true, backend: "log" },
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, on: vi.fn(),
          registerHttpRoute(route: { path: string; handler: Hook }) { routes.set(route.path, route.handler); },
        } as never);
        return routes;
      };
      const firstState = resolveStateDir();
      expect(firstState).toBe(testTraceDir);
      const firstRoutes = register();
      const traceId = "d".repeat(32);
      await new SharedTraceJournal(join(firstState, "plugins", "tracing", "journal"), { scopeRoot: firstState })
        .writeSpan({ traceId, spanId: "1".repeat(16), name: "profile-a", kind: "internal",
          startTimeMs: 1, endTimeMs: 2, attributes: {}, events: [], status: "ok" });
      vi.stubEnv("OPENCLAW_STATE_DIR", secondProfile);
      expect(resolveStateDir()).toBe(secondProfile);
      const secondRoutes = register();
      const secondList = response();
      await secondRoutes.get("/tracing/traces")?.({ method: "GET", url: "/tracing/traces", headers: {} }, secondList as never);
      expect(JSON.parse(secondList.body).data).toEqual([]);
      const firstList = response();
      await firstRoutes.get("/tracing/traces")?.({ method: "GET", url: "/tracing/traces", headers: {} }, firstList as never);
      expect(JSON.parse(firstList.body).data).toMatchObject([{ traceId }]);
    } finally {
      await rm(secondProfile, { recursive: true, force: true });
    }
  });

  it("相对 traceDir 在 profile 下解析并拒绝越界", async () => {
    const hooks = new Map<string, Hook[]>();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const makeApi = (traceDir: string) => ({
      config: {}, pluginConfig: { enabled: true, backend: "file", traceDir }, logger,
      on(name: string, handler: Hook) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
      registerHttpRoute: vi.fn(),
    });
    expect(() => plugin.register(makeApi("../outside") as never)).toThrow(/state directory/);
    plugin.register(makeApi("./relative-traces") as never);
    await emit(hooks, "gateway_start");
    expect(logger.info.mock.calls.some(([message]) => String(message).includes(join(testTraceDir, "relative-traces")))).toBe(true);
    await emit(hooks, "gateway_stop");
  });

  it("共享查询损坏时 status 报 queryHealth 故障且不泄露路径", async () => {
    const journalDir = join(testTraceDir, "plugins", "tracing", "journal");
    await mkdir(journalDir, { recursive: true });
    const target = join(testTraceDir, "private-target.sqlite");
    await writeFile(target, "secret");
    await symlink(target, join(journalDir, "journal.sqlite"));
    const routes = new Map<string, Hook>();
    plugin.register({
      config: {}, pluginConfig: { enabled: true, backend: "log" },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, on: vi.fn(),
      registerHttpRoute(route: { path: string; handler: Hook }) { routes.set(route.path, route.handler); },
    } as never);
    const status = response();
    await routes.get("/tracing/status")?.({ method: "GET", url: "/tracing/status", headers: {} }, status as never);
    expect(status.status).toBe(503);
    expect(JSON.parse(status.body)).toMatchObject({ ok: false, data: { queryHealth: { healthy: false } } });
    expect(status.body).not.toContain(testTraceDir);
    expect(status.body).not.toContain("secret");
  });
});
