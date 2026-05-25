/**
 * UnifiedMessage construction, parsing, and ID helpers.
 */

import type { BuildMessageParams, MessageContentType, UnifiedMessage } from "./types.js";

/**
 * Generate trace id (timestamp + random).
 */
export function generateTraceId(): string {
  const ts = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `${ts}-${r}`;
}

/**
 * Generate message id with optional channel prefix.
 */
export function generateMessageId(channel?: string): string {
  const prefix = channel ? `${channel}-` : "";
  const ts = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}${ts}-${r}`;
}

/**
 * Generate correlation id for request/reply pairing.
 */
export function generateCorrelationId(prefix = "corr"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Parse UnifiedMessage from JSON string with validation.
 */
export function parseMessage(input: string): UnifiedMessage | null {
  try {
    const obj = JSON.parse(input) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return null;
    const source = obj.source as UnifiedMessage["source"] | undefined;
    if (typeof obj.messageId !== "string" || !source?.channel) return null;
    if (typeof obj.text !== "string") return null;
    return obj as unknown as UnifiedMessage;
  } catch {
    return null;
  }
}

/**
 * Parse UnifiedMessage from string, Buffer, Uint8Array, or object.
 */
export function parseMessageAny(input: string | Buffer | Uint8Array | unknown): UnifiedMessage | null {
  if (typeof input === "string") return parseMessage(input);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) {
    return parseMessage(input.toString("utf-8"));
  }
  if (input instanceof Uint8Array) {
    return parseMessage(new TextDecoder().decode(input));
  }
  if (typeof input === "object" && input !== null) {
    const o = input as Record<string, unknown>;
    if (o.message && typeof o.message === "object") {
      return o.message as UnifiedMessage;
    }
    return input as UnifiedMessage;
  }
  return null;
}

/**
 * Build a UnifiedMessage from params.
 */
export function buildMessage(params: BuildMessageParams): UnifiedMessage {
  const hasMedia = (params.media?.length ?? 0) > 0;
  const hasText = Boolean(params.text);
  const hasMarkdown = Boolean(params.markdown);

  let contentType: MessageContentType = "text";
  if (hasMedia && (hasText || hasMarkdown)) contentType = "mixed";
  else if (hasMarkdown) contentType = "markdown";

  return {
    messageId: generateMessageId(params.channel),
    traceId: generateTraceId(),
    timestamp: Date.now(),
    source: {
      channel: params.channel,
      accountId: params.accountId,
      userId: params.userId,
      chatType: params.chatType ?? "direct",
      ...(params.agentId ? { agentId: params.agentId } : {}),
    },
    contentType,
    text: params.text ?? "",
    markdown: params.markdown,
    media: params.media ?? [],
    replyToMessageId: params.replyToMessageId,
    metadata: params.metadata,
    direction: params.direction ?? "inbound",
  };
}

/**
 * Serialize UnifiedMessage to JSON string.
 */
export function serializeMessage(msg: UnifiedMessage): string {
  return JSON.stringify(msg);
}
