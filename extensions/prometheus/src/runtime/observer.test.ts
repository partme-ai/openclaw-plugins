/**
 * Provider 快照刷新并发与热重载代际测试。
 *
 * health、定时器和人工诊断可能同时要求刷新；测试确保它们共享一次真实凭据探测，并且旧
 * 插件代际的迟到结果不会覆盖新 RuntimeStore。
 */
import { describe, expect, it, vi } from "vitest";
import type { ResolvedPrometheusConfig } from "../config/plugin-config.js";
import { refreshRuntimeSnapshots, stopPluginObservers } from "./observer.js";
import { getRuntimeStore, initializeRuntimeStore } from "./store.js";

const config: ResolvedPrometheusConfig = {
  metricsPath: "/metrics",
  collectIntervalMs: 0,
  snapshotIntervalMs: 30_000,
  workloadWindowMs: 300_000,
  includeRuntime: false,
  monitoredProviders: ["openai"],
  scrapeAuthEnabled: false,
  scrapeBearerToken: undefined,
  instance: "test",
  collectorTimeoutMs: 1_000,
  maxScrapeSeries: 1_000,
};

function apiWithResolver(resolver: () => Promise<unknown>) {
  return {
    config: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    runtime: {
      modelAuth: {
        resolveApiKeyForProvider: vi.fn(resolver),
      },
    },
  };
}

describe("refreshRuntimeSnapshots", () => {
  it("合并并发刷新为一次真实 Provider 探测", async () => {
    let release: ((value: unknown) => void) | undefined;
    const api = apiWithResolver(() => new Promise((resolve) => {
      release = resolve;
    }));
    initializeRuntimeStore(api as never, config);

    const first = refreshRuntimeSnapshots(true);
    const second = refreshRuntimeSnapshots(true);
    expect(api.runtime.modelAuth.resolveApiKeyForProvider).toHaveBeenCalledTimes(1);
    release?.({ apiKey: "secret", source: "env", mode: "read" });
    await Promise.all([first, second]);
    expect(getRuntimeStore().providerSnapshots).toMatchObject([
      { provider: "openai", status: "ok", source: "env", mode: "read" },
    ]);
    stopPluginObservers();
  });

  it("停止后的迟到探测不会污染新插件代际", async () => {
    let releaseOld: ((value: unknown) => void) | undefined;
    const oldApi = apiWithResolver(() => new Promise((resolve) => {
      releaseOld = resolve;
    }));
    initializeRuntimeStore(oldApi as never, config);
    const staleRefresh = refreshRuntimeSnapshots(true);

    stopPluginObservers();
    const newApi = apiWithResolver(async () => ({ apiKey: "new" }));
    initializeRuntimeStore(newApi as never, config);
    releaseOld?.({ apiKey: "old", source: "old" });
    await staleRefresh;

    expect(getRuntimeStore().providerSnapshots).toEqual([]);
    expect(newApi.runtime.modelAuth.resolveApiKeyForProvider).not.toHaveBeenCalled();
    stopPluginObservers();
  });
});
