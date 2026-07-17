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
import { publishEntry, publishMessage } from "./transport/publisher.js";
import { logger } from "./shared/logger.js";
import type { RedisChannelConfig, RedisInboundMessage } from "./types.js";
import {
  normalizeWireIngress,
  dispatchChannelMessage,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";
import {
  getRedisStreamClaimableDedupe,
  mapRedisStreamWirePayloadMode,
} from "./shared/wire-helpers.js";
import { redactRedisError } from "./shared/redact.js";

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

  // Pub/Sub has no stable delivery ID; only Stream entries participate in dedupe.
  const messageId = message.streamEntryId
    ? `${channel}:${message.streamEntryId}`
    : undefined;

  // 3. 路由解析（显式绑定优先，Stream fieldAgentId 字段覆盖）
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

  // Runtime must exist before claiming the delivery.
  const rt = getRedisStreamRuntime();
  if (!rt) {
    logger.warn("Runtime not initialized, cannot dispatch message");
    return false;
  }

  // Parse payload without eagerly recording idempotency.
  const parsed = normalizeWireIngress({
    rawPayload: message.message,
    mode: mapRedisStreamWirePayloadMode(config.payload.mode),
    channel: "redis-stream",
  });
  const text = parsed.text;

  // 6. 回复 channel 推导（fieldReplyStream 优先 > binding replyChannel > 标准格式）
  const replyChannel =
    message.fieldReplyStream ??
    route.replyChannel ??
    buildReplyChannelFromInbound(channel);

  // 7. peerId 使用 channel 名称（可通过 fieldPeerId 覆盖）
  const peerId = message.fieldPeerId ?? channel;

  const dedupe = getRedisStreamClaimableDedupe(config.idempotency);
  const claim = dedupe && messageId ? await dedupe.claim(messageId) : undefined;
  if (claim && (claim.kind === "duplicate" || claim.kind === "inflight")) {
    logger.info(`Duplicate message skipped: ${messageId?.slice(0, 80)}`);
    return true;
  }

  // 8. 分发到 OpenClaw Runtime
  try {
    logger.info(
      `Inbound: channel=${channel}, agent=${route.agentId}, ` +
        `account=${route.accountId}, source=${route.source}, ` +
        `bytes=${Buffer.byteLength(text, "utf8")}`,
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
      timeoutMs: config.network.agentReplyTimeoutMs,
      extra: {
        channel,
        matchedPattern: route.matchedPattern,
        routeSource: route.source,
      },
      reply: {
        deliver: async ({ wire }) => {
          if (config.channelMode === "stream") {
            await publishEntry(replyChannel, {
              [config.fieldMapping.textField]: wire,
              agentId,
              peerId,
              accountId: route.accountId,
            });
          } else {
            // Redis Pub/Sub 没有离线积压：PUBLISH 返回 0 就意味着本次回复已永久丢失，
            // 因此不能向 OpenClaw 回报“发送成功”，让上层按失败策略处理。
            const subscriberCount = await publishMessage(replyChannel, wire);
            if (subscriberCount === 0) {
              throw new Error(
                `[openclaw-redis-stream] No active subscriber for reply channel: ${replyChannel}`,
              );
            }
          }
        },
        outboundFormat: "envelope",
        replyRoute: { topic: replyChannel },
        agentId,
      },
    });

    if (dedupe && messageId && claim?.kind === "claimed") {
      await dedupe.commit(messageId);
    }

    return true;
  } catch (error) {
    if (dedupe && messageId && claim?.kind === "claimed") {
      dedupe.release(messageId);
    }
    logger.error(`Runtime dispatch failed for channel=${channel}: ${redactRedisError(error, config)}`);
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
