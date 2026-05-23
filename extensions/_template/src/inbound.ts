/**
 * 入站处理：去重、解析、投递前校验。
 */

import type { ParsedInboundMessage } from "./types.js";

const processedMessages = new Map<string, number>();
const MESSAGE_DEDUP_TTL_MS = 60_000;
const MESSAGE_DEDUP_MAX_ENTRIES = 10_000;

function pruneDedupeCache(now: number): void {
  for (const [key, ts] of processedMessages) {
    if (now - ts > MESSAGE_DEDUP_TTL_MS) {
      processedMessages.delete(key);
    }
  }
  while (processedMessages.size > MESSAGE_DEDUP_MAX_ENTRIES) {
    const oldest = processedMessages.keys().next().value;
    if (typeof oldest === "string") processedMessages.delete(oldest);
  }
}

/**
 * 基于 messageId 的 TTL 去重。
 */
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

/** 测试或重启时清空去重缓存。 */
export function clearDedupeCache(): void {
  processedMessages.clear();
}

/**
 * 将平台原始 payload 解析为内部入站模型。
 */
export function parseInboundMessage(_raw: unknown): ParsedInboundMessage | null {
  return null;
}
