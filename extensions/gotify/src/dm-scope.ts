/**
 * dmScope 会话隔离工具 — 解析 OpenClaw 配置中的 dmScope 策略，
 * 并根据 scope 级别生成会话键。
 */

const VALID_DM_SCOPES = [
  'main',
  'per-peer',
  'per-channel-peer',
  'per-account-channel-peer',
] as const;
type DmScope = (typeof VALID_DM_SCOPES)[number];

interface DmScopeParams {
  cfg: Record<string, unknown>;
  agentId: string;
  channel: string;
  accountId: string;
  peerId: string;
}

interface StreamMessageLike {
  id?: number | string;
  appid?: number | string;
  title?: string;
  extras?: Record<string, unknown>;
}

const DEFAULT_DM_SCOPE: DmScope = 'per-peer';

/**
 * 从运行时配置中解析 dmScope，无效值回退为 'per-peer'。
 */
export function resolveDmScopeFromRuntimeConfig(cfg: Record<string, unknown>): DmScope {
  const session = cfg.session as Record<string, unknown> | undefined;
  const raw = session?.dmScope;
  if (typeof raw === 'string' && VALID_DM_SCOPES.includes(raw as DmScope)) {
    return raw as DmScope;
  }
  return DEFAULT_DM_SCOPE;
}

/**
 * 根据 dmScope 级别生成会话键。
 */
export function buildSessionKeyFromDmScope(params: DmScopeParams): string {
  const { agentId, channel, accountId, peerId } = params;
  const scope = resolveDmScopeFromRuntimeConfig(params.cfg);
  const normalizedPeer = peerId.trim().toLowerCase() || '';

  switch (scope) {
    case 'main':
      return `agent:${agentId}:main`;
    case 'per-peer':
      return normalizedPeer ? `agent:${agentId}:direct:${normalizedPeer}` : `agent:${agentId}:main`;
    case 'per-channel-peer':
      return normalizedPeer
        ? `agent:${agentId}:${channel}:direct:${normalizedPeer}`
        : `agent:${agentId}:main`;
    case 'per-account-channel-peer':
      return normalizedPeer
        ? `agent:${agentId}:${channel}:${accountId}:direct:${normalizedPeer}`
        : `agent:${agentId}:main`;
    default:
      return `agent:${agentId}:main`;
  }
}

/**
 * 从 Gotify stream 消息中解析 peer ID。
 * 优先级：extras.openclaw.peerId > appid > title > fallback 'gotify'
 */
export function resolvePeerIdFromStreamMessage(message: StreamMessageLike): string {
  const extras = message.extras as Record<string, unknown> | undefined;
  const openclaw = extras?.openclaw as Record<string, unknown> | undefined;
  const extraPeerId = openclaw?.peerId;

  if (typeof extraPeerId === 'string' && extraPeerId.trim()) {
    return extraPeerId.trim().toLowerCase();
  }

  if (message.appid !== undefined && message.appid !== null) {
    return String(message.appid).trim().toLowerCase() || 'gotify';
  }

  if (typeof message.title === 'string' && message.title.trim()) {
    return message.title.trim().toLowerCase();
  }

  return 'gotify';
}
