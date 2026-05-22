/**
 * 会话映射模块。
 *
 * 管理 peerId ↔ sessionKey 的双向映射与会话上下文存储。
 * sessionKey 由 OpenClaw resolveAgentRoute 生成，本模块不拼接会话键。
 */

import type { RedisSessionContext } from "../types.js";

/** peerId → sessionKey */
const peerSessionMap = new Map<string, string>();

/** sessionKey → peerId */
const sessionPeerMap = new Map<string, string>();

/** sessionKey → 会话上下文 */
const sessionContextMap = new Map<string, RedisSessionContext>();

/** 通过 sessionKey 反向查找 peerId */
export function getPeerIdBySession(sessionKey: string): string | undefined {
  return sessionPeerMap.get(sessionKey);
}

/** 更新会话上下文 */
export function upsertSessionContext(
  sessionKey: string,
  ctx: Partial<RedisSessionContext>,
): void {
  const peerId = ctx.peerId ?? sessionPeerMap.get(sessionKey) ?? "";
  if (peerId) {
    peerSessionMap.set(peerId, sessionKey);
    sessionPeerMap.set(sessionKey, peerId);
  }

  const existing = sessionContextMap.get(sessionKey);
  if (existing) {
    Object.assign(existing, ctx, { updatedAt: Date.now() });
  } else {
    sessionContextMap.set(sessionKey, {
      peerId,
      agentId: ctx.agentId ?? "",
      accountId: ctx.accountId ?? "default",
      lastInboundChannel: ctx.lastInboundChannel,
      replyChannel: ctx.replyChannel,
      updatedAt: Date.now(),
    });
  }
}

/** 获取会话上下文 */
export function getSessionContext(
  sessionKey: string,
): RedisSessionContext | undefined {
  return sessionContextMap.get(sessionKey);
}

/** 清理某 peer 的所有会话 */
export function removePeerSessions(peerId: string): void {
  const toRemove: string[] = [];
  for (const [sessionKey, pid] of sessionPeerMap.entries()) {
    if (pid === peerId) toRemove.push(sessionKey);
  }
  for (const sessionKey of toRemove) {
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
