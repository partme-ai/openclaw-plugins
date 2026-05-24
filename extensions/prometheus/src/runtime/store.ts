import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import type { ResolvedPrometheusConfig } from "../config/plugin-config.js";
import type { MetricSample, MonitoredProviderSnapshot } from "../types.js";
import { MetricsRegistry } from "../diagnostics/metrics-registry.js";

type ObservedChannelAccount = {
  channelId: string;
  accountId?: string;
};

type RuntimeStoreState = {
  api: OpenClawPluginApi;
  cfg: ResolvedPrometheusConfig;
  registry: MetricsRegistry;
  startedAt: number;
  observedChannelAccounts: Map<string, ObservedChannelAccount>;
  lastSnapshotRefreshAt?: number;
  snapshotError?: string;
  providerSnapshots: MonitoredProviderSnapshot[];
  /** Latest RPC collector samples (cached for SLI computation) */
  rpcSamples: MetricSample[];
  rpcClientInitialized: boolean;
  lastRpcSuccessAt?: number;
  lastRpcError?: string;
  lastRpcMethod?: string;
};

let state: RuntimeStoreState | null = null;

export function initializeRuntimeStore(api: OpenClawPluginApi, cfg: ResolvedPrometheusConfig): RuntimeStoreState {
  state = {
    api,
    cfg,
    registry: new MetricsRegistry(),
    startedAt: Date.now(),
    observedChannelAccounts: new Map(),
    providerSnapshots: [],
    rpcSamples: [],
    rpcClientInitialized: false,
  };
  return state;
}

export function getRuntimeStore(): RuntimeStoreState {
  if (!state) {
    throw new Error("[openclaw-prometheus] Runtime store not initialized.");
  }
  return state;
}

export function rememberObservedChannelAccount(channelId: string, accountId?: string): void {
  const store = getRuntimeStore();
  const normalizedChannel = channelId.trim();
  if (!normalizedChannel) {
    return;
  }
  const normalizedAccount = accountId?.trim() || undefined;
  const key = `${normalizedChannel}:${normalizedAccount ?? "default"}`;
  if (!store.observedChannelAccounts.has(key)) {
    store.observedChannelAccounts.set(key, {
      channelId: normalizedChannel,
      ...(normalizedAccount ? { accountId: normalizedAccount } : {}),
    });
  }
}

export function listObservedChannelAccounts(): ObservedChannelAccount[] {
  return [...getRuntimeStore().observedChannelAccounts.values()];
}

export function setSnapshotState(params: {
  refreshedAt: number;
  providerSnapshots: MonitoredProviderSnapshot[];
  error?: string;
}): void {
  const store = getRuntimeStore();
  store.lastSnapshotRefreshAt = params.refreshedAt;
  store.providerSnapshots = params.providerSnapshots;
  store.snapshotError = params.error;
}

/**
 * Update the cached RPC collector samples (called after each collectAll).
 * Used by refreshSliMetrics() to compute channel health SLI.
 */
export function updateRpcSamples(samples: MetricSample[]): void {
  getRuntimeStore().rpcSamples = samples;
}

export function setRpcClientInitialized(initialized: boolean): void {
  getRuntimeStore().rpcClientInitialized = initialized;
}

export function recordRpcSuccess(method: string): void {
  const store = getRuntimeStore();
  store.lastRpcMethod = method;
  store.lastRpcSuccessAt = Date.now();
  store.lastRpcError = undefined;
}

export function recordRpcError(method: string, error: unknown): void {
  const store = getRuntimeStore();
  store.lastRpcMethod = method;
  store.lastRpcError = error instanceof Error ? error.message : String(error);
}
