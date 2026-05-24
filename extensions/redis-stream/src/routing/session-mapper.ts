/**
 * @fileoverview Redis 会话映射模块。
 *
 * @description
 * 管理 peerId ↔ sessionKey 双向映射与会话上下文；sessionKey 由 OpenClaw
 * `resolveAgentRoute` 生成，本模块不拼接会话键。
 *
 * @module routing/session-mapper
 */

import type { RedisSessionContext } from "../types.js";

/** peerId → sessionKey */
const peerSessionMap = new Map<string, string>();

/** sessionKey → peerId */
const sessionPeerMap = new Map<string, string>();

/** sessionKey → 会话上下文 */
const sessionContextMap = new Map<string, RedisSessionContext>();

/**
 * @description 通过 sessionKey 反向查找 peerId。
 * @param sessionKey - OpenClaw 会话键
 * @returns peerId 或 undefined
 */
export function getPeerIdBySession(sessionKey: string): string | undefined {
  return sessionPeerMap.get(sessionKey);
}

/**
 * @description 更新或创建会话上下文（同步 peer ↔ session 双向映射）。
 * @param sessionKey - OpenClaw 会话键
 * @param ctx - 部分或完整会话上下文字段
 */
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

/**
 * @description 获取指定 sessionKey 的会话上下文。
 * @param sessionKey - OpenClaw 会话键
 * @returns 上下文或 undefined
 */
export function getSessionContext(
  sessionKey: string,
): RedisSessionContext | undefined {
  return sessionContextMap.get(sessionKey);
}

/**
 * @description 清理某 peer 关联的全部 session 映射。
 * @param peerId - Redis peer / channel 标识
 */
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

/**
 * @description 返回会话层聚合统计。
 * @returns peer / session / context 计数
 */
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

/**
 * @description 获取 peerId → sessionKey 全量映射（只读）。
 * @returns 只读 Map
 */
export function getAllSessionMappings(): ReadonlyMap<string, string> {
  return peerSessionMap;
}
