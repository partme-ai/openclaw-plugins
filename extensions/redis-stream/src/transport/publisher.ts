/**
 * 共享 Redis publish 操作，打破 redis-stream-server ↔ inbound 之间的循环依赖。
 */

import type { RedisClientType } from "redis";
import { RedisConnectionError } from "../errors.js";

let client: RedisClientType | null = null;
let _messagesWritten = 0;

/** 由 redis-stream-server 在连接建立后注入。 */
export function setPublisherClient(c: RedisClientType): void {
  client = c;
}

/** 重置（断开连接时调用）。 */
export function clearPublisherClient(): void {
  client = null;
}

/** 获取当前 publish 计数。 */
export function getMessagesWritten(): number {
  return _messagesWritten;
}

/** 累加 publish 计数。 */
export function incrMessagesWritten(n?: number): void {
  _messagesWritten += n ?? 1;
}

/** 发布消息到 Redis channel。 */
export async function publishMessage(channel: string, message: string): Promise<void> {
  if (!client) {
    throw new RedisConnectionError("unknown", "Redis client is not initialized");
  }
  await client.publish(channel, message);
  _messagesWritten++;
}

/** 向 stream 追加一条消息。 */
export async function publishEntry(stream: string, values: Record<string, string>): Promise<string> {
  if (!client) {
    throw new RedisConnectionError("unknown", "Redis client is not initialized");
  }
  const id = await client.xAdd(stream, "*", values);
  _messagesWritten++;
  return String(id);
}
