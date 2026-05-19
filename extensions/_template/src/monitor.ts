/**
 * Monitor / message processing for TEMPLATE_NAME channel.
 *
 * Responsibilities:
 * - Inbound message deduplication (TTL-based, size-capped)
 * - Message parsing and validation
 * - Dispatch to OpenClaw agent
 * - Webhook HTTP handler
 *
 * Message dedup pattern borrowed from openclaw-china's dingtalk stream handler.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { CHANNEL_ID } from "./config.js";

// ============================================================================
// Message deduplication (TTL-based, size-capped)
// ============================================================================

const processedMessages = new Map<string, number>();
const MESSAGE_DEDUP_TTL_MS = 60_000;   // 60 second TTL
const MESSAGE_DEDUP_MAX_ENTRIES = 10_000;

function pruneDedupeCache(now: number): void {
  // Remove expired entries
  for (const [key, ts] of processedMessages) {
    if (now - ts > MESSAGE_DEDUP_TTL_MS) {
      processedMessages.delete(key);
    }
  }
  // LRU eviction if over capacity
  while (processedMessages.size > MESSAGE_DEDUP_MAX_ENTRIES) {
    const oldest = processedMessages.keys().next().value;
    if (typeof oldest === "string") processedMessages.delete(oldest);
  }
}

export function isDuplicateMessage(messageId: string): boolean {
  const now = Date.now();
  if (!messageId) return false;
  const prev = processedMessages.get(messageId);
  if (typeof prev === "number" && now - prev < MESSAGE_DEDUP_TTL_MS) {
    return true;
  }
  processedMessages.set(messageId, now);
  pruneDedupeCache(now);
  return false;
}

export function clearDedupeCache(): void {
  processedMessages.clear();
}

// ============================================================================
// Webhook HTTP handler
// ============================================================================

export async function handleWebhookRequest(
  _req: IncomingMessage,
  _res: ServerResponse,
): Promise<boolean> {
  // TODO: Implement channel-specific webhook handling
  // 1. Verify signature / decrypt body
  // 2. Parse message
  // 3. Check dedup → isDuplicateMessage()
  // 4. Dispatch to OpenClaw via getRuntime().channel.processInbound()
  // 5. Return HTTP 200
  return false;
}

// ============================================================================
// Message parsing
// ============================================================================

export interface ParsedInboundMessage {
  messageId?: string;
  senderId: string;
  chatId: string;
  chatType: "direct" | "group";
  contentType: "text" | "image" | "voice" | "video" | "file" | "mixed";
  text?: string;
  mediaUrl?: string;
  timestamp: number;
}

/**
 * Parse a raw inbound message into a normalized format.
 * Override this per channel to match the platform's message format.
 */
export function parseInboundMessage(_raw: unknown): ParsedInboundMessage | null {
  // Default: no parsing. Override per channel.
  return null;
}
