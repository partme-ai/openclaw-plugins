/**
 * RabbitMQ Session 上下文存储。
 * 仅保存 replyTopic 等路由信息用于出站适配，session key 由 OpenClaw 核心 resolveAgentRoute 生成。
 */

import type { RabbitmqSessionContext } from "./types.js";
import { buildSessionKeyFromDmScope, resolveDmScopeFromRuntimeConfig } from "./dm-scope.js";

/** 由 (peerId, agentId, accountId) 到 session key 的缓存映射 */
const sessionKeyCache = new Map<string, string>();

/** Session Key -> Peer ID 反向映射 */
const sessionPeerMap = new Map<string, string>();

/** Session Key -> Session Context（记录 topic/account/replyTopic 等） */
const sessionContextMap = new Map<string, RabbitmqSessionContext>();

/**
 * 基于 dmScope 生成或复用一致的会话键。
 * 相同 (peerId, agentId, accountId, dmScope) 组合会复用已有键，
 * 确保新会话消息到达时使用的是与出站适配器一致的键。
 */
export function getOrCreateSessionKey(params: {
  cfg: Record<string, unknown>;
  peerId: string;
  agentId: string;
  accountId: string;
  channel: string;
}): string {
  const normalizedPeerId = params.peerId.trim().toLowerCase();
  const normalizedAgentId = params.agentId.trim().toLowerCase();
  const normalizedAccountId = params.accountId.trim().toLowerCase();
  const dmScope = resolveDmScopeFromRuntimeConfig(params.cfg);
  const cacheKey = `${dmScope}:${normalizedPeerId}:${normalizedAgentId}:${normalizedAccountId}`;
  const existing = sessionKeyCache.get(cacheKey);
  if (existing) return existing;

  const sessionKey = buildSessionKeyFromDmScope({
    cfg: params.cfg,
    agentId: normalizedAgentId,
    channel: params.channel,
    accountId: normalizedAccountId,
    peerId: normalizedPeerId,
  });

  sessionKeyCache.set(cacheKey, sessionKey);
  sessionPeerMap.set(sessionKey, normalizedPeerId);
  return sessionKey;
}

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
  context: RabbitmqSessionContext
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
  // 同步清理缓存
  for (const [cacheKey, sessionKey] of sessionKeyCache.entries()) {
    if (toRemove.includes(sessionKey)) {
      sessionKeyCache.delete(cacheKey);
    }
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
