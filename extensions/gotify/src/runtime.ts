/**
 * Gotify Runtime — 插件运行时状态管理。
 *
 * 管理运行时引用、账号运行状态快照、Application ID 缓存。
 * 所有状态通过 Map 按 accountId 隔离，支持多账号场景。
 */

import type { GotifyRuntimeSnapshot } from "./types.js";

const runtimeStore = {
  runtime: null as unknown,
};

const accountSnapshots = new Map<string, GotifyRuntimeSnapshot>();

/** 本账号 Application ID 缓存，用于过滤出站回显（appid 二级过滤）。 */
const ownApplicationIds = new Map<string, number | string>();

/**
 * 设置当前插件运行时引用。
 *
 * `defineChannelPluginEntry` 会在宿主加载插件时注入 runtime。本插件只保存引用，
 * 不在这里解释 runtime 结构，避免与 OpenClaw SDK 的真实类型产生耦合。
 *
 * @param runtime - OpenClaw 宿主注入的运行时对象。
 */
export function setGotifyRuntime(runtime: unknown): void {
  runtimeStore.runtime = runtime;
}

/**
 * 获取当前插件运行时引用。
 *
 * @typeParam T - 调用方期望读取的 runtime 类型。
 * @returns 最近一次由 `setGotifyRuntime()` 写入的 runtime 引用。
 */
export function getGotifyRuntime<T = unknown>(): T {
  return runtimeStore.runtime as T;
}

/**
 * 更新账号运行状态快照。
 *
 * 该函数采用 patch 语义，只覆盖传入字段，其余字段保留当前值；如果账号还没有
 * 快照，则先创建默认快照再合并。这样 WebSocket 状态、入站时间、出站时间可以由
 * 不同调用点独立更新。
 *
 * @param accountId - Gotify 账号 ID。
 * @param patch - 需要覆盖的运行态字段。
 * @returns 合并后的完整运行态快照。
 */
export function patchAccountSnapshot(
  accountId: string,
  patch: Partial<GotifyRuntimeSnapshot>,
): GotifyRuntimeSnapshot {
  const current = accountSnapshots.get(accountId) ?? defaultSnapshot();
  const next = { ...current, ...patch };
  accountSnapshots.set(accountId, next);
  return next;
}

/**
 * 获取账号运行状态。
 *
 * @param accountId - Gotify 账号 ID。
 * @returns 已保存的运行态快照；未启动过的账号返回默认快照。
 */
export function getAccountSnapshot(accountId: string): GotifyRuntimeSnapshot {
  return accountSnapshots.get(accountId) ?? defaultSnapshot();
}

/**
 * 获取所有账号的运行状态。
 *
 * @returns 以 accountId 为键的快照对象，便于 JSON 序列化给 status endpoint。
 */
export function getAllAccountSnapshots(): Record<
  string,
  GotifyRuntimeSnapshot
> {
  return Object.fromEntries(accountSnapshots.entries());
}

/**
 * 缓存当前账号对应的 Gotify Application ID。
 *
 * Gotify `/stream` 会把当前应用发送的消息也推送回来。除了 extras.openclaw.outbound
 * 标记外，本缓存提供 appid 级别的二次回环过滤。
 *
 * @param accountId - Gotify 账号 ID。
 * @param applicationId - Gotify API 返回的 Application ID。
 */
export function setOwnApplicationId(
  accountId: string,
  applicationId: number | string,
): void {
  ownApplicationIds.set(accountId, applicationId);
}

/**
 * 读取已缓存的本账号 Application ID。
 *
 * @param accountId - Gotify 账号 ID。
 * @returns 已知 Application ID；账号尚未成功出站时返回 undefined。
 */
export function getOwnApplicationId(
  accountId: string,
): number | string | undefined {
  return ownApplicationIds.get(accountId);
}

/**
 * 清空运行时缓存（仅测试使用）。
 *
 * @internal
 */
export function resetGotifyRuntimeForTest(): void {
  runtimeStore.runtime = null;
  accountSnapshots.clear();
  ownApplicationIds.clear();
}

/**
 * 构造新账号的默认运行态快照。
 *
 * @returns 未运行、无错误、无时间戳的初始快照。
 */
function defaultSnapshot(): GotifyRuntimeSnapshot {
  return {
    running: false,
    lastStartAt: null,
    lastStopAt: null,
    lastError: null,
    lastInboundAt: null,
    lastOutboundAt: null,
  };
}
