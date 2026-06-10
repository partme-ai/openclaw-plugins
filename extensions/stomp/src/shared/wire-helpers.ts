/**
 * @module shared/wire-helpers
 *
 * Wire 入站辅助：幂等缓存（委托 message-sdk transport）。
 */

import { createChannelIdempotencyCache } from "@partme.ai/openclaw-message-sdk/transport";

import type { IdempotencyCache } from "@partme.ai/openclaw-message-sdk";

import { STOMP_TCP_CHANNEL_ID } from "../config/resolvers.js";

/**
 * 返回 STOMP TCP 入站幂等缓存（进程内单例，委托 message-sdk transport）。
 */
export function getStompTcpIdempotencyCache(): IdempotencyCache {
  return createChannelIdempotencyCache(STOMP_TCP_CHANNEL_ID);
}
