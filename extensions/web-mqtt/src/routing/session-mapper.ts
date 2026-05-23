/**
 * MQTT over WebSocket 会话上下文存储（出站路由元数据）。
 * sessionKey 由 OpenClaw resolveAgentRoute 生成，本模块不拼接会话键。
 */

import type { SessionContext } from "../types.js";

const sessionContextMap = new Map<string, SessionContext>();

/**
 * 以 OpenClaw 解析的 sessionKey 更新会话上下文。
 */
export function upsertSessionContext(
  sessionKey: string,
  params: {
    clientId: string;
    agentId: string;
    accountId: string;
    lastInboundTopic: string;
    replyTopic?: string;
  },
): SessionContext {
  const existing = sessionContextMap.get(sessionKey);
  const context: SessionContext = {
    sessionKey,
    clientId: params.clientId,
    agentId: params.agentId,
    accountId: params.accountId,
    lastInboundTopic: params.lastInboundTopic,
    replyTopic: params.replyTopic ?? existing?.replyTopic,
  };
  sessionContextMap.set(sessionKey, context);
  return context;
}

/**
 * 按 sessionKey 获取上下文。
 */
export function getSessionContext(sessionKey: string): SessionContext | null {
  return sessionContextMap.get(sessionKey) ?? null;
}

/**
 * 获取会话快照数量。
 */
export function getSessionStats(): { totalSessions: number } {
  return { totalSessions: sessionContextMap.size };
}
