/**
 * RocketMQ 会话上下文存储。
 * 仅保存 replyTopic 等路由信息用于出站适配，session key 由 OpenClaw 核心 resolveAgentRoute 生成。
 */

import type { RockermqSessionContext } from "../types.js";

export type { RockermqSessionContext };

/** Session Key -> Peer ID 反向映射 */
const sessionPeerMap = new Map<string, string>();

/** Session Key -> Session Context（记录 replyTopic/replyTag 等路由信息） */
const sessionContextMap = new Map<string, RockermqSessionContext>();

/**
 * 记录 session 与 peerId 的映射。
 */
function recordSessionPeer(sessionKey: string, peerId: string): void {
  sessionPeerMap.set(sessionKey, peerId);
}

/**
 * 根据 Session Key 查找关联的 peerId。
 */
export function getPeerIdBySession(sessionKey: string): string | null {
  return sessionPeerMap.get(sessionKey) ?? null;
}

/**
 * 保存 session 路由上下文（replyTopic/replyTag）。
 */
export function upsertSessionContext(sessionKey: string, context: RockermqSessionContext): void {
  recordSessionPeer(sessionKey, context.peerId);
  sessionContextMap.set(sessionKey, { ...context, updatedAt: Date.now() });
}

/**
 * 获取 session 路由上下文。
 */
export function getSessionContext(sessionKey: string): RockermqSessionContext | null {
  return sessionContextMap.get(sessionKey) ?? null;
}

/**
 * 移除 session 的所有映射。
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
 * 获取所有活跃的 session 映射（调试/监控）。
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
 * 获取 session 统计。
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
