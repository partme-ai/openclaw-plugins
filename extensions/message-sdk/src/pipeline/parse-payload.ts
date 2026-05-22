/**
 * 统一传输层入站载荷解析（替代各 MQ 插件内重复的 parseInboundText）。
 */

import { parseEnvelopeAny } from "../core/envelope.js";
import { parseMessageAny } from "../core/message.js";
import type { ParsedTransportPayload, PayloadParseMode } from "../core/types.js";

export type { ParsedTransportPayload, PayloadParseMode } from "../core/types.js";

/**
 * 解析原始载荷为文本与可选 UnifiedMessage。
 */
export function parseTransportPayload(
  rawPayload: string,
  mode: PayloadParseMode = "jsonTextOrPlain",
): ParsedTransportPayload {
  if (mode === "plain") {
    return { text: rawPayload, unified: null };
  }

  const envelope = parseEnvelopeAny(rawPayload);
  if (envelope?.message?.text) {
    const meta = envelope.message.metadata ?? {};
    return {
      text: envelope.message.text,
      unified: envelope.message,
      correlationId:
        envelope.headers?.correlationId ??
        (typeof meta.correlationId === "string" ? meta.correlationId : undefined),
      idempotencyKey:
        envelope.headers?.idempotencyKey ??
        (typeof meta.idempotencyKey === "string" ? meta.idempotencyKey : undefined),
      replyRoute: envelope.headers?.replyRoute,
    };
  }

  const unifiedMsg = parseMessageAny(rawPayload);
  if (unifiedMsg?.text) {
    const meta = unifiedMsg.metadata ?? {};
    return {
      text: unifiedMsg.text,
      unified: unifiedMsg,
      correlationId: typeof meta.correlationId === "string" ? meta.correlationId : undefined,
      idempotencyKey: typeof meta.idempotencyKey === "string" ? meta.idempotencyKey : undefined,
    };
  }

  if (mode === "jsonOnly") {
    return { text: "", unified: null };
  }

  try {
    const parsed = JSON.parse(rawPayload) as {
      text?: unknown;
      correlationId?: unknown;
      idempotencyKey?: unknown;
    };
    if (typeof parsed.text === "string" && parsed.text.trim().length > 0) {
      return {
        text: parsed.text,
        unified: null,
        correlationId:
          typeof parsed.correlationId === "string" ? parsed.correlationId : undefined,
        idempotencyKey:
          typeof parsed.idempotencyKey === "string" ? parsed.idempotencyKey : undefined,
      };
    }
  } catch {
    // fallback plain
  }

  return { text: rawPayload, unified: null };
}

/** @deprecated 使用 parseTransportPayload */
export function parseInboundText(rawPayload: string, mode: PayloadParseMode): string {
  return parseTransportPayload(rawPayload, mode).text;
}
