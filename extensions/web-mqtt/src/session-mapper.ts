/**
 * MQTT over WebSocket 会话映射。
 * 会话键格式与 openclaw-mqtt / openclaw-stomp 保持一致：
 * - main: agent:<agentId>:main
 * - per-peer: agent:<agentId>:direct:<peerId>
 * - per-channel-peer: agent:<agentId>:mqtt-ws:direct:<peerId>
 * - per-account-channel-peer: agent:<agentId>:mqtt-ws:<accountId>:direct:<peerId>
 */

import type { SessionContext } from "./types.js";

const clientSessionMap = new Map<string, string>();
const sessionContextMap = new Map<string, SessionContext>();

/**
 * 创建或更新会话上下文。
 */
export async function getOrCreateSessionContext(params: {
  clientId: string;
  agentId: string;
  accountId: string;
  dmScope: "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
  inboundTopic: string;
  replyTopic?: string;
}): SessionContext {
  const key = buildIdentityKey(params.clientId, params.agentId, params.accountId, params.dmScope);
  const existingSessionKey = clientSessionMap.get(key);
  if (existingSessionKey) {
    const existing = sessionContextMap.get(existingSessionKey);
    if (existing) {
      existing.lastInboundTopic = params.inboundTopic;
      existing.replyTopic = params.replyTopic ?? existing.replyTopic;
      return existing;
    }
  }

  const sessionKey = params.sessionKey;
  const context: SessionContext = {
    sessionKey,
    clientId: params.clientId,
    agentId: params.agentId,
    accountId: params.accountId,
    lastInboundTopic: params.inboundTopic,
    replyTopic: params.replyTopic,
  };
  clientSessionMap.set(key, sessionKey);
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

function buildIdentityKey(
  clientId: string,
  agentId: string,
  accountId: string,
  dmScope: "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer",
): string {
  const peer = normalizeToken(clientId);
  const agent = normalizeToken(agentId) || "main";
  const account = normalizeToken(accountId) || "default";
  if (!peer || dmScope === "main") return "main";
  if (dmScope === "per-peer") return `peer:${peer}`;
  if (dmScope === "per-account-channel-peer") return `account-channel-peer:${account}:mqtt-ws:${peer}`;
  return `channel-peer:mqtt-ws:${peer}:${agent}`;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}
