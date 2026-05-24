/**
 * @module mqtt/routing/session-mapper
 *
 * MQTT Session 映射模块
 * 管理 MQTT Client 到 OpenClaw Session 的映射关系
 *
 * 每个 MQTT 客户端连接对应一个 OpenClaw 会话。
 * 会话键格式与 OpenClaw dmScope 规则一致：
 * - main: agent:<agentId>:main
 * - per-peer: agent:<agentId>:direct:<peerId>
 * - per-channel-peer: agent:<agentId>:mqtt:direct:<peerId>
 * - per-account-channel-peer: agent:<agentId>:mqtt:<accountId>:direct:<peerId>
 */

import type { MqttSessionContext } from "../types.js";

/** Session Key -> Client ID 反向映射 */
const sessionClientMap = new Map<string, string>();

/** Session Key -> Session Context（记录 topic/account/replyTopic 等） */
const sessionContextMap = new Map<string, MqttSessionContext>();
/** 断线会话清理计时器 */
const clientExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** 会话过期策略（秒） */
let maxSessionExpirySeconds = 0;
let persistentAcrossReconnect = true;
/** 延迟过期次数统计 */
let delayedExpiryCount = 0;

/**
 * 根据 Session Key 查找关联的 MQTT Client ID
 * 用于 Agent 回复时确定消息发送目标
 *
 * @param sessionKey - OpenClaw 会话键
 * @returns MQTT Client ID，null 表示无关联
 */
export function getClientIdBySession(sessionKey: string): string | null {
  return sessionClientMap.get(sessionKey) ?? null;
}

/**
 * 以路由结果更新会话上下文
 *
 * @param sessionKey - OpenClaw 会话键
 * @param context - 上下文信息
 */
export function upsertSessionContext(
  sessionKey: string,
  context: MqttSessionContext,
): void {
  sessionContextMap.set(sessionKey, { ...context, updatedAt: Date.now() });
  if (context.clientId) {
    sessionClientMap.set(sessionKey, context.clientId);
  }
}

/**
 * 获取会话上下文
 *
 * @param sessionKey - OpenClaw 会话键
 * @returns 会话上下文，若不存在返回 null
 */
export function getSessionContext(sessionKey: string): MqttSessionContext | null {
  return sessionContextMap.get(sessionKey) ?? null;
}

/**
 * 移除客户端的所有会话映射
 * 在客户端断开连接时调用
 *
 * @param clientId - MQTT Client ID
 */
export function removeClientSessions(clientId: string): void {
  const timer = clientExpiryTimers.get(clientId);
  if (timer) {
    clearTimeout(timer);
    clientExpiryTimers.delete(clientId);
  }

  const toRemove: string[] = [];
  for (const [sessionKey, mappedClientId] of sessionClientMap.entries()) {
    if (mappedClientId === clientId) {
      toRemove.push(sessionKey);
    }
  }

  for (const sessionKey of toRemove) {
    sessionClientMap.delete(sessionKey);
    sessionContextMap.delete(sessionKey);
  }

  if (toRemove.length > 0) {
    console.log(`[openclaw-mqtt] Removed ${toRemove.length} sessions for client: ${clientId}`);
  }
}

/**
 * 配置会话过期策略（秒）。
 */
export function configureSessionExpiry(
  maxExpirySeconds: number,
  persistent: boolean,
): void {
  maxSessionExpirySeconds = Math.max(0, Math.floor(maxExpirySeconds));
  persistentAcrossReconnect = persistent;
}

/**
 * 客户端连接时取消挂起的延迟清理。
 */
export function markClientConnected(clientId: string): void {
  const timer = clientExpiryTimers.get(clientId);
  if (!timer) return;
  clearTimeout(timer);
  clientExpiryTimers.delete(clientId);
}

/**
 * 客户端断线时按策略处理会话：
 * - 0 秒：立即清理
 * - >0 秒：延迟清理
 */
export function handleClientDisconnected(clientId: string): void {
  if (!persistentAcrossReconnect) {
    removeClientSessions(clientId);
    return;
  }
  if (maxSessionExpirySeconds <= 0) {
    removeClientSessions(clientId);
    return;
  }
  const existing = clientExpiryTimers.get(clientId);
  if (existing) {
    clearTimeout(existing);
  }
  delayedExpiryCount += 1;
  const timer = setTimeout(() => {
    clientExpiryTimers.delete(clientId);
    removeClientSessions(clientId);
  }, maxSessionExpirySeconds * 1000);
  clientExpiryTimers.set(clientId, timer);
}

/**
 * 获取所有活跃的会话映射
 * 用于调试和监控
 */
export function getAllSessionMappings(): Array<{
  clientId: string;
  sessionKey: string;
  context: MqttSessionContext | null;
}> {
  const result: Array<{
    clientId: string;
    sessionKey: string;
    context: MqttSessionContext | null;
  }> = [];

  for (const [sessionKey, clientId] of sessionClientMap.entries()) {
    result.push({
      clientId,
      sessionKey,
      context: getSessionContext(sessionKey),
    });
  }

  return result;
}

/**
 * 获取会话统计数据
 */
export function getSessionStats(): {
  activeSessions: number;
  uniqueClients: number;
  contextBoundSessions: number;
  pendingExpiryClients: number;
  delayedExpiryCount: number;
} {
  const uniqueClients = new Set(sessionClientMap.values());

  return {
    activeSessions: sessionClientMap.size,
    uniqueClients: uniqueClients.size,
    contextBoundSessions: sessionContextMap.size,
    pendingExpiryClients: clientExpiryTimers.size,
    delayedExpiryCount,
  };
}
