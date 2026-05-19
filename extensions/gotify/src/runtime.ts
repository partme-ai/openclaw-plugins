import type { GotifyRuntimeSnapshot } from './types.js';

const runtimeStore = {
  runtime: null as unknown,
};

const accountSnapshots = new Map<string, GotifyRuntimeSnapshot>();

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
