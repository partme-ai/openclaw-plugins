/**
 * MQTT over WebSocket 会话上下文存储（出站路由元数据）。
 * sessionKey 由 OpenClaw resolveAgentRoute 生成，本模块不拼接会话键。
 */

import type { SessionContext } from "../types.js";

const sessionContextMap = new Map<string, SessionContext>();

/**
 * 以 OpenClaw 解析的 sessionKey 更新会话上下文。
 *
 * @param sessionKey - OpenClaw sessionKey
 * @param params - clientId、agentId、accountId、topic 等出站路由元数据
 * @returns 更新后的 SessionContext
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
 * 按 sessionKey 获取 MQTT 出站上下文。
 *
 * @param sessionKey - OpenClaw sessionKey
 * @returns SessionContext；不存在时 null
 */
export function getSessionContext(sessionKey: string): SessionContext | null {
  return sessionContextMap.get(sessionKey) ?? null;
}

/**
 * 获取当前内存中会话上下文数量。
 *
 * @returns `{ totalSessions }` 统计对象
 */
export function getSessionStats(): { totalSessions: number } {
  return { totalSessions: sessionContextMap.size };
}
