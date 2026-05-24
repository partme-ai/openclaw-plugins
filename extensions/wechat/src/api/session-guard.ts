/**
 * @module wechat/api/session-guard
 *
 * Bot 会话过期 **冷却守卫**（errcode -14 触发后暂停 API 调用 1 小时）。
 *
 * **职责**：
 * - `pauseSession`：收到 SESSION_EXPIRED 后进入冷却
 * - `assertSessionActive`：出站 / 入站 API 调用前校验，避免无效请求风暴
 *
 * **适用场景**：`channel.ts` outbound、`api/api.ts` 调用链、`monitor` 入站循环。
 */

import { logger } from "../util/logger.js";

const SESSION_PAUSE_DURATION_MS = 60 * 60 * 1000;

/** Error code returned by the server when the bot session has expired. */
export const SESSION_EXPIRED_ERRCODE = -14;

const pauseUntilMap = new Map<string, number>();

/** Pause all inbound/outbound API calls for `accountId` for one hour. */
export function pauseSession(accountId: string): void {
  const until = Date.now() + SESSION_PAUSE_DURATION_MS;
  pauseUntilMap.set(accountId, until);
  logger.info(
    `session-guard: paused accountId=${accountId} until=${new Date(until).toISOString()} (${SESSION_PAUSE_DURATION_MS / 1000}s)`,
  );
}

/** Returns `true` when the bot is still within its one-hour cooldown window. */
export function isSessionPaused(accountId: string): boolean {
  const until = pauseUntilMap.get(accountId);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    pauseUntilMap.delete(accountId);
    return false;
  }
  return true;
}

/** Milliseconds remaining until the pause expires (0 when not paused). */
export function getRemainingPauseMs(accountId: string): number {
  const until = pauseUntilMap.get(accountId);
  if (until === undefined) return 0;
  const remaining = until - Date.now();
  if (remaining <= 0) {
    pauseUntilMap.delete(accountId);
    return 0;
  }
  return remaining;
}

/** Throw if the session is currently paused. Call before any API request. */
export function assertSessionActive(accountId: string): void {
  if (isSessionPaused(accountId)) {
    const remainingMin = Math.ceil(getRemainingPauseMs(accountId) / 60_000);
    throw new Error(
      `session paused for accountId=${accountId}, ${remainingMin} min remaining (errcode ${SESSION_EXPIRED_ERRCODE})`,
    );
  }
}

/**
 * Reset internal state — only for tests.
 * @internal
 */
export function _resetForTest(): void {
  pauseUntilMap.clear();
}
