import type { ChannelOutboundContext } from 'openclaw/plugin-sdk/channel-contract';

import type { GotifyMessagePayload, GotifyStreamEnvelope } from './types.js';

/** OpenClaw 写入 Gotify extras 的命名空间键。 */
export const OPENCLAW_EXTRAS_KEY = 'openclaw';

/**
 * 为出站消息合并 openclaw 出站标记，避免 WebSocket /stream 回环触发 Agent。
 */
export function withOpenClawOutboundExtras(
  extras?: Record<string, unknown> | null
): Record<string, unknown> {
  const base = extras ?? {};
  const existing = isPlainObject(base[OPENCLAW_EXTRAS_KEY])
    ? (base[OPENCLAW_EXTRAS_KEY] as Record<string, unknown>)
    : {};
  return {
    ...base,
    [OPENCLAW_EXTRAS_KEY]: {
      ...existing,
      source: 'openclaw',
      outbound: true,
    },
  };
}

/**
 * 判断 stream 消息是否为 OpenClaw 自身发出的出站回显。
 */
export function isOpenClawOutboundStreamMessage(message: {
  extras?: Record<string, unknown>;
}): boolean {
  const openclaw = message.extras?.[OPENCLAW_EXTRAS_KEY];
  if (!isPlainObject(openclaw)) {
    return false;
  }
  return openclaw.source === 'openclaw' && openclaw.outbound === true;
}

export function mapOutboundToGotify(ctx: ChannelOutboundContext): GotifyMessagePayload {
  const baseExtras = (ctx.extras ?? undefined) as Record<string, unknown> | undefined;
  const metadata = (ctx as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
  const url =
    typeof metadata.url === 'string' && metadata.url.trim() ? metadata.url.trim() : undefined;
  const contentType =
    typeof metadata.contentType === 'string' && metadata.contentType.trim()
      ? metadata.contentType.trim()
      : undefined;

  const extras = withOpenClawOutboundExtras(
    mergeExtras(baseExtras, {
      ...(url ? { 'client::notification': { click: { url } } } : {}),
      ...(contentType ? { 'client::display': { contentType } } : {}),
    })
  );

  return {
    message: ctx.text,
    title: ctx.title ?? undefined,
    priority: typeof ctx.priority === 'number' ? ctx.priority : undefined,
    extras,
  };
}

export function mapGotifyToInbound(message: GotifyStreamEnvelope): {
  text: string;
  metadata: Record<string, unknown>;
} {
  return {
    text: typeof message.message === 'string' ? message.message : '',
    metadata: {
      id: message.id,
      appid: message.appid,
      title: message.title,
      priority: message.priority,
      extras: message.extras,
      date: message.date,
    },
  };
}

function mergeExtras(
  base: Record<string, unknown> | undefined,
  patch: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!base && Object.keys(patch).length === 0) return undefined;
  if (!base) return patch;
  return deepMerge(base, patch);
}

function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [key, value] of Object.entries(b)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
