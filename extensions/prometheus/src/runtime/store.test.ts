/**
 * RuntimeStore 的独立高基数边界。
 *
 * MetricsRegistry 有 series 上限，但渠道活动刷新还持有自己的 account Map；两者必须分别
 * 受限，否则攻击者可以在不新增指标 series 的情况下持续占用进程内存。
 */
import { describe, expect, it, vi } from "vitest";
import plugin from "../index.js";
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
