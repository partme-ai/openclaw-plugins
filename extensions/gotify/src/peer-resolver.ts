import type { GotifyStreamEnvelope } from './types.js';

/**
 * 从 Gotify stream 消息解析 peer ID（用于 resolveAgentRoute 的 peer.id）。
 * 优先级：extras.openclaw.peerId > appid > title > fallback 'gotify'
 */
export function resolveGotifyPeerId(message: GotifyStreamEnvelope): string {
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
