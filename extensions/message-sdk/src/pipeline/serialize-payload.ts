/**
 * 统一传输层出站载荷序列化。
 */

import { buildOutboundEnvelope, serializeEnvelope } from "../core/envelope.js";
import type { MessageEnvelopeHeaders, ReplyRoute } from "../core/types.js";

export type OutboundWireFormat = "envelope" | "legacyJsonText" | "plainText";

export interface SerializeOutboundParams {
  channel: string;
  accountId: string;
  userId: string;
  text: string;
  agentId?: string;
  format?: OutboundWireFormat;
  headers?: MessageEnvelopeHeaders;
  replyRoute?: ReplyRoute;
}

/**
 * 将 Agent 回复文本序列化为线传输字符串。
 */
export function serializeForTransport(params: SerializeOutboundParams): string {
  const format = params.format ?? "envelope";

  if (format === "plainText") {
    return params.text;
  }

  if (format === "legacyJsonText") {
    return JSON.stringify({ text: params.text });
  }

  const envelope = buildOutboundEnvelope({
    channel: params.channel,
    accountId: params.accountId,
    userId: params.userId,
    text: params.text,
    agentId: params.agentId,
    headers: {
      ...params.headers,
      ...(params.replyRoute ? { replyRoute: params.replyRoute } : {}),
    },
  });
  return serializeEnvelope(envelope);
}

/** @deprecated 使用 serializeForTransport */
export function wrapTextPayload(text: string): string {
  return JSON.stringify({ text });
}
