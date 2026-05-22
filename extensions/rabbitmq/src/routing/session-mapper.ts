/**
 * RabbitMQ Session 上下文存储。
 * 仅保存 replyTopic 等路由信息用于出站适配，session key 由 OpenClaw 核心 resolveAgentRoute 生成。
 */

import type { RabbitmqSessionContext } from "../types.js";

/** Session Key -> Peer ID 反向映射 */
const sessionPeerMap = new Map<string, string>();

/** Session Key -> Session Context（记录 topic/account/replyTopic 等） */
const sessionContextMap = new Map<string, RabbitmqSessionContext>();

/**
 * 根据 Session Key 查找关联的 RabbitMQ Peer ID。
 */
export function getPeerIdBySession(sessionKey: string): string | null {
  return sessionPeerMap.get(sessionKey) ?? null;
}

/**
 * 以路由结果更新会话上下文。
 */
export function upsertSessionContext(
  sessionKey: string,
  context: RabbitmqSessionContext,
): void {
  sessionPeerMap.set(sessionKey, context.peerId);
  sessionContextMap.set(sessionKey, { ...context, updatedAt: Date.now() });
}

/**
 * 获取会话上下文。
 */
export function getSessionContext(sessionKey: string): RabbitmqSessionContext | null {
  return sessionContextMap.get(sessionKey) ?? null;
}

/**
 * 移除 Peer 的所有会话映射。
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
 * 获取所有活跃的会话映射。
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
 * 获取会话统计数据。
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
