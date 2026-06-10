/**
 * @fileoverview Prometheus 插件运行时状态仓库。
 *
 * @description
 * 集中保存 Gateway 注入的 Plugin API、解析后的插件配置、指标注册表、
 * RPC 采集快照与已观测渠道账号集合。由 `index.ts` 在 register 时初始化，
 * 供 observer、ws-bridge 与各 collector 读取/更新。
 *
 * @module runtime/store
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import type { ResolvedPrometheusConfig } from "../config/plugin-config.js";
import type { MetricSample, MonitoredProviderSnapshot } from "../types.js";
import { MetricsRegistry } from "../diagnostics/metrics-registry.js";

type ObservedChannelAccount = {
  channelId: string;
  accountId?: string;
};

/** @description 插件进程内单例运行时状态快照。 */
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

/**
 * @description 初始化 Prometheus 运行时仓库（register 阶段调用一次）。
 *
 * @param api - OpenClaw 插件 API（日志、配置、HTTP 路由等）
 * @param cfg - 已解析的 Prometheus 插件配置
 * @returns 新建的运行时状态对象
 */
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

/**
 * @description 获取已初始化的运行时仓库。
 *
 * @returns 当前 RuntimeStoreState
 * @throws 若 register 尚未调用 initializeRuntimeStore
 */
export function getRuntimeStore(): RuntimeStoreState {
  if (!state) {
    throw new Error("[openclaw-prometheus] Runtime store not initialized.");
  }
  return state;
}

/**
 * @description 记录 hook 中观测到的渠道/账号组合（低基数去重）。
 *
 * @param channelId - 渠道 ID
 * @param accountId - 可选账号 ID
 */
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

/**
 * @description 列出所有已观测的渠道/账号对。
 *
 * @returns 观测记录数组（浅拷贝）
 */
export function listObservedChannelAccounts(): ObservedChannelAccount[] {
  return [...getRuntimeStore().observedChannelAccounts.values()];
}

/**
 * @description 更新模型鉴权快照刷新结果。
 *
 * @param params.refreshedAt - 刷新完成时间戳（毫秒）
 * @param params.providerSnapshots - 各 provider 探测结果
 * @param params.error - 可选整体错误信息
 */
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
 * @description 更新 RPC collector 缓存样本（每次 collectAll 后调用，供 SLI 计算）。
 *
 * @param samples - 最新 RPC 指标样本列表
 */
export function updateRpcSamples(samples: MetricSample[]): void {
  getRuntimeStore().rpcSamples = samples;
}

/**
 * @description 标记 Gateway RPC 客户端连接是否就绪。
 *
 * @param initialized - true 表示已建立 hello 握手
 */
export function setRpcClientInitialized(initialized: boolean): void {
  getRuntimeStore().rpcClientInitialized = initialized;
}

/**
 * @description 记录一次成功的 Gateway RPC 调用。
 *
 * @param method - RPC 方法名
 */
export function recordRpcSuccess(method: string): void {
  const store = getRuntimeStore();
  store.lastRpcMethod = method;
  store.lastRpcSuccessAt = Date.now();
  store.lastRpcError = undefined;
}

/**
 * @description 记录一次失败的 Gateway RPC 调用。
 *
 * @param method - RPC 方法名
 * @param error - 捕获的异常或错误对象
 */
export function recordRpcError(method: string, error: unknown): void {
  const store = getRuntimeStore();
  store.lastRpcMethod = method;
  store.lastRpcError = error instanceof Error ? error.message : String(error);
}
