/**
 * Gotify Message Mapper — OpenClaw ↔ Gotify 消息格式双向转换。
 *
 * ## 出站 (OpenClaw → Gotify)
 * - 将 OpenClaw ChannelOutboundContext 映射为 Gotify POST /message payload
 * - 自动注入 extras.openclaw.{source: "openclaw", outbound: true} 防止回环
 * - 映射 metadata.url → client::notification.click.url
 * - 映射 metadata.contentType → client::display.contentType
 *
 * ## 入站检测
 * - isOpenClawOutboundStreamMessage() 检测 WebSocket 流中的自身回显
 */

import type { ChannelOutboundContext } from "openclaw/plugin-sdk/channel-contract";

import {
  isOutboundEcho,
  markOutboundMetadata,
} from "@partme.ai/openclaw-message-sdk/metadata";
import {
  buildMessage,
  type UnifiedMessage,
} from "@partme.ai/openclaw-message-sdk";
import type { GotifyMessagePayload, GotifyStreamEnvelope } from "../../types.js";

type GotifyOutboundContext = ChannelOutboundContext & {
  extras?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  priority?: number;
  title?: string;
};

/**
 * 为出站消息合并 openclaw 出站标记，避免 WebSocket /stream 回环触发 Agent。
 *
 * @param extras - 调用方已经提供的 Gotify extras；允许为空。
 * @returns 合并了 `extras.openclaw.outbound=true` 标记的新 extras 对象。
 */
export function withOpenClawOutboundExtras(
  extras?: Record<string, unknown> | null,
): Record<string, unknown> {
  return markOutboundMetadata(extras);
}

/**
 * 判断 stream 消息是否为 OpenClaw 自身发出的出站回显。
 *
 * @param message - Gotify stream 消息或至少包含 extras 字段的对象。
 * @returns true 表示该消息由本插件发送，应在入站阶段跳过。
 */
export function isOpenClawOutboundStreamMessage(message: {
  extras?: Record<string, unknown>;
}): boolean {
  return isOutboundEcho(message);
}

/**
 * 将 OpenClaw 出站上下文映射为 Gotify Message API payload。
 *
 * 除正文、标题、优先级外，该函数还会把 OpenClaw metadata 转换为 Gotify extras：
 * - `metadata.url` -> `client::notification.click.url`
 * - `metadata.contentType` -> `client::display.contentType`
 * - OpenClaw outbound marker -> `extras.openclaw`
 *
 * @param ctx - OpenClaw 渠道出站上下文。
 * @returns 可直接传给 `sendGotifyMessage()` 的 Gotify payload。
 */
export function mapOutboundToGotify(
  ctx: GotifyOutboundContext,
): GotifyMessagePayload {
  const baseExtras = ctx.extras ?? undefined;
  const metadata = ctx.metadata ?? {};
  const url =
    typeof metadata.url === "string" && metadata.url.trim()
      ? metadata.url.trim()
      : undefined;
  const contentType =
    typeof metadata.contentType === "string" && metadata.contentType.trim()
      ? metadata.contentType.trim()
      : undefined;

  const extras = withOpenClawOutboundExtras(
    mergeExtras(baseExtras, {
      ...(url ? { "client::notification": { click: { url } } } : {}),
      ...(contentType ? { "client::display": { contentType } } : {}),
    }),
  );

  return {
    message: ctx.text,
    title: ctx.title ?? undefined,
    priority: typeof ctx.priority === "number" ? ctx.priority : undefined,
    extras,
  };
}

/**
 * 将 Gotify stream/message 响应转换为最小入站文本结构。
 *
 * @param message - Gotify Message API 或 WebSocket stream 返回的消息对象。
 * @returns 供上层继续构造 UnifiedMessage 的正文与原始元数据。
 */
export function mapGotifyToInbound(message: GotifyStreamEnvelope): {
  text: string;
  metadata: Record<string, unknown>;
} {
  return {
    text: typeof message.message === "string" ? message.message : "",
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

/**
 * 将 Gotify stream 消息转换为 message-sdk 的 UnifiedMessage。
 *
 * @param params - 映射上下文。
 * @param params.accountId - 当前 Gotify 账号 ID。
 * @param params.peerId - 已解析的稳定对端 ID。
 * @param params.agentId - 已路由的 agent ID；未解析前可为空。
 * @param params.message - Gotify stream 原始消息。
 * @returns 标准化后的 OpenClaw/message-sdk 消息对象。
 */
export function mapGotifyStreamToUnified(params: {
  accountId: string;
  peerId: string;
  agentId?: string;
  message: GotifyStreamEnvelope;
}): UnifiedMessage {
  const inbound = mapGotifyToInbound(params.message);
  return buildMessage({
    channel: "gotify",
    accountId: params.accountId,
    userId: params.peerId,
    agentId: params.agentId,
    text: inbound.text,
    chatType: "direct",
    direction: "inbound",
    metadata: inbound.metadata,
  });
}

/**
 * 合并调用方 extras 与插件生成的 extras patch。
 *
 * @param base - 调用方提供的 Gotify extras。
 * @param patch - 插件生成的 extras 增量。
 * @returns 合并结果；两者都为空时返回 undefined，避免发送空对象。
 */
function mergeExtras(
  base: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!base && Object.keys(patch).length === 0) return undefined;
  if (!base) return patch;
  return deepMerge(base, patch);
}

/**
 * 深度合并两个纯对象。
 *
 * Gotify extras 使用命名空间对象，例如 `client::notification`，直接浅合并会覆盖
 * 调用方已经设置的 click/title 等子字段，因此这里仅对纯对象递归合并。
 *
 * @param a - 基础对象。
 * @param b - 覆盖对象。
 * @returns 合并后的新对象，不修改入参。
 */
function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [key, value] of Object.entries(b)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(
        out[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * 判断值是否为可递归合并的普通对象。
 *
 * @param value - 待检查值。
 * @returns true 表示 value 是非数组对象。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
