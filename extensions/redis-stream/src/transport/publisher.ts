/**
 * @fileoverview 共享 Redis 发布模块。
 *
 * @description
 * 打破 server ↔ inbound 循环依赖：由 `transport/server` 在连接建立后注入 client，
 * inbound/outbound 通过本模块发布 Pub/Sub 与 Stream 消息。
 *
 * @module transport/publisher
 */

import type { RedisClientType } from "redis";
import { RedisConnectionError } from "../shared/errors.js";

let client: RedisClientType | null = null;
let _messagesWritten = 0;

/**
 * @description 由 transport/server 在连接建立后注入 Redis 客户端。
 * @param c - 已连接的 RedisClientType 实例
 */
export function setPublisherClient(c: RedisClientType): void {
  client = c;
}

/**
 * @description 重置 publisher 客户端引用（断开连接时调用）。
 */
export function clearPublisherClient(): void {
  client = null;
}

/**
 * @description 获取 publisher 模块累计写入消息数。
 * @returns 写入计数
 */
export function getMessagesWritten(): number {
  return _messagesWritten;
}

/**
 * @description 累加 publish 写入计数（供 server 层合并统计）。
 * @param n - 增量，默认 1
 */
export function incrMessagesWritten(n?: number): void {
  _messagesWritten += n ?? 1;
}

/**
 * @description 发布消息到 Redis Pub/Sub channel。
 * @param channel - 目标 channel
 * @param message - 消息体
 * @returns 发布完成后 resolve
 * @throws RedisConnectionError 客户端未注入
 */
export async function publishMessage(
  channel: string,
  message: string,
): Promise<void> {
  if (!client) {
    throw new RedisConnectionError(
      "unknown",
      "Redis client is not initialized",
    );
  }
  await client.publish(channel, message);
  _messagesWritten++;
}

/**
 * @description 向 Stream 追加一条 entry（`XADD`）。
 * @param stream - Stream key
 * @param values - 字段键值对
 * @returns 新 entry ID 字符串
 * @throws RedisConnectionError 客户端未注入
 */
export async function publishEntry(
  stream: string,
  values: Record<string, string>,
): Promise<string> {
  if (!client) {
    throw new RedisConnectionError(
      "unknown",
      "Redis client is not initialized",
    );
  }
  const id = await client.xAdd(stream, "*", values);
  _messagesWritten++;
  return String(id);
}
