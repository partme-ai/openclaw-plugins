/**
 * @module pipeline/parse-payload
 *
 * 统一传输层入站载荷解析。
 *
 * **职责**：替代各 MQ 插件内重复的 parseInboundText，将 raw payload 解析为
 * 文本 + 可选 UnifiedMessage + correlationId/idempotencyKey/replyRoute。
 *
 * **解析顺序**：envelope → unified message → legacy `{ text }` JSON → plain fallback。
 *
 * **关键导出**：`parseTransportPayload`
 */

import { parseEnvelopeAny } from "../core/envelope.js";
import { parseMessageAny } from "../core/message.js";
import type { ParsedTransportPayload, PayloadParseMode } from "../core/types.js";

/** 重新导出解析结果与模式类型 / Re-export parse types */
export type { ParsedTransportPayload, PayloadParseMode } from "../core/types.js";

/**
 * 解析原始载荷为文本与可选 UnifiedMessage / Parse raw transport payload.
 *
 * @param rawPayload - 原始字符串（JSON 或 plain text）
 * @param mode - 解析模式，默认 jsonTextOrPlain
 * @returns 解析结果，含 text、unified、路由元数据
 */
export function parseTransportPayload(
  rawPayload: string,
  mode: PayloadParseMode = "jsonTextOrPlain",
): ParsedTransportPayload {
  if (mode === "plain") {
    return { text: rawPayload, unified: null };
  }

  // 1. 优先 version=1 信封
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

  // 2. Legacy UnifiedMessage JSON
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

  // 3. Legacy `{ text: "..." }` JSON
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
    // 4. 最终 fallback：整段当作 plain text
  }

  return { text: rawPayload, unified: null };
}

/** @deprecated 使用 parseTransportPayload */
export function parseInboundText(rawPayload: string, mode: PayloadParseMode): string {
  return parseTransportPayload(rawPayload, mode).text;
}
