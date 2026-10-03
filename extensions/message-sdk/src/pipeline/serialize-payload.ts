/**
 * @module pipeline/serialize-payload
 *
 * 统一传输层出站载荷序列化。
 *
 * **职责**：将 Agent 回复文本序列化为 wire 字符串（envelope / legacyJsonText / plainText）。
 *
 * **适用场景**：MQ 出站 publish、embedded/subagent dispatch deliver 回调。
 *
 * **关键导出**：`serializeForTransport`、`SerializeOutboundParams`
 */

import { parseStructuredWire } from "../core/structured-wire.js";
import type { StructuredWireMessage } from "../core/types.js";
import { buildOutboundEnvelope, serializeEnvelope } from "../core/envelope.js";
import type { MessageEnvelopeHeaders, ReplyRoute } from "../core/types.js";

/**
 * 出站线传输格式 / Outbound wire format.
 *
 * - `envelope`：version=1 MessageEnvelope（推荐）
 * - `legacyJsonText`：`{ text: "..." }` JSON
 * - `plainText`：裸文本
 */
export type OutboundWireFormat = "envelope" | "legacyJsonText" | "plainText" | "structured-v1";

/**
 * serializeForTransport 参数 / Parameters for outbound serialization.
 */
export interface SerializeOutboundParams {
  structured?: StructuredWireMessage;
  /** 仅传入已经过宿主授权加载的精确引用。 */
  authorizedMediaUrls?: readonly string[];
  /** 渠道 ID / Channel id */
  channel: string;
  /** 账号 ID / Account id */
  accountId: string;
  /** 用户/peer ID（写入 envelope source.userId）/ User or peer id */
  userId: string;
  /** 出站文本 / Outbound text */
  text: string;
  /** 可选 agent ID / Optional agent id */
  agentId?: string;
  /** 序列化格式，默认 envelope / Wire format, default envelope */
  format?: OutboundWireFormat;
  /** 信封 headers / Envelope headers */
  headers?: MessageEnvelopeHeaders;
  /** 出站回复路由（合并进 headers.replyRoute）/ Reply route for publish */
  replyRoute?: ReplyRoute;
}

/**
 * 将 Agent 回复文本序列化为线传输字符串 / Serialize Agent reply for wire transport.
 *
 * @param params - 序列化参数
 * @returns 可直接 publish 的字符串
 */
export function serializeForTransport(params: SerializeOutboundParams): string {
  const format = params.format ?? "envelope";
  if (format === "structured-v1") {
    const message = parseStructuredWire(params.structured);
    for (const part of message.parts) {
      if (part.type === "media" && !params.authorizedMediaUrls?.includes(part.url)) throw new Error("structured media is not authorized");
    }
    return JSON.stringify({ format: "structured-v1", ...message });
  }

  if (format === "plainText") {
    return params.text;
  }

  if (format === "legacyJsonText") {
    return JSON.stringify({ text: params.text });
  }

  // 默认 envelope：buildOutboundEnvelope + replyRoute headers
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
