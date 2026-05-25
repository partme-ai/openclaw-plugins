/**
 * MessageEnvelope build, parse, and serialize.
 */

import { buildMessage, parseMessage, parseMessageAny } from "./message.js";
import type {
  MessageEnvelope,
  MessageEnvelopeHeaders,
  ReplyRoute,
  UnifiedMessage,
} from "./types.js";

/**
 * Wrap UnifiedMessage in a version-1 envelope.
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
 * Build an outbound envelope with text body.
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
 * Parse MessageEnvelope from JSON string.
 */
export function parseEnvelope(raw: string): MessageEnvelope | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return null;

    if (obj.version === "1" && obj.message && typeof obj.message === "object") {
      const msg = obj.message as UnifiedMessage;
      if (!msg.messageId || !msg.source?.channel) return null;
      return {
        version: "1",
        message: msg,
        headers: (obj.headers as MessageEnvelopeHeaders) ?? undefined,
      };
    }

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
 * Parse MessageEnvelope from string, Buffer, Uint8Array, or object.
 */
export function parseEnvelopeAny(
  input: string | Buffer | Uint8Array | unknown,
): MessageEnvelope | null {
  if (typeof input === "string") return parseEnvelope(input);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) {
    return parseEnvelope(input.toString("utf-8"));
  }
  if (input instanceof Uint8Array) {
    return parseEnvelope(new TextDecoder().decode(input));
  }
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

/**
 * Extract correlation/idempotency from message metadata.
 */
export function extractRoutingMetadata(msg: UnifiedMessage): {
  correlationId?: string;
  idempotencyKey?: string;
} {
  const meta = msg.metadata ?? {};
  return {
    correlationId: typeof meta.correlationId === "string" ? meta.correlationId : undefined,
    idempotencyKey: typeof meta.idempotencyKey === "string" ? meta.idempotencyKey : undefined,
  };
}

/**
 * Merge replyRoute into envelope headers.
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
 * Read reply route from envelope headers.
 */
export function getReplyRoute(envelope: MessageEnvelope): ReplyRoute | undefined {
  return envelope.headers?.replyRoute;
}

/**
 * Serialize envelope to JSON string.
 */
export function serializeEnvelope(envelope: MessageEnvelope): string {
  return JSON.stringify(envelope);
}
