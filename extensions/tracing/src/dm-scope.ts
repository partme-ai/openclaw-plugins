export type DmScope = "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";

/**
 * 从 OpenClaw 运行时配置读取 dmScope。
 * 仅接受 OpenClaw 标准四档，非法或缺失时回退 main。
 */
export function resolveDmScopeFromRuntimeConfig(cfg: Record<string, unknown>): DmScope {
  const rawScope = (cfg.session as { dmScope?: unknown } | undefined)?.dmScope;
  const allowed = new Set(["main", "per-peer", "per-channel-peer", "per-account-channel-peer"]);
  if (typeof rawScope === "string" && allowed.has(rawScope)) {
    return rawScope as DmScope;
  }
  return "main";
}

/**
 * 根据 dmScope 生成统一的会话键。
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

  if (!peerId || dmScope === "main") {
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