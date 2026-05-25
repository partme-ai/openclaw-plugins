/**
 * @module web-socket/routing/session-mapper
 *
 * WebSocket 连接 ↔ OpenClaw Session 映射。
 */

import type { WebsocketSessionContext } from "../types.js";

const sessionConnectionMap = new Map<string, string>();
const sessionContextMap = new Map<string, WebsocketSessionContext>();
const connectionExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

let maxSessionExpirySeconds = 0;
let persistentAcrossReconnect = true;

/**
 * 配置断线后会话过期策略。
 */
export function configureSessionExpiry(
  maxExpirySeconds: number,
  persistent: boolean,
): void {
  maxSessionExpirySeconds = Math.max(0, maxExpirySeconds);
  persistentAcrossReconnect = persistent;
}

/**
 * 按 sessionKey 查找 WebSocket connectionId。
 */
export function getConnectionIdBySession(sessionKey: string): string | null {
  return sessionConnectionMap.get(sessionKey) ?? null;
}

/**
 * 写入或更新会话上下文。
 */
export function upsertSessionContext(
  sessionKey: string,
  context: WebsocketSessionContext,
): void {
  sessionContextMap.set(sessionKey, { ...context, updatedAt: Date.now() });
  sessionConnectionMap.set(sessionKey, context.connectionId);
}

/**
 * 读取会话上下文。
 */
export function getSessionContext(sessionKey: string): WebsocketSessionContext | null {
  return sessionContextMap.get(sessionKey) ?? null;
}

/**
 * 连接建立时取消该 connectionId 的延迟清理。
 */
export function markConnectionConnected(connectionId: string): void {
  const timer = connectionExpiryTimers.get(connectionId);
  if (timer) {
    clearTimeout(timer);
    connectionExpiryTimers.delete(connectionId);
  }
}

/**
 * 连接断开时按策略清理会话映射。
 */
export function handleConnectionDisconnected(connectionId: string): void {
  if (persistentAcrossReconnect && maxSessionExpirySeconds > 0) {
    const existing = connectionExpiryTimers.get(connectionId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      removeConnectionSessions(connectionId);
      connectionExpiryTimers.delete(connectionId);
    }, maxSessionExpirySeconds * 1000);
    connectionExpiryTimers.set(connectionId, timer);
    return;
  }
  removeConnectionSessions(connectionId);
}

/**
 * 移除某连接关联的全部 session 映射。
 */
export function removeConnectionSessions(connectionId: string): void {
  const timer = connectionExpiryTimers.get(connectionId);
  if (timer) {
    clearTimeout(timer);
    connectionExpiryTimers.delete(connectionId);
  }
  const toRemove: string[] = [];
  for (const [sessionKey, connId] of sessionConnectionMap.entries()) {
    if (connId === connectionId) {
      toRemove.push(sessionKey);
    }
  }
  for (const key of toRemove) {
    sessionConnectionMap.delete(key);
    sessionContextMap.delete(key);
  }
}

/**
 * 会话统计（状态 API）。
 */
export function getSessionStats(): {
  sessionCount: number;
  connectionCount: number;
} {
  const connections = new Set(sessionConnectionMap.values());
  return {
    sessionCount: sessionContextMap.size,
    connectionCount: connections.size,
  };
}
