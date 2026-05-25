/**
 * @fileoverview Redis 入站消息处理编排入口。
 *
 * @description
 * channel 白名单过滤、显式/标准/字段路由、幂等去重，并通过 message-sdk
 * `dispatchChannelMessage` 分发至 OpenClaw reply 管线；sessionKey 由宿主解析。
 *
 * @module inbound
 */

import { getRedisStreamRuntime } from "./runtime.js";
import {
  resolveInboundRoute,
  matchChannel,
  buildReplyChannelFromInbound,
} from "./routing/topic-router.js";
import { publishMessage } from "./transport/publisher.js";
import { logger } from "./shared/logger.js";
import type { RedisChannelConfig, RedisInboundMessage } from "./types.js";
import {
  normalizeWireIngress,
  dispatchChannelMessage,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";
import {
  getRedisStreamIdempotencyCache,
  mapRedisStreamWirePayloadMode,
} from "./shared/wire-helpers.js";

const idempotencyCache = getRedisStreamIdempotencyCache();

/**
 * @description 处理 Redis channel 入站消息（Pub/Sub 或 Stream 消费回调）。
 * @param message - 规范化后的入站消息
 * @param config - 通道配置
 * @returns true 表示可 ACK；false 时 Stream 模式保留在 pending list
 */
export async function handleInboundMessage(
  message: RedisInboundMessage,
  config: RedisChannelConfig,
): Promise<boolean> {
  // 路由用真实 channel，pattern 仅用于日志/展示
  const channel = message.channel;

  // 0. 跳过已知出站/回复 channel，避免自循环
  if (isOutboundChannel(message.channel)) {
    return true;
  }

  // 1. 白名单过滤
  if (!shouldProcessChannel(channel, config.subscribeChannels)) {
    return true; // 非匹配 channel 不算失败，消息可以 ACK
  }

  // 2. Deduplication check (use stream entry ID if available, fallback to content hash)
  const messageId =
    message.streamEntryId ??
    `${channel}:${message.message.slice(0, 100)}`;

  // 2. 路由解析（显式绑定优先，Stream fieldAgentId 字段覆盖）
  let route = message.fieldAgentId
    ? {
        agentId: message.fieldAgentId,
        accountId: message.fieldAccountId ?? "default",
        replyChannel: message.fieldReplyStream,
        matchedPattern: "fieldMapping.agentIdField",
        source: "field" as const,
      }
    : resolveInboundRoute(channel, config.channelBindings);
  if (!route) {
    if (config.defaultAgentId) {
      route = {
        agentId: config.defaultAgentId,
        accountId: "default",
        matchedPattern: "defaultAgentId",
        source: "field" as const,
      };
    } else {
      logger.warn(`No route matched for channel: ${channel}`);
      return true;
    }
  }

  // 3. payload 解析
  const parsed = normalizeWireIngress({
    rawPayload: message.message,
    mode: mapRedisStreamWirePayloadMode(config.payload.mode),
    channel: "redis-stream",
    idempotencyKey: messageId,
    idempotency: idempotencyCache,
  });
  if (!parsed.accepted) {
    logger.info(`Duplicate message skipped: ${messageId.slice(0, 50)}...`);
    return true;
  }
  const text = parsed.text;

  // 4. 回复 channel 推导（fieldReplyStream 优先 > binding replyChannel > 标准格式）
  const replyChannel =
    message.fieldReplyStream ??
    route.replyChannel ??
    buildReplyChannelFromInbound(channel);

  // 5. peerId 使用 channel 名称（可通过 fieldPeerId 覆盖）
  const peerId = message.fieldPeerId ?? channel;

  // 6. 分发到 OpenClaw Runtime
  const rt = getRedisStreamRuntime();
  if (!rt) {
    logger.warn("Runtime not initialized, cannot dispatch message");
    return false;
  }

  try {
    logger.info(
      `Inbound: channel=${channel}, agent=${route.agentId}, ` +
        `account=${route.accountId}, source=${route.source}, ` +
        `text=${text.slice(0, 100)}`,
    );

    const { agentId, sessionKey } = await resolveChannelDispatchIdentity(
      rt as unknown as BridgePluginRuntime,
      {
        channel: "redis-stream",
        accountId: route.accountId,
        peerId,
        agentId: route.agentId,
      },
    );

    await dispatchChannelMessage({
      mode: "reply-pipeline",
      runtime: rt as unknown as BridgePluginRuntime,
      channel: "redis-stream",
      accountId: route.accountId,
      peerId,
      text,
      agentId,
      sessionKey,
      unified: parsed.unified,
      extra: {
        channel,
        matchedPattern: route.matchedPattern,
        routeSource: route.source,
      },
      reply: {
        deliver: async ({ wire }) => {
          await publishMessage(replyChannel, wire);
        },
        outboundFormat: "envelope",
        replyRoute: { topic: replyChannel },
        agentId,
      },
    });

    return true;
  } catch (error) {
    logger.error(`Runtime dispatch failed for channel=${channel}:`, error);
    return false;
  }
}

/**
 * @description 检查 channel 是否在 `subscribeChannels` 白名单内；空白名单接受全部。
 * @param channel - 实际 Redis channel 名
 * @param subscribeChannels - 订阅模式列表（支持 * 通配符）
 * @returns 是否应继续处理
 */
function shouldProcessChannel(
  channel: string,
  subscribeChannels: string[],
): boolean {
  if (!subscribeChannels.length) {
    return true;
  }
  return subscribeChannels.some((pattern) => matchChannel(channel, pattern));
}

/**
 * @description 跳过已知出站/回复 channel，避免 Agent 回复触发自循环消费。
 * @param channel - Redis channel 名
 * @returns 是否为出站 channel
 */
function isOutboundChannel(channel: string): boolean {
  if (channel.endsWith(":out")) return true;
  if (channel === "openclaw:agent:outbound") return true;
  return false;
}
