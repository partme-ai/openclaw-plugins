/**
 * @module shared/wire-helpers
 *
 * Wire 入站辅助：幂等缓存（委托 message-sdk transport）。
 */

import { createChannelIdempotencyCache } from "@partme.ai/openclaw-message-sdk/transport";
import type { IdempotencyCache } from "@partme.ai/openclaw-message-sdk";

import { WEB_STOMP_CHANNEL_ID } from "../config/resolvers.js";

/**
 * 返回 Web STOMP 入站幂等缓存（进程内单例，委托 message-sdk transport）。
 */
export function getWebStompIdempotencyCache(): IdempotencyCache {
  return createChannelIdempotencyCache(WEB_STOMP_CHANNEL_ID);
}
