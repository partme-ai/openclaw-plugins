/**
 * 统一传输层出站载荷序列化。
 */

import { buildOutboundEnvelope, serializeEnvelope } from "../core/envelope.js";
import type { MessageEnvelopeHeaders, ReplyRoute } from "../core/types.js";

/**
 * OutboundWireFormat 是 pipeline 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type OutboundWireFormat = "envelope" | "legacyJsonText" | "plainText";

/**
 * SerializeOutboundParams 描述 pipeline 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
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
