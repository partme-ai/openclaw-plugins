import type { GotifyRuntimeSnapshot } from './types.js';

const runtimeStore = {
  runtime: null as unknown,
};

const accountSnapshots = new Map<string, GotifyRuntimeSnapshot>();

/** 本账号 Application ID 缓存，用于过滤出站回显（appid 二级过滤）。 */
const ownApplicationIds = new Map<string, number | string>();

/**
 * 设置当前插件运行时引用。
 */
export function setGotifyRuntime(runtime: unknown): void {
  runtimeStore.runtime = runtime;
}

/**
 * 获取当前插件运行时引用。
 */
export function getGotifyRuntime<T = unknown>(): T {
  return runtimeStore.runtime as T;
}

/**
 * 更新账号运行状态快照。
 */
export function patchAccountSnapshot(
  accountId: string,
  patch: Partial<GotifyRuntimeSnapshot>
): GotifyRuntimeSnapshot {
  const current = accountSnapshots.get(accountId) ?? defaultSnapshot();
  const next = { ...current, ...patch };
  accountSnapshots.set(accountId, next);
  return next;
}

/**
 * 获取账号运行状态。
 */
export function getAccountSnapshot(accountId: string): GotifyRuntimeSnapshot {
  return accountSnapshots.get(accountId) ?? defaultSnapshot();
}

/**
 * 获取所有账号的运行状态。
 */
export function getAllAccountSnapshots(): Record<string, GotifyRuntimeSnapshot> {
  return Object.fromEntries(accountSnapshots.entries());
}

/**
 * 缓存当前账号对应的 Gotify Application ID。
 */
export function setOwnApplicationId(accountId: string, applicationId: number | string): void {
  ownApplicationIds.set(accountId, applicationId);
}

/**
 * 读取已缓存的本账号 Application ID。
 */
export function getOwnApplicationId(accountId: string): number | string | undefined {
  return ownApplicationIds.get(accountId);
}

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
