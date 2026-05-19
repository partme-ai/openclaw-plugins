/**
 * 入站消息处理：channel 过滤、路由、调用 OpenClaw reply 管线。
 *
 * 参考 feishu inbound.ts 模式 — sessionKey 由 OpenClaw 核心 resolveAgentRoute 返回，
 * 插件不自行拼接会话键。
 */

import { getRedisStreamRuntime } from "./runtime.js";
import { resolveInboundRoute, matchChannel, buildReplyChannelFromInbound } from "./topic-router.js";
import { publishMessage } from "./publisher.js";
import { logger } from "./logger.js";
import type { RedisChannelConfig, RedisInboundMessage } from "./types.js";

/**
 * 处理 Redis channel 入站消息。
 * 返回 false 时消息不应被 ACK（Stream 模式使用）。
 */
export async function handleInboundMessage(message: RedisInboundMessage, config: RedisChannelConfig): Promise<boolean> {
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
  const text = parseInboundText(message.message, config.payload.mode);

  // 4. 回复 channel 推导（fieldReplyStream 优先 > binding replyChannel > 标准格式）
  const replyChannel = message.fieldReplyStream ?? route.replyChannel ?? buildReplyChannelFromInbound(channel);

  // 5. peerId 使用 channel 名称（可通过 fieldPeerId 覆盖）
  const peerId = message.fieldPeerId ?? channel;

  // 6. 分发到 OpenClaw Runtime
  const rt = getRedisStreamRuntime();
  if (!rt) {
    logger.warn("Runtime not initialized, cannot dispatch message");
    return false;
  }

  try {
    // resolveAgentRoute 由 OpenClaw 核心返回 sessionKey（与飞书完全一致）
    const replyOptions = await rt.channel.routing.resolveAgentRoute({
      cfg: rt.config,
      channel: "redis-stream",
      accountId: route.accountId,
      peer: { kind: "direct", id: peerId },
    });
    const sessionKey: string = replyOptions.sessionKey;

    logger.info(
      `Inbound: channel=${channel}, agent=${route.agentId}, ` +
        `account=${route.accountId}, source=${route.source}, session=${sessionKey}, ` +
        `text=${text.slice(0, 100)}`,
    );

    const ctx = await rt.channel.reply.finalizeInboundContext({
      channel: "redis-stream",
      accountId: route.accountId,
      from: peerId,
      text,
      chatType: "direct",
      extra: {
        channel,
        matchedPattern: route.matchedPattern,
        routeSource: route.source,
      },
    });

    const dispatcher = rt.channel.reply.createReplyDispatcherWithTyping({
      deliver: async (payload: { text: string }) => {
        await publishMessage(replyChannel, payload.text);
      },
    });

    await rt.channel.reply.dispatchReplyFromConfig({
      ctx,
      cfg: rt.config,
      dispatcher,
      replyOptions,
    });

    return true;
  } catch (error) {
    logger.error(`Runtime dispatch failed for channel=${channel}:`, error);
    return false;
  }
}

/**
 * 检查 channel 是否在订阅白名单中。
 */
function shouldProcessChannel(channel: string, subscribeChannels: string[]): boolean {
  if (!subscribeChannels.length) {
    return true;
  }
  return subscribeChannels.some((pattern) => matchChannel(channel, pattern));
}

/** 跳过已知出站/回复 channel，避免自循环覆盖。 */
function isOutboundChannel(channel: string): boolean {
  if (channel.endsWith(":out")) return true;
  if (channel === "openclaw:agent:outbound") return true;
  return false;
}

/**
 * 解析入站消息 payload 为纯文本。
 */
function parseInboundText(rawPayload: string, mode: RedisChannelConfig["payload"]["mode"]): string {
  if (mode !== "jsonTextOrPlain") {
    return rawPayload;
  }

  try {
    const parsed = JSON.parse(rawPayload) as { text?: unknown };
    if (typeof parsed.text === "string" && parsed.text.trim().length > 0) {
      return parsed.text;
    }
  } catch {
    // ignore parse error and fallback to plain text
  }
  return rawPayload;
}
