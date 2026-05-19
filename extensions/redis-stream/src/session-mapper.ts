/**
 * 会话映射模块。
 *
 * 管理 peerId ↔ sessionKey 的双向映射与会话上下文存储。
 * 会话隔离粒度由 dmScope 决定，完全遵循 OpenClaw 全局 session.dmScope 配置。
 *
 * 参考 openclaw-mqtt / openclaw-rabbitmq 一致模式。
 */

import { buildSessionKeyFromDmScope } from "./dm-scope.js";
import type { DmScope, RedisSessionContext } from "./types.js";

/** peerId → sessionKey */
const peerSessionMap = new Map<string, string>();

/** sessionKey → peerId */
const sessionPeerMap = new Map<string, string>();

/** sessionKey → 会话上下文 */
const sessionContextMap = new Map<string, RedisSessionContext>();

export interface GetOrCreateSessionKeyParams {
  peerId: string;
  agentId: string;
  accountId: string;
  dmScope: DmScope;
  cfg: Record<string, unknown>;
  channel: string;
}

/** 获取或创建会话键 */
export function getOrCreateSessionKey(params: GetOrCreateSessionKeyParams): string {
  const existing = peerSessionMap.get(params.peerId);
  if (existing) {
    return existing;
  }

  const sessionKey = buildSessionKeyFromDmScope({
    cfg: params.cfg,
    agentId: params.agentId,
    channel: params.channel,
    accountId: params.accountId,
    peerId: params.peerId,
  });

  peerSessionMap.set(params.peerId, sessionKey);
  sessionPeerMap.set(sessionKey, params.peerId);
  return sessionKey;
}

/** 通过 sessionKey 反向查找 peerId */
export function getPeerIdBySession(sessionKey: string): string | undefined {
  return sessionPeerMap.get(sessionKey);
}

/** 更新会话上下文 */
export function upsertSessionContext(sessionKey: string, ctx: Partial<RedisSessionContext>): void {
  const existing = sessionContextMap.get(sessionKey);
  if (existing) {
    Object.assign(existing, ctx, { updatedAt: Date.now() });
  } else {
    sessionContextMap.set(sessionKey, {
      peerId: ctx.peerId ?? "",
      agentId: ctx.agentId ?? "",
      accountId: ctx.accountId ?? "default",
      lastInboundChannel: ctx.lastInboundChannel,
      replyChannel: ctx.replyChannel,
      updatedAt: Date.now(),
    });
  }
}

/** 获取会话上下文 */
export function getSessionContext(sessionKey: string): RedisSessionContext | undefined {
  return sessionContextMap.get(sessionKey);
}

/** 清理某 peer 的所有会话 */
export function removePeerSessions(peerId: string): void {
  const sessionKey = peerSessionMap.get(peerId);
  if (sessionKey) {
    sessionPeerMap.delete(sessionKey);
    sessionContextMap.delete(sessionKey);
  }
  peerSessionMap.delete(peerId);
}

/** 获取会话统计 */
export function getSessionStats(): {
  peerCount: number;
  sessionCount: number;
  contextCount: number;
} {
  return {
    peerCount: peerSessionMap.size,
    sessionCount: sessionPeerMap.size,
    contextCount: sessionContextMap.size,
  };
}

/** 获取所有会话映射（只读） */
export function getAllSessionMappings(): ReadonlyMap<string, string> {
  return peerSessionMap;
}
