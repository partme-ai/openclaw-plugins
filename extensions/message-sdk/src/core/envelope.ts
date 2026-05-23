/**
 * @module core/envelope
 *
 * MessageEnvelope 构建、解析与序列化。
 *
 * **职责**：在 UnifiedMessage 外包装 version=1 信封，携带 correlationId、replyRoute 等传输 headers；
 * 兼容 legacy 裸 UnifiedMessage JSON。
 *
 * **关键导出**：`buildEnvelope`、`parseEnvelope`、`serializeEnvelope`、`buildOutboundEnvelope`
 */

import { buildMessage, parseMessage, parseMessageAny } from "./message.js";
import type {
  MessageEnvelope,
  MessageEnvelopeHeaders,
  ReplyRoute,
  UnifiedMessage,
} from "./types.js";

/**
 * 将 UnifiedMessage 包装为 version=1 信封 / Wrap UnifiedMessage in a version-1 envelope.
 *
 * @param message - 内嵌统一消息
 * @param headers - 可选传输 headers
 */
export function buildEnvelope(
  message: UnifiedMessage,
  headers?: MessageEnvelopeHeaders,
): MessageEnvelope {
  return {
    version: "1",
    message,
    ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

/**
 * 构造出站信封（direction=outbound）/ Build an outbound envelope with text body.
 *
 * @param params.channel - 渠道 ID
 * @param params.accountId - 账号 ID
 * @param params.userId - 用户/peer ID
 * @param params.text - 出站文本
 * @param params.agentId - 可选 agent ID
 * @param params.replyToMessageId - 可选回复目标
 * @param params.headers - 可选信封 headers
 */
export function buildOutboundEnvelope(params: {
  channel: string;
  accountId: string;
  userId: string;
  text: string;
  agentId?: string;
  replyToMessageId?: string;
  headers?: MessageEnvelopeHeaders;
}): MessageEnvelope {
  const message = buildMessage({
    channel: params.channel,
    accountId: params.accountId,
    userId: params.userId,
    agentId: params.agentId,
    text: params.text,
    replyToMessageId: params.replyToMessageId,
    direction: "outbound",
  });
  return buildEnvelope(message, params.headers);
}

/**
 * 从 JSON 字符串解析信封 / Parse MessageEnvelope from JSON string.
 *
 * 优先识别 version=1 信封；失败时尝试 legacy 裸 UnifiedMessage 并包装为信封。
 *
 * @param raw - JSON 字符串
 * @returns 有效信封或 null
 */
export function parseEnvelope(raw: string): MessageEnvelope | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return null;

    // 标准 version=1 信封路径
    if (obj.version === "1" && obj.message && typeof obj.message === "object") {
      const msg = obj.message as UnifiedMessage;
      if (!msg.messageId || !msg.source?.channel) return null;
      return {
        version: "1",
        message: msg,
        headers: (obj.headers as MessageEnvelopeHeaders) ?? undefined,
      };
    }

    // Legacy：整段 JSON 即为 UnifiedMessage
    const legacy = parseMessage(raw);
    if (legacy) {
      return { version: "1", message: legacy };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 从 UnifiedMessage.metadata 提取路由元数据 / Extract correlation/idempotency from message metadata.
 *
 * @param msg - 统一消息
 */
export function extractRoutingMetadata(msg: UnifiedMessage): {
  correlationId?: string;
  idempotencyKey?: string;
} {
  const meta = msg.metadata ?? {};
  return {
    correlationId:
      typeof meta.correlationId === "string" ? meta.correlationId : undefined,
    idempotencyKey:
      typeof meta.idempotencyKey === "string" ? meta.idempotencyKey : undefined,
  };
}

/**
 * 将 replyRoute 合并进信封 headers / Merge replyRoute into envelope headers.
 *
 * @param headers - 现有 headers，可为 undefined
 * @param replyRoute - 出站回复路由
 * @returns 合并后的 headers；replyRoute 为空时原样返回
 */
export function mergeReplyRouteIntoHeaders(
  headers: MessageEnvelopeHeaders | undefined,
  replyRoute: ReplyRoute | undefined,
): MessageEnvelopeHeaders | undefined {
  if (!replyRoute || Object.keys(replyRoute).length === 0) {
    return headers;
  }
  return { ...headers, replyRoute };
}

/**
 * 序列化信封为 JSON 字符串 / Serialize envelope to JSON string.
 *
 * @param envelope - version=1 信封
 */
export function serializeEnvelope(envelope: MessageEnvelope): string {
  return JSON.stringify(envelope);
}

/**
 * 从多种输入形态解析信封 / Parse MessageEnvelope from string, Buffer, or object.
 *
 * @param input - 原始输入
 * @returns 有效信封或 null
 */
export function parseEnvelopeAny(
  input: string | Buffer | Uint8Array | unknown,
): MessageEnvelope | null {
  if (typeof input === "string") return parseEnvelope(input);
  if (Buffer.isBuffer(input)) return parseEnvelope(input.toString("utf-8"));
  if (input instanceof Uint8Array) return parseEnvelope(new TextDecoder().decode(input));
  if (typeof input === "object" && input !== null) {
    const o = input as Record<string, unknown>;
    if (o.version === "1" && o.message) {
      return o as unknown as MessageEnvelope;
    }
    const unified = parseMessageAny(input);
    if (unified) {
      return { version: "1", message: unified };
    }
  }
  return null;
}
