/**
 * @module shared/wire-helpers
 *
 * Wire 入站两阶段去重（message-sdk 薄封装）。
 *
 * WebSocket 的 accepted 语义要求 Agent 管线和回复投递都成功后才确认，因此不能在解析帧时就
 * 永久记录 messageId。这里使用 claim/commit/release：并发重放先互斥，失败则释放以允许重试。
 */

import {
  createClaimableDedupe,
  getGlobalSingleton,
  type ClaimableDedupe,
} from "@partme.ai/openclaw-message-sdk";

import { WEB_SOCKET_CHANNEL_ID } from "../config/resolvers.js";

const DEFAULT_IDEMPOTENCY_TTL_MS = 60_000;
const DEFAULT_IDEMPOTENCY_MAX_ENTRIES = 10_000;

/**
 * 返回 WebSocket 入站两阶段去重器（进程内单例）。
 */
export function getWebsocketClaimableDedupe(): ClaimableDedupe {
  // 使用新的 singleton key，避免 Gateway 热重载时取到旧版 IdempotencyCache 对象。
  return getGlobalSingleton(`message-sdk:${WEB_SOCKET_CHANNEL_ID}:claimable-idempotency`, () =>
    createClaimableDedupe({
      ttlMs: DEFAULT_IDEMPOTENCY_TTL_MS,
      memoryMaxSize: DEFAULT_IDEMPOTENCY_MAX_ENTRIES,
      namespace: WEB_SOCKET_CHANNEL_ID,
    }),
  );
}
