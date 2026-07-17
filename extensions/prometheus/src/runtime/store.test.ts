/**
 * RuntimeStore 的独立高基数边界。
 *
 * MetricsRegistry 有 series 上限，但渠道活动刷新还持有自己的 account Map；两者必须分别
 * 受限，否则攻击者可以在不新增指标 series 的情况下持续占用进程内存。
 */
import { describe, expect, it, vi } from "vitest";
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
