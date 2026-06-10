/**
 * @fileoverview RocketMQ 会话上下文存储：sessionKey ↔ peerId 与 reply 路由信息。
 *
 * @description
 * 入站 dispatch 后缓存 replyTopic/replyTag 等出站所需字段；session key 本身由
 * OpenClaw 核心 `resolveAgentRoute` 生成，本模块不做 session key 推导。
 *
 * @module routing/session-mapper
 */

/**
 * RocketMQ 会话映射 — 进程内内存表。
 */

import type { RockermqSessionContext } from "../types.js";

export type { RockermqSessionContext };

/** @description Session Key → Peer ID 反向映射。 */
const sessionPeerMap = new Map<string, string>();

/** @description Session Key → 会话路由上下文（replyTopic / replyTag 等）。 */
const sessionContextMap = new Map<string, RockermqSessionContext>();

/**
 * @description 内部：记录 sessionKey 与 peerId 的双向关联。
 * @param sessionKey - OpenClaw 会话键。
 * @param peerId - 对端 peer 标识。
 * @returns void
 * @throws 不抛出。
 */
function recordSessionPeer(sessionKey: string, peerId: string): void {
  sessionPeerMap.set(sessionKey, peerId);
}

/**
 * @description 根据 Session Key 查找关联的 peerId。
 * @param sessionKey - OpenClaw 会话键。
 * @returns peerId 或 `null`。
 * @throws 不抛出。
 */
export function getPeerIdBySession(sessionKey: string): string | null {
  return sessionPeerMap.get(sessionKey) ?? null;
}

/**
 * @description 保存或更新 session 路由上下文（出站 reply 使用）。
 * @param sessionKey - OpenClaw 会话键。
 * @param context - 会话上下文（`updatedAt` 会被覆盖为当前时间）。
 * @returns void
 * @throws 不抛出。
 */
export function upsertSessionContext(sessionKey: string, context: RockermqSessionContext): void {
  recordSessionPeer(sessionKey, context.peerId);
  sessionContextMap.set(sessionKey, { ...context, updatedAt: Date.now() });
}

/**
 * @description 获取 session 路由上下文。
 * @param sessionKey - OpenClaw 会话键。
 * @returns 上下文或 `null`。
 * @throws 不抛出。
 */
export function getSessionContext(sessionKey: string): RockermqSessionContext | null {
  return sessionContextMap.get(sessionKey) ?? null;
}

/**
 * @description 移除指定 peer 关联的所有 session 映射。
 * @param peerId - 对端 peer 标识。
 * @returns void
 * @throws 不抛出。
 */
export function removePeerSessions(peerId: string): void {
  const toRemove: string[] = [];
  for (const [sessionKey, pid] of sessionPeerMap.entries()) {
    if (pid === peerId) {
      toRemove.push(sessionKey);
    }
  }
  for (const key of toRemove) {
    sessionPeerMap.delete(key);
    sessionContextMap.delete(key);
  }
}

/**
 * @description 获取所有活跃 session 映射（调试 / `/rocketmq/status`）。
 * @returns peerId、sessionKey 与 context 列表。
 * @throws 不抛出。
 */
export function getAllSessionMappings(): Array<{
  peerId: string;
  sessionKey: string;
  context: RockermqSessionContext | null;
}> {
  const result: Array<{
    peerId: string;
    sessionKey: string;
    context: RockermqSessionContext | null;
  }> = [];
  for (const [sessionKey, peerId] of sessionPeerMap.entries()) {
    result.push({ peerId, sessionKey, context: getSessionContext(sessionKey) });
  }
  return result;
}

/**
 * @description 获取 session 表统计摘要。
 * @returns 活跃 session 数、唯一 peer 数、已绑定 context 数。
 * @throws 不抛出。
 */
export function getSessionStats(): {
  activeSessions: number;
  uniquePeers: number;
  contextBoundSessions: number;
} {
  const uniquePeers = new Set(sessionPeerMap.values());
  return {
    activeSessions: sessionPeerMap.size,
    uniquePeers: uniquePeers.size,
    contextBoundSessions: sessionContextMap.size,
  };
}
