/**
 * @module shared/wire-helpers
 *
 * Wire 入站辅助：幂等缓存（委托 message-sdk transport）。
 */

import {
  createClaimableDedupe,
  getGlobalSingleton,
  type ClaimableDedupe,
} from "@partme.ai/openclaw-message-sdk";

import { STOMP_TCP_CHANNEL_ID } from "../config/resolvers.js";

/**
 * 返回 STOMP TCP 入站幂等缓存（进程内单例，委托 message-sdk transport）。
 */
export function getStompTcpClaimableDedupe(): ClaimableDedupe {
  return getGlobalSingleton(`message-sdk:${STOMP_TCP_CHANNEL_ID}:claimable`, () =>
    createClaimableDedupe({ ttlMs: 10 * 60_000, memoryMaxSize: 10_000 }),
  );
}
