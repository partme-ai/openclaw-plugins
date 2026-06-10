/**
 * @fileoverview Redis Stream/PubSub 传输层。
 *
 * @description
 * 连接管理、Pub/Sub 订阅、Stream 消费组轮询与 XADD/PUBLISH 出站；使用 node-redis v5
 * 高级 API。Publisher 能力委托给 `./publisher` 以打破与 inbound 的循环依赖。
 *
 * @module transport/server
 */

import { createClient, type RedisClientType } from "redis";
import type { RedisChannelConfig, RedisInboundMessage } from "../types.js";
import { handleInboundMessage } from "../inbound.js";
import { loadChannelBindings } from "../routing/topic-router.js";
import { logger } from "../shared/logger.js";
import {
  setPublisherClient,
  clearPublisherClient,
  getMessagesWritten,
} from "./publisher.js";
import {
  RedisConnectionError,
  RedisStreamError,
  RedisTimeoutError,
} from "../shared/errors.js";

/** @description Redis 连接与消息读写统计快照。 */
export type RedisStats = {
  connected: boolean;
  lastConnectAt: number | null;
  lastReadAt: number | null;
  lastError: string | null;
  messagesRead: number;
  messagesWritten: number;
  messagesAcked: number;
  messagesReclaimed: number;
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
  messagesReclaimed: 0,
  subscribedChannels: [],
};

/**
 * @description 统一启动 Redis：连接、可选 consumer group、Pub/Sub 订阅与 Stream 消费循环。
 * @param config - 已解析的 Redis 通道配置
 * @returns 启动完成后 resolve
 * @throws RedisConnectionError 连接失败
 */
export async function startRedisServer(
  config: RedisChannelConfig,
): Promise<void> {
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
            `max reconnection attempts (${config.connection.maxRetries}) exceeded`,
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
      error instanceof Error ? error.message : String(error),
    );
  }
  setPublisherClient(
    client as unknown as Parameters<typeof setPublisherClient>[0],
  );
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
 * @description 停止 Redis：取消订阅并断开主客户端与 publisher 注入。
 * @returns 清理完成后 resolve
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
 * @description 启动 Redis Pub/Sub 订阅（精确 SUBSCRIBE 与模式 PSUBSCRIBE）。
 * @param config - 通道配置（含 subscribeChannels 白名单）
 * @returns 订阅建立后 resolve
 */
async function startPubSub(config: RedisChannelConfig): Promise<void> {
  if (!client) return;

  // 创建独立订阅客户端（Pub/Sub 需专用连接）
  subscriberClient = client.duplicate();
  await subscriberClient.connect();

  const channels = config.subscribeChannels;

  // 空白名单 = 接受全部 channel
  if (channels.length === 0) {
    await subscriberClient.pSubscribe(
      "*",
      (message: string, channel: string) => {
        stats.messagesRead++;
        stats.lastReadAt = Date.now();
        const inbound: RedisInboundMessage = { channel, pattern: "*", message };
        handleInboundMessage(inbound, config).catch((err) => {
          logger.error("Inbound handler error:", err);
        });
      },
    );
    stats.subscribedChannels = ["*"];
    return;
  }

  const patterns = channels.filter((c) => c.includes("*"));
  const exact = channels.filter((c) => !c.includes("*"));

  // 模式订阅（PSUBSCRIBE）
  for (const pattern of patterns) {
    await subscriberClient.pSubscribe(
      pattern,
      (message: string, channel: string) => {
        stats.messagesRead++;
        stats.lastReadAt = Date.now();
        const inbound: RedisInboundMessage = { channel, pattern, message };
        handleInboundMessage(inbound, config).catch((err) => {
          logger.error("Inbound handler error:", err);
        });
      },
    );
  }

  // 精确订阅（SUBSCRIBE）
  if (exact.length > 0) {
    await subscriberClient.subscribe(
      exact,
      (message: string, channel: string) => {
        stats.messagesRead++;
        stats.lastReadAt = Date.now();
        const inbound: RedisInboundMessage = { channel, message };
        handleInboundMessage(inbound, config).catch((err) => {
          logger.error("Inbound handler error:", err);
        });
      },
    );
  }

  stats.subscribedChannels = channels;
}

/**
 * @description 发布消息到 Redis Pub/Sub channel（主客户端路径，更新 server 层统计）。
 * @param channel - 目标 channel 名
 * @param message - 消息体字符串
 * @returns 发布完成后 resolve
 * @throws RedisConnectionError 客户端未初始化
 */
export async function publishMessage(
  channel: string,
  message: string,
): Promise<void> {
  if (!client) {
    throw new RedisConnectionError("", "Redis client is not initialized");
  }
  await client.publish(channel, message);
  stats.messagesWritten++;
}

// ─── Stream 操作 ──────────────────────────────────────────────────

/**
 * @description 向 Stream 追加一条 entry（`XADD`）。
 * @param stream - Stream key
 * @param values - 字段键值对
 * @returns 新 entry ID
 * @throws RedisConnectionError 客户端未初始化
 */
export async function publishEntry(
  stream: string,
  values: Record<string, string>,
): Promise<string> {
  if (!client) {
    throw new RedisConnectionError("", "Redis client is not initialized");
  }
  const id = await client.xAdd(stream, "*", values);
  stats.messagesWritten++;
  return String(id);
}

/**
 * @description 手动确认 Stream 消费（`XACK`）。
 * @param stream - Stream key
 * @param group - Consumer group 名
 * @param id - Entry ID
 * @returns ACK 完成后 resolve
 */
export async function ackEntry(
  stream: string,
  group: string,
  id: string,
): Promise<void> {
  if (!client) {
    throw new RedisConnectionError("", "Redis client is not initialized");
  }
  await client.xAck(stream, group, id);
  stats.messagesAcked++;
}

/**
 * @description 返回连接与读写统计快照（合并 publisher 侧写入计数）。
 * @returns RedisStats 浅拷贝
 */
export function getStats(): RedisStats {
  return {
    ...stats,
    messagesWritten: stats.messagesWritten + getMessagesWritten(),
  };
}

/**
 * @description 保证 inbound Stream 的 consumer group 已存在（`XGROUP CREATE` + MKSTREAM）。
 * @param config - 含 stream.inboundKey 与 consumerGroup 的配置
 * @throws RedisStreamError 创建失败且非 BUSYGROUP
 */
async function ensureConsumerGroup(config: RedisChannelConfig): Promise<void> {
  if (!client) return;
  try {
    await client.xGroupCreate(
      config.stream.inboundKey,
      config.stream.consumerGroup,
      "0",
      {
        MKSTREAM: true,
      },
    );
  } catch (error) {
    throw new RedisStreamError(
      config.stream.inboundKey,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * @description 按 consumer group 阻塞轮询消费（`XREADGROUP`），成功处理后 ACK。
 *
 * node-redis v5 的 xReadGroup 返回已解析结构，无需手写 RESP 解析。
 *
 * @param config - Stream 消费参数（group、blockMs、count、fieldMapping）
 * @returns 在 `running` 为 false 或客户端断开时结束
 */
async function consumeLoop(config: RedisChannelConfig): Promise<void> {
  let consecutiveErrors = 0;
  let pendingClaimCursor = "0-0";
  while (running && client) {
    try {
      if (config.stream.pendingClaimIdleMs > 0) {
        pendingClaimCursor = await reclaimStalePendingEntries(
          config,
          pendingClaimCursor,
        );
      }

      const result = await client
        .xReadGroup(
          config.stream.consumerGroup,
          config.stream.consumerName,
          { key: config.stream.inboundKey, id: ">" },
          { COUNT: config.stream.count, BLOCK: config.stream.blockMs },
        )
        .catch((error) => {
          // Wrap timeout errors
          if (
            error?.message?.includes("timeout") ||
            error?.message?.includes("TIMEDOUT")
          ) {
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
          const fieldMap = toFieldMap(
            fields as unknown as Array<unknown> | Record<string, unknown>,
          );

          const text = fieldMap.get(config.fieldMapping.textField) ?? "";
          const channel = streamName;

          const inbound: RedisInboundMessage = {
            channel,
            message: text,
            streamEntryId: id,
            fieldAgentId:
              fieldMap.get(config.fieldMapping.agentIdField) || undefined,
            fieldPeerId:
              fieldMap.get(config.fieldMapping.peerIdField) || undefined,
            fieldAccountId:
              fieldMap.get(config.fieldMapping.accountIdField) || undefined,
            fieldReplyStream:
              fieldMap.get(config.fieldMapping.replyStreamField) || undefined,
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
      const backoffMs = Math.min(
        1000 * Math.pow(2, Math.min(consecutiveErrors - 1, 5)),
        30000,
      );
      await sleep(backoffMs);
    }
  }
}

/**
 * @description 异步 sleep（消费循环错误退避）。
 * @param ms - 等待毫秒数
 * @returns 延迟结束的 Promise
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @description 将 node-redis RESP2 平铺数组或 v5 纯对象转为字段 Map。
 * @param fields - XREADGROUP 返回的 message 字段
 * @returns 字符串键值 Map
 */
function toFieldMap(
  fields: Array<unknown> | Record<string, unknown>,
): Map<string, string> {
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

/**
 * @description 回收 idle 超过阈值的 PEL 条目（XAUTOCLAIM），供崩溃/重启后重试。
 * @param config - Stream 消费配置
 * @param startId - 上次 claim 游标
 * @returns 下次 claim 起始 ID
 */
async function reclaimStalePendingEntries(
  config: RedisChannelConfig,
  startId: string,
): Promise<string> {
  if (!client || config.stream.pendingClaimIdleMs <= 0) {
    return startId;
  }

  try {
    const claimResult = await client.xAutoClaim(
      config.stream.inboundKey,
      config.stream.consumerGroup,
      config.stream.consumerName,
      config.stream.pendingClaimIdleMs,
      startId,
      { COUNT: config.stream.count },
    );

    const nextStartId = String(claimResult.nextId ?? startId);
    const claimed = claimResult.messages ?? [];

    for (const entry of claimed) {
      if (!entry) continue;
      stats.messagesReclaimed++;
      stats.messagesRead++;
      stats.lastReadAt = Date.now();

      const fieldMap = toFieldMap(
        entry.message as unknown as Array<unknown> | Record<string, unknown>,
      );
      const text = fieldMap.get(config.fieldMapping.textField) ?? "";
      const inbound: RedisInboundMessage = {
        channel: config.stream.inboundKey,
        message: text,
        streamEntryId: String(entry.id),
        fieldAgentId:
          fieldMap.get(config.fieldMapping.agentIdField) || undefined,
        fieldPeerId:
          fieldMap.get(config.fieldMapping.peerIdField) || undefined,
        fieldAccountId:
          fieldMap.get(config.fieldMapping.accountIdField) || undefined,
        fieldReplyStream:
          fieldMap.get(config.fieldMapping.replyStreamField) || undefined,
      };
      const accepted = await handleInboundMessage(inbound, config);
      if (accepted !== false) {
        await ackEntry(
          config.stream.inboundKey,
          config.stream.consumerGroup,
          String(entry.id),
        );
      }
    }

    return nextStartId;
  } catch (error) {
    logger.warn(
      "XAUTOCLAIM pending reclaim failed:",
      error instanceof Error ? error.message : String(error),
    );
    return startId;
  }
}
