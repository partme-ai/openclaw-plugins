/**
 * RuntimeStore 的独立高基数边界。
 *
 * MetricsRegistry 有 series 上限，但渠道活动刷新还持有自己的 account Map；两者必须分别
 * 受限，否则攻击者可以在不新增指标 series 的情况下持续占用进程内存。
 */
import { describe, expect, it, vi } from "vitest";
import plugin from "../index.js";
import { MetricsRegistry } from "../diagnostics/metrics-registry.js";
import type { ResolvedPrometheusConfig } from "../config/plugin-config.js";
import {
  getRuntimeStore,
  initializeRuntimeStore,
  listObservedChannelAccounts,
  MAX_OBSERVED_CHANNEL_ACCOUNTS,
  rememberObservedChannelAccount,
} from "./store.js";

const config = {
  metricsPath: "/metrics",
  collectIntervalMs: 0,
  snapshotIntervalMs: 30_000,
  workloadWindowMs: 300_000,
  includeRuntime: true,
  monitoredProviders: [],
  scrapeAuthEnabled: false,
  scrapeBearerToken: undefined,
  instance: "test",
  collectorTimeoutMs: 1_000,
  maxScrapeSeries: 1_000,
} satisfies ResolvedPrometheusConfig;

describe("RuntimeStore observed channel accounts", () => {
  it("reports missing, fresh, and stale Router DLQ observations in telemetry health", async () => {
    const services: Array<{ start(context: unknown): Promise<void>; stop(): Promise<void> }> = [];
    const routes = new Map<string, (request: unknown, response: unknown) => Promise<void>>();
    plugin.register({ config: { plugins: { entries: { router: { enabled: true, config: { enabled: true } } } } },
      pluginConfig: { path: "/metrics", scrapeAuth: { enabled: false } },
      runtime: {}, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, on: vi.fn(),
      registerService(service: typeof services[number]) { services.push(service); },
      registerHttpRoute(route: { path: string; handler: typeof routes extends Map<string, infer V> ? V : never }) { routes.set(route.path, route.handler); },
    } as never);
    let diagnosticListener: ((event: unknown, metadata: unknown) => void) | undefined;
    await services[0].start({ internalDiagnostics: { onEvent(listener: typeof diagnosticListener) {
      diagnosticListener = listener; return () => {};
    }, emit: vi.fn() } });
    const readHealth = async () => {
      const response = { writeHead: vi.fn(), end: vi.fn(), statusCode: 200 };
      await routes.get("/metrics/health")?.({ method: "GET", url: "/metrics/health", headers: {} }, response);
      return JSON.parse(String(response.end.mock.calls[0]?.[0])) as { deliveryTelemetry: {
        status: string; routerDlq: { lastObservedAt: string | null; ageMs: number | null; fresh: boolean };
      } };
    };
    try {
      expect((await readHealth()).deliveryTelemetry.routerDlq).toMatchObject({ lastObservedAt: null, fresh: false });
      expect((await readHealth()).deliveryTelemetry.status).toBe("degraded");
      diagnosticListener?.({ type: "log.record", seq: 1, ts: Date.now(), level: "info",
        loggerName: "partme.delivery-recall.v1", message: "delivery telemetry",
        attributes: { event: "dlq", channel: "router", entries: 0 } }, { trusted: false });
      const fresh = await readHealth();
      expect(fresh.deliveryTelemetry.routerDlq).toMatchObject({ ageMs: expect.any(Number), fresh: true });
      const observedAt = Date.parse(fresh.deliveryTelemetry.routerDlq.lastObservedAt!);
      const clock = vi.spyOn(Date, "now").mockReturnValue(observedAt + 90_001);
      try {
        const stale = await readHealth();
        expect(stale.deliveryTelemetry.routerDlq.fresh).toBe(false);
        expect(stale.deliveryTelemetry.status).toBe("degraded");
      } finally { clock.mockRestore(); }
    } finally { await services[0].stop(); }
  });
  it("does not report an absent optional Router as failed delivery telemetry", async () => {
    const services: Array<{ start(context: unknown): Promise<void>; stop(): Promise<void> }> = [];
    const routes = new Map<string, (request: unknown, response: unknown) => Promise<void>>();
    plugin.register({ config: {}, pluginConfig: { path: "/metrics", scrapeAuth: { enabled: false } },
      runtime: {}, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, on: vi.fn(),
      registerService(service: typeof services[number]) { services.push(service); },
      registerHttpRoute(route: { path: string; handler: typeof routes extends Map<string, infer V> ? V : never }) { routes.set(route.path, route.handler); },
    } as never);
    await services[0].start({ internalDiagnostics: { onEvent: () => () => {}, emit: vi.fn() } });
    try {
      const response = { writeHead: vi.fn(), end: vi.fn(), statusCode: 200 };
      await routes.get("/metrics/health")?.({ method: "GET", url: "/metrics/health", headers: {} }, response);
      const health = JSON.parse(String(response.end.mock.calls[0]?.[0]));
      expect(health.deliveryTelemetry.routerDlq).toMatchObject({ status: "unavailable", configured: "unknown", fresh: false });
      expect(health.deliveryTelemetry.status).toBe("best-effort");
    } finally { await services[0].stop(); }
  });
  it("uses the current service config when Router is toggled across reloads", async () => {
    const services: Array<{ start(context: unknown): Promise<void>; stop(): Promise<void> }> = [];
    const routes = new Map<string, (request: unknown, response: unknown) => Promise<void>>();
    const router = (enabled: boolean) => ({ plugins: { entries: { router: { enabled, config: { enabled } } } } });
    plugin.register({ config: router(true), pluginConfig: { path: "/metrics", scrapeAuth: { enabled: false } },
      runtime: {}, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, on: vi.fn(),
      registerService(service: typeof services[number]) { services.push(service); },
      registerHttpRoute(route: { path: string; handler: typeof routes extends Map<string, infer V> ? V : never }) { routes.set(route.path, route.handler); },
    } as never);
    const readRouterHealth = async () => {
      const response = { writeHead: vi.fn(), end: vi.fn(), statusCode: 200 };
      await routes.get("/metrics/health")?.({ method: "GET", url: "/metrics/health", headers: {} }, response);
      const health = JSON.parse(String(response.end.mock.calls[0]?.[0]));
      return health.deliveryTelemetry as { status: string; routerDlq: { configured: string; status: string } };
    };
    const bridge = { onEvent: () => () => {}, emit: vi.fn() };
    try {
      await services[0].start({ config: router(true), internalDiagnostics: bridge });
      expect(await readRouterHealth()).toMatchObject({ status: "degraded", routerDlq: { configured: "enabled", status: "missing" } });
      await services[0].stop();
      await services[0].start({ config: router(false), internalDiagnostics: bridge });
      expect(await readRouterHealth()).toMatchObject({ status: "best-effort", routerDlq: { configured: "disabled", status: "unavailable" } });
      await services[0].stop();
      await services[0].start({ config: router(true), internalDiagnostics: bridge });
      expect(await readRouterHealth()).toMatchObject({ status: "degraded", routerDlq: { configured: "enabled", status: "missing" } });
    } finally { await services[0].stop(); }
  });
  it("does not write health metrics or return old health after stop races a provider probe", async () => {
    const services: Array<{ start(context: unknown): Promise<void>; stop(): Promise<void> }> = [];
    const routes = new Map<string, (request: unknown, response: unknown) => Promise<void>>();
    const probe = Promise.withResolvers<{ apiKey: string }>();
    const resolveApiKeyForProvider = vi.fn(() => probe.promise);
    plugin.register({ config: {}, pluginConfig: { path: "/metrics", scrapeAuth: { enabled: false }, monitoredProviders: ["openai"] },
      runtime: { modelAuth: { resolveApiKeyForProvider } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, on: vi.fn(),
      registerService(service: typeof services[number]) { services.push(service); },
      registerHttpRoute(route: { path: string; handler: typeof routes extends Map<string, infer V> ? V : never }) { routes.set(route.path, route.handler); },
    } as never);
    const bridge = { onEvent: () => () => {}, emit: vi.fn() };
    await services[0].start({ internalDiagnostics: bridge });
    const set = vi.spyOn(MetricsRegistry.prototype, "set");
    const response = { writeHead: vi.fn(), end: vi.fn(), statusCode: 200 };
    try {
      const health = routes.get("/metrics/health")?.({ method: "GET", url: "/metrics/health", headers: {} }, response);
      await vi.waitFor(() => expect(resolveApiKeyForProvider).toHaveBeenCalledTimes(1));
      await services[0].stop();
      const healthWritesBeforeRelease = set.mock.calls.filter(([name]) => name === "openclaw_gateway_healthz_healthy").length;
      probe.resolve({ apiKey: "late" });
      await health;
      expect(response.writeHead).toHaveBeenCalledWith(503, expect.anything());
      expect(set.mock.calls.filter(([name]) => name === "openclaw_gateway_healthz_healthy")).toHaveLength(healthWritesBeforeRelease);
    } finally { probe.resolve({ apiKey: "late" }); set.mockRestore(); }
  });

  it("sequential repeated service.start subscribes and emits exporter-started once", async () => {
    const services: Array<{ start(context: unknown): Promise<void>; stop(): Promise<void> }> = [];
    plugin.register({ config: {}, pluginConfig: { path: "/metrics", scrapeAuth: { enabled: false } },
      runtime: {}, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, on: vi.fn(),
      registerService(service: typeof services[number]) { services.push(service); },
      registerHttpRoute: vi.fn(),
    } as never);
    const onEvent = vi.fn(() => vi.fn());
    const emitEvent = vi.fn();
    const context = { internalDiagnostics: { onEvent, emit: emitEvent } };
    await services[0].start(context);
    await services[0].start(context);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledTimes(1);
    await services[0].stop();
  });
  it("stopping registration A preserves B runtime, metrics route and diagnostics subscription", async () => {
    const register = () => {
      const services: Array<{ start(context: unknown): Promise<void>; stop(): Promise<void> }> = [];
      const routes = new Map<string, (request: unknown, response: unknown) => Promise<void>>();
      let unsubscribed = 0;
      plugin.register({ config: {}, pluginConfig: { path: "/metrics", scrapeAuth: { enabled: false } },
        runtime: {}, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, on: vi.fn(),
        registerService(service: typeof services[number]) { services.push(service); },
        registerHttpRoute(route: { path: string; handler: typeof routes extends Map<string, infer V> ? V : never }) { routes.set(route.path, route.handler); },
      } as never);
      const bridge = { onEvent: () => () => { unsubscribed++; }, emit: vi.fn() };
      return { service: services[0], routes, bridge, unsubscribed: () => unsubscribed };
    };
    const a = register(); const b = register();
    await a.service.start({ internalDiagnostics: a.bridge });
    await b.service.start({ internalDiagnostics: b.bridge });
    await a.service.stop();
    expect(a.unsubscribed()).toBe(1);
    expect(b.unsubscribed()).toBe(0);
    const response = { writeHead: vi.fn(), end: vi.fn(), statusCode: 200 };
    await b.routes.get("/metrics/debug")?.({ method: "GET", url: "/metrics/debug", headers: {} }, response);
    expect(response.writeHead).toHaveBeenCalledWith(200, expect.anything());
    await b.service.stop();
    await a.service.stop();
    expect(b.unsubscribed()).toBe(1);
    await b.service.start({ internalDiagnostics: b.bridge });
    const restartedResponse = { writeHead: vi.fn(), end: vi.fn(), statusCode: 200 };
    await b.routes.get("/metrics/debug")?.({ method: "GET", url: "/metrics/debug", headers: {} }, restartedResponse);
    expect(restartedResponse.writeHead).toHaveBeenCalledWith(200, expect.anything());
    await b.service.stop();
    expect(b.unsubscribed()).toBe(2);

    const failed = register();
    failed.bridge.emit.mockImplementationOnce(() => { throw new Error("subscription start failed"); });
    await expect(failed.service.start({ internalDiagnostics: failed.bridge })).rejects.toThrow("subscription start failed");
    expect(failed.unsubscribed()).toBe(1);
    await failed.service.start({ internalDiagnostics: failed.bridge });
    await failed.service.stop();
    expect(failed.unsubscribed()).toBe(2);

    const raced = register();
    const starting = raced.service.start({ internalDiagnostics: raced.bridge });
    const stopping = raced.service.stop();
    await Promise.allSettled([starting, stopping]);
    expect(raced.unsubscribed()).toBe(1);
    await raced.service.start({ internalDiagnostics: raced.bridge });
    await raced.service.stop();
    expect(raced.unsubscribed()).toBe(2);
  });
  it("caps independent activity tracking and reports dropped pairs", () => {
    initializeRuntimeStore({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      runtime: {},
    } as never, config);

    for (let index = 0; index < MAX_OBSERVED_CHANNEL_ACCOUNTS + 2; index += 1) {
      rememberObservedChannelAccount("wecom", `account-${index}`);
    }

    expect(listObservedChannelAccounts()).toHaveLength(MAX_OBSERVED_CHANNEL_ACCOUNTS);
    expect(getRuntimeStore().registry.getSampleValue(
      "openclaw_observed_channel_accounts_dropped_total",
    )).toBe(2);
  });

  it("normalizes account labels before using them as Map keys", () => {
    initializeRuntimeStore({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      runtime: {},
    } as never, config);

    rememberObservedChannelAccount(" wecom ", "Bearer secret-token\n");
    const observed = listObservedChannelAccounts();

    expect(observed).toHaveLength(1);
    expect(observed[0]?.channelId).toBe("wecom");
    expect(observed[0]?.accountId).not.toContain("secret-token");
    expect(observed[0]?.accountId).not.toContain("\n");
  });
});
