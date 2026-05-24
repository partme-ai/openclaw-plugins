/**
 * @fileoverview RabbitMQ Session 上下文存储。
 *
 * @description
 * 仅保存 replyTopic 等路由信息供出站适配器使用；session key 由 OpenClaw 核心
 * `resolveAgentRoute` 生成，本模块不自行拼接会话键。
 *
 * @module routing/session-mapper
 */

import type { RabbitmqSessionContext } from "../types.js";

/** Session Key -> Peer ID 反向映射 */
const sessionPeerMap = new Map<string, string>();

/** Session Key -> Session Context（记录 topic/account/replyTopic 等） */
const sessionContextMap = new Map<string, RabbitmqSessionContext>();

/**
 * @description 根据 Session Key 查找关联的 RabbitMQ Peer ID。
 * @param sessionKey - OpenClaw 会话键
 * @returns peerId 或 null
 */
export function getPeerIdBySession(sessionKey: string): string | null {
  return sessionPeerMap.get(sessionKey) ?? null;
}

/**
 * @description 以路由结果更新或创建会话上下文（含 peerId 反向映射）。
 * @param sessionKey - OpenClaw 会话键
 * @param context - 会话上下文（peerId、agentId、replyTopic 等）
 */
export function upsertSessionContext(
  sessionKey: string,
  context: RabbitmqSessionContext,
): void {
  sessionPeerMap.set(sessionKey, context.peerId);
  sessionContextMap.set(sessionKey, { ...context, updatedAt: Date.now() });
}

/**
 * @description 获取指定 sessionKey 的会话上下文快照。
 * @param sessionKey - OpenClaw 会话键
 * @returns 上下文对象或 null
 */
export function getSessionContext(sessionKey: string): RabbitmqSessionContext | null {
  return sessionContextMap.get(sessionKey) ?? null;
}

/**
 * @description 移除指定 peerId 关联的全部 session 映射。
 * @param peerId - RabbitMQ peer 标识
 */
export function removePeerSessions(peerId: string): void {
  const toRemove: string[] = [];
  for (const [sessionKey, pid] of sessionPeerMap.entries()) {
    if (pid === peerId) toRemove.push(sessionKey);
  }
  for (const key of toRemove) {
    sessionPeerMap.delete(key);
    sessionContextMap.delete(key);
  }
}

/**
 * @description 获取所有活跃 session ↔ peer 映射及上下文（诊断/HTTP 状态用）。
 * @returns 映射条目数组
 */
export function getAllSessionMappings(): Array<{
  peerId: string;
  sessionKey: string;
  context: RabbitmqSessionContext | null;
}> {
  const result: Array<{
    peerId: string;
    sessionKey: string;
    context: RabbitmqSessionContext | null;
  }> = [];
  for (const [sessionKey, peerId] of sessionPeerMap.entries()) {
    result.push({ peerId, sessionKey, context: getSessionContext(sessionKey) });
  }
  return result;
}

/**
 * @description 返回会话层聚合统计（活跃 session 数、唯一 peer 数等）。
 * @returns 统计对象
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
