import type { ChannelOutboundContext } from 'openclaw/plugin-sdk';

import type { GotifyMessagePayload, GotifyStreamEnvelope } from './types.js';

export function mapOutboundToGotify(ctx: ChannelOutboundContext): GotifyMessagePayload {
  const baseExtras = (ctx.extras ?? undefined) as Record<string, unknown> | undefined;
  const metadata = (ctx as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
  const url =
    typeof metadata.url === 'string' && metadata.url.trim() ? metadata.url.trim() : undefined;
  const contentType =
    typeof metadata.contentType === 'string' && metadata.contentType.trim()
      ? metadata.contentType.trim()
      : undefined;

  const extras = mergeExtras(baseExtras, {
    ...(url ? { 'client::notification': { click: { url } } } : {}),
    ...(contentType ? { 'client::display': { contentType } } : {}),
  });

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
