/**
 * @module tracing/dm-scope
 *
 * OpenClaw **dmScope** 会话键解析（与 Gateway session 配置对齐）。
 *
 * **职责**：
 * - 从 runtime config 读取标准四档 dmScope（非法值回退 `main`）
 * - 按 agent / channel / account / peer 维度生成统一 sessionKey
 *
 * **适用场景**：tracing hooks 需要与会话维度一致的 trace 关联（测试与 sampler 辅助）。
 */

export type DmScope = "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";

/**
 * 从 OpenClaw 运行时配置读取 dmScope。
 * 仅接受 OpenClaw 标准四档，非法或缺失时回退 main。
 *
 * @param cfg - OpenClaw 全局 runtime 配置对象
 * @returns 规范化后的 DmScope 枚举值
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
 *
 * @param params - 含 cfg、agentId、channel、accountId、peerId 的维度参数
 * @returns OpenClaw sessionKey 字符串
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

/**
 * 规范化 sessionKey 片段（trim + lowercase）。
 */
function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}