/**
 * 会话隔离 —— dmScope 决议与 sessionKey 构建。
 *
 * 与 openclaw-mqtt / openclaw-stomp / openclaw-rabbitmq / openclaw-gotify 等插件完全一致的实现模式。
 * 默认 per-peer，确保 session key 遵循 agent:<agentId>:direct:<peerId> 规则（与飞书一致）。
 */

import type { DmScope } from "./types.js";

/**
 * 从 OpenClaw 运行时配置读取 dmScope。
 * 默认 per-peer，与飞书等渠道插件保持一致。
 */
export function resolveDmScopeFromRuntimeConfig(
  cfg: Record<string, unknown>,
): DmScope {
  const rawScope = (cfg.session as { dmScope?: unknown } | undefined)?.dmScope;
  const allowed = new Set([
    "main",
    "per-peer",
    "per-channel-peer",
    "per-account-channel-peer",
  ]);
  if (typeof rawScope === "string" && allowed.has(rawScope)) {
    return rawScope as DmScope;
  }
  return "per-peer";
}

/**
 * 根据 dmScope 生成统一的会话键。
 *
 * 格式规则（与飞书等渠道插件保持一致）：
 * - per-peer (默认): agent:<agentId>:direct:<peerId>
 * - per-channel-peer: agent:<agentId>:<channel>:direct:<peerId>
 * - per-account-channel-peer: agent:<agentId>:<channel>:<accountId>:direct:<peerId>
 * - main (显式配置): agent:<agentId>:main
 * - 空 peerId 回退: agent:<agentId>:main
 */
export function buildSessionKeyFromDmScope(params: {
  cfg: Record<string, unknown>;
  agentId: string;
  channel: string;
  accountId: string;
  peerId: string;
}): string {
  const dmScope = resolveDmScopeFromRuntimeConfig(params.cfg);
  const agent = normalizeToken(params.agentId) || "main";
  const channel = normalizeToken(params.channel) || "unknown";
  const accountId = normalizeToken(params.accountId) || "default";
  const peerId = normalizeToken(params.peerId);

  if (!peerId) {
    return `agent:${agent}:main`;
  }
  if (dmScope === "main") {
    return `agent:${agent}:main`;
  }
  if (dmScope === "per-account-channel-peer") {
    return `agent:${agent}:${channel}:${accountId}:direct:${peerId}`;
  }
  if (dmScope === "per-channel-peer") {
    return `agent:${agent}:${channel}:direct:${peerId}`;
  }
  return `agent:${agent}:direct:${peerId}`;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}
