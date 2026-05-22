/**
 * Redis 传输层：Stream（消费组） + Pub/Sub（channel 订阅）。
 *
 * 使用 Redis 官方推荐的 Node.js 客户端 node-redis（npm 包 `redis`），
 * 全部使用 node-redis v5 高级 API，零裸 sendCommand。
 */

import { createClient, type RedisClientType } from "redis";
import type { RedisChannelConfig, RedisInboundMessage } from "../types.js";
import { handleInboundMessage } from "../inbound.js";
import { loadChannelBindings } from "../routing/topic-router.js";
import { logger } from "../logger.js";
import { setPublisherClient, clearPublisherClient, getMessagesWritten } from "./publisher.js";
import { RedisConnectionError, RedisStreamError, RedisTimeoutError } from "../errors.js";

export type RedisStats = {
  connected: boolean;
  lastConnectAt: number | null;
  lastReadAt: number | null;
  lastError: string | null;
  messagesRead: number;
  messagesWritten: number;
  messagesAcked: number;
  subscribedChannels: string[];
};

let client: RedisClientType | null = null;
let subscriberClient: RedisClientType | null = null;
let running = false;
const stats: RedisStats = {
  connected: false,
  lastConnectAt: null,
  lastReadAt: null,
  lastError: null,
  messagesRead: 0,
  messagesWritten: 0,
  messagesAcked: 0,
  subscribedChannels: [],
};

/**
 * 统一启动 Redis：连接 + 可选消费组 + Pub/Sub 订阅 + 可选 Stream 消费循环。
 */
export async function startRedisServer(config: RedisChannelConfig): Promise<void> {
  // 加载 channel 绑定
  loadChannelBindings(config.channelBindings ?? []);

  // 主客户端（用于 Stream 操作）
  client = createClient({
    url: config.url,
    socket: {
      reconnectStrategy: (retries: number) => {
        if (retries >= config.connection.maxRetries) {
          throw new RedisConnectionError(
            config.url,
            `max reconnection attempts (${config.connection.maxRetries}) exceeded`
          );
        }
        return config.connection.reconnectMs;
      },
    },
  });

  try {
    await client.connect();
  } catch (error) {
    throw new RedisConnectionError(
      config.url,
      error instanceof Error ? error.message : String(error)
    );
  }
  setPublisherClient(client as unknown as Parameters<typeof setPublisherClient>[0]);
  running = true;
  stats.connected = true;
  stats.lastConnectAt = Date.now();

  // Stream 消费组
  if (config.channelMode === "stream" && config.stream.createGroup) {
    await ensureConsumerGroup(config).catch(() => undefined);
  }

  // Pub/Sub 订阅
  if (config.channelMode === "pubsub") {
    await startPubSub(config);
  }

  // Stream 消费循环（仅在 stream 模式下）
  if (config.channelMode === "stream") {
    consumeLoop(config).catch((err) => {
      logger.error("Consume loop crashed:", err);
    });
  }
}

/**
 * 停止 Redis：取消订阅 + 断开连接。
 */
export async function stopRedisServer(): Promise<void> {
  running = false;

  if (subscriberClient) {
    await subscriberClient.unsubscribe().catch(() => undefined);
    await subscriberClient.pUnsubscribe().catch(() => undefined);
    await subscriberClient.quit().catch(() => undefined);
  }
  subscriberClient = null;

  if (client) {
    await client.quit().catch(() => undefined);
  }
  client = null;
  clearPublisherClient();
  stats.connected = false;
  stats.subscribedChannels = [];
}

// ─── Pub/Sub ──────────────────────────────────────────────────────

/**
 * 启动 Redis Pub/Sub 订阅。
 */
async function startPubSub(config: RedisChannelConfig): Promise<void> {
  if (!client) return;

  // 创建独立订阅客户端（Pub/Sub 需专用连接）
  subscriberClient = client.duplicate();
  await subscriberClient.connect();

  const channels = config.subscribeChannels;

  // 空白名单 = 接受全部 channel
  if (channels.length === 0) {
    await subscriberClient.pSubscribe("*", (message: string, channel: string) => {
      stats.messagesRead++;
      stats.lastReadAt = Date.now();
      const inbound: RedisInboundMessage = { channel, pattern: "*", message };
      handleInboundMessage(inbound, config).catch((err) => {
        logger.error("Inbound handler error:", err);
      });
    });
    stats.subscribedChannels = ["*"];
    return;
  }

  const patterns = channels.filter((c) => c.includes("*"));
  const exact = channels.filter((c) => !c.includes("*"));

  // 模式订阅（PSUBSCRIBE）
  for (const pattern of patterns) {
    await subscriberClient.pSubscribe(pattern, (message: string, channel: string) => {
      stats.messagesRead++;
      stats.lastReadAt = Date.now();
      const inbound: RedisInboundMessage = { channel, pattern, message };
      handleInboundMessage(inbound, config).catch((err) => {
        logger.error("Inbound handler error:", err);
      });
    });
  }

  // 精确订阅（SUBSCRIBE）
  if (exact.length > 0) {
    await subscriberClient.subscribe(exact, (message: string, channel: string) => {
      stats.messagesRead++;
      stats.lastReadAt = Date.now();
      const inbound: RedisInboundMessage = { channel, message };
      handleInboundMessage(inbound, config).catch((err) => {
        logger.error("Inbound handler error:", err);
      });
    });
  }

  stats.subscribedChannels = channels;
}

/**
 * 发布消息到 Redis channel。
 */
export async function publishMessage(channel: string, message: string): Promise<void> {
  if (!client) {
    throw new RedisConnectionError("", "Redis client is not initialized");
  }
  await client.publish(channel, message);
  stats.messagesWritten++;
}

// ─── Stream 操作 ──────────────────────────────────────────────────

/**
 * 向 stream 追加一条消息。
 */
export async function publishEntry(stream: string, values: Record<string, string>): Promise<string> {
  if (!client) {
    throw new RedisConnectionError("", "Redis client is not initialized");
  }
  const id = await client.xAdd(stream, "*", values);
  stats.messagesWritten++;
  return String(id);
}

/**
 * 手动确认消费。
 */
export async function ackEntry(stream: string, group: string, id: string): Promise<void> {
  if (!client) {
    throw new RedisConnectionError("", "Redis client is not initialized");
  }
  await client.xAck(stream, group, id);
  stats.messagesAcked++;
}

/**
 * 读取当前状态。
 */
export function getStats(): RedisStats {
  return { ...stats, messagesWritten: stats.messagesWritten + getMessagesWritten() };
}

/**
 * 保证 consumer group 已存在。
 */
async function ensureConsumerGroup(config: RedisChannelConfig): Promise<void> {
  if (!client) return;
  try {
    await client.xGroupCreate(config.stream.inboundKey, config.stream.consumerGroup, "0", {
      MKSTREAM: true,
    });
  } catch (error) {
    throw new RedisStreamError(
      config.stream.inboundKey,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * 按 consumer group 轮询消费。
 *
 * node-redis v5 的 xReadGroup 返回已解析的 typed 结构：
 *   Array<{ name: string, messages: Array<{ id: string, message: Map<string, string> }> }> | null
 * 因此无需手写 raw reply 解析。
 */
async function consumeLoop(config: RedisChannelConfig): Promise<void> {
  let consecutiveErrors = 0;
  while (running && client) {
    try {
      const result = await client.xReadGroup(
        config.stream.consumerGroup,
        config.stream.consumerName,
        { key: config.stream.inboundKey, id: ">" },
        { COUNT: config.stream.count, BLOCK: config.stream.blockMs },
      ).catch((error) => {
        // Wrap timeout errors
        if (error?.message?.includes("timeout") || error?.message?.includes("TIMEDOUT")) {
          throw new RedisTimeoutError("XREADGROUP", config.stream.blockMs);
        }
        throw error;
      });

      consecutiveErrors = 0;
      if (!result) continue; // 超时无消息，返回 null

      for (const { name: streamName, messages } of result) {
        for (const { id, message: fields } of messages) {
          stats.messagesRead++;
          stats.lastReadAt = Date.now();

          // node-redis v5 解析后 message 为纯对象 { k: v }，同时兼容平铺数组
          const fieldMap = toFieldMap(fields as unknown as Array<unknown> | Record<string, unknown>);

          const text = fieldMap.get(config.fieldMapping.textField) ?? "";
          const channel = streamName;

          const inbound: RedisInboundMessage = {
            channel,
            message: text,
            fieldAgentId: fieldMap.get(config.fieldMapping.agentIdField) || undefined,
            fieldPeerId: fieldMap.get(config.fieldMapping.peerIdField) || undefined,
            fieldAccountId: fieldMap.get(config.fieldMapping.accountIdField) || undefined,
            fieldReplyStream: fieldMap.get(config.fieldMapping.replyStreamField) || undefined,
          };
          const accepted = await handleInboundMessage(inbound, config);

          // 仅在 handler 成功时才 ACK，失败的消息保留在 pending list 供后续重试
          if (accepted !== false) {
            await ackEntry(streamName, config.stream.consumerGroup, id);
          }
        }
      }
    } catch (error) {
      consecutiveErrors++;
      stats.lastError = error instanceof Error ? error.message : String(error);
      // 指数退避，上限 30 秒，避免 Redis 不可用时频繁重试
      const backoffMs = Math.min(1000 * Math.pow(2, Math.min(consecutiveErrors - 1, 5)), 30000);
      await sleep(backoffMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 将 node-redis RESP2 MapReply（平铺数组或纯对象）转为 JS Map。 */
function toFieldMap(fields: Array<unknown> | Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  if (Array.isArray(fields)) {
    // RESP2 原始格式：平铺数组 [k1, v1, k2, v2, ...]
    for (let i = 0; i < fields.length; i += 2) {
      map.set(String(fields[i] ?? ""), String(fields[i + 1] ?? ""));
    }
  } else if (fields && typeof fields === "object") {
    // node-redis v5 解析后的纯对象 { k1: v1, k2: v2 }
    for (const [key, value] of Object.entries(fields)) {
      map.set(key, String(value ?? ""));
    }
  }
  return map;
}
