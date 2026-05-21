import type { GotifyStreamEnvelope } from './types.js';

/** 判断 token 是否为纯数字（Gotify appid 等），避免 Control UI 只显示 "4" 这类标签。 */
function isNumericPeerToken(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

/**
 * 将纯数字 appid 格式化为可读展示名（对齐 Telegram/Feishu 对 numeric id 的处理习惯）。
 */
export function formatGotifyAppDisplayName(appid: string | number): string {
  return `app ${String(appid).trim()}`;
}

function readOpenClawExtras(message: GotifyStreamEnvelope): Record<string, unknown> | undefined {
  const extras = message.extras as Record<string, unknown> | undefined;
  const openclaw = extras?.openclaw;
  return typeof openclaw === 'object' && openclaw !== null && !Array.isArray(openclaw)
    ? (openclaw as Record<string, unknown>)
    : undefined;
}

/**
 * 从 Gotify stream 消息解析 peer ID（用于 resolveAgentRoute 的 peer.id）。
 * 优先级：extras.openclaw.peerId > appid > title > fallback 'gotify'
 */
export function resolveGotifyPeerId(message: GotifyStreamEnvelope): string {
  const openclaw = readOpenClawExtras(message);
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

/**
 * 解析会话标签中的应用名段（ConversationLabel 中间段，与 SenderName 来源一致）。
 */
function resolveGotifyAppNameSegment(
  message: GotifyStreamEnvelope,
  peerId: string,
  appName?: string | null
): string {
  const openclaw = readOpenClawExtras(message);
  const extraPeerId = typeof openclaw?.peerId === 'string' ? openclaw.peerId.trim() : '';
  if (extraPeerId && !isNumericPeerToken(extraPeerId)) {
    return extraPeerId;
  }

  const resolvedAppName = typeof appName === 'string' ? appName.trim() : '';
  if (resolvedAppName) {
    return resolvedAppName;
  }

  const title = typeof message.title === 'string' ? message.title.trim() : '';
  if (title) {
    return title;
  }

  if (message.appid !== undefined && message.appid !== null) {
    return String(message.appid).trim();
  }

  if (isNumericPeerToken(peerId)) {
    return peerId;
  }

  return peerId;
}

export type GotifyConversationLabelOptions = {
  /** OpenClaw 账号 ID，默认 default。 */
  accountId?: string;
  /** Gotify 应用 API 解析到的名称（可选）。 */
  appName?: string | null;
};

/**
 * 解析 Control UI 会话标签（写入 ConversationLabel / origin.label）。
 * 格式：gotify:{appName}:{accountId}:direct:{peerId}
 * per-account-channel-peer 路由下 parseGroupKey 无法解析 sessionKey，UI 会回退显示 origin.label。
 */
export function resolveGotifyConversationLabel(
  message: GotifyStreamEnvelope,
  peerId: string,
  options?: GotifyConversationLabelOptions | string | null
): string {
  const normalizedOptions: GotifyConversationLabelOptions =
    typeof options === 'string' || options === null || options === undefined
      ? { appName: options ?? undefined }
      : options;

  const accountId = (normalizedOptions.accountId ?? 'default').trim() || 'default';
  const appNameSegment = resolveGotifyAppNameSegment(
    message,
    peerId,
    normalizedOptions.appName
  );

  return `gotify:${appNameSegment}:${accountId}:direct:${peerId}`;
}

/**
 * 解析发送方展示名（Session 元数据 / SenderName；direct 会话 label 的兜底来源）。
 * 优先级：API 应用名 > message.title > extras.openclaw.peerId（非纯数字）> app {appId} > peerId
 */
export function resolveGotifySenderName(
  message: GotifyStreamEnvelope,
  peerId: string,
  appName?: string | null
): string {
  const resolvedAppName = typeof appName === 'string' ? appName.trim() : '';
  if (resolvedAppName) {
    return resolvedAppName;
  }

  const title = typeof message.title === 'string' ? message.title.trim() : '';
  if (title) {
    return title;
  }

  const openclaw = readOpenClawExtras(message);
  const extraPeerId = typeof openclaw?.peerId === 'string' ? openclaw.peerId.trim() : '';
  if (extraPeerId && !isNumericPeerToken(extraPeerId)) {
    return extraPeerId;
  }

  if (message.appid !== undefined && message.appid !== null) {
    return formatGotifyAppDisplayName(message.appid);
  }

  if (isNumericPeerToken(peerId)) {
    return formatGotifyAppDisplayName(peerId);
  }

  return peerId;
}
