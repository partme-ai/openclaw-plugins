/**
 * Redis Channel 路由模块。
 *
 * 将 Redis Pub/Sub channel 映射到 OpenClaw Agent：
 * - 显式绑定优先（channelBindings）
 * - 标准格式回退：openclaw:agent:<agentId>:in / openclaw:agent:<agentId>:out
 *
 * 参考 openclaw-mqtt topic-router.ts 模式。
 */

import type { RedisChannelBinding, RedisInboundRoute } from "../types.js";

/** 标准 channel 前缀 */
const AGENT_INBOUND_PREFIX = "openclaw:agent:";
const AGENT_INBOUND_SUFFIX = ":in";

/** 已加载的绑定规则 */
let loadedBindings: RedisChannelBinding[] = [];

/**
 * 解析入站 channel → agent 路由。
 * 显式绑定优先，标准格式回退。
 */
export function resolveInboundRoute(
  channel: string,
  bindings?: RedisChannelBinding[],
): RedisInboundRoute | null {
  const effectiveBindings = bindings ?? loadedBindings;

  // 1. 显式绑定优先
  for (const binding of effectiveBindings) {
    if (matchChannel(channel, binding.channelPattern)) {
      return {
        agentId: binding.agentId,
        accountId: binding.accountId ?? "default",
        replyChannel: binding.replyChannel,
        matchedPattern: binding.channelPattern,
        source: "binding",
      };
    }
  }

  // 2. 标准格式回退：openclaw:agent:<agentId>:in
  if (
    channel.startsWith(AGENT_INBOUND_PREFIX) &&
    channel.endsWith(AGENT_INBOUND_SUFFIX)
  ) {
    const agentId = channel.slice(
      AGENT_INBOUND_PREFIX.length,
      channel.length - AGENT_INBOUND_SUFFIX.length,
    );
    if (agentId && !agentId.includes(":")) {
      return {
        agentId,
        accountId: "default",
        replyChannel: buildReplyChannelFromInbound(channel),
        matchedPattern: "openclaw:agent:<agentId>:in",
        source: "standard",
      };
    }
  }

  return null;
}

/**
 * 从入站 channel 推导默认回复 channel。
 */
export function buildReplyChannelFromInbound(inboundChannel: string): string {
  if (inboundChannel.endsWith(":in")) {
    return inboundChannel.slice(0, -3) + ":out";
  }
  return inboundChannel + ":out";
}

/**
 * 构建 Agent 默认出站 channel。
 */
export function buildOutboundChannel(agentId: string): string {
  return `openclaw:agent:${agentId}:out`;
}

/**
 * 加载显式 channel 绑定规则。
 */
export function loadChannelBindings(bindings: RedisChannelBinding[]): void {
  loadedBindings = bindings.map((b) => ({
    channelPattern: b.channelPattern,
    agentId: b.agentId,
    accountId: b.accountId ?? "default",
    replyChannel: b.replyChannel,
  }));
}

/**
 * 获取已加载的绑定规则（只读）。
 */
export function getLoadedChannelBindings(): ReadonlyArray<RedisChannelBinding> {
  return loadedBindings;
}

/**
 * Redis glob 风格 channel 匹配。
 * 支持 * 通配符（匹配单级或多级，基于冒号分隔）。
 */
export function matchChannel(channel: string, pattern: string): boolean {
  if (pattern === "*") return true;

  const channelParts = channel.split(":");
  const patternParts = pattern.split(":");

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];

    // * 匹配剩余所有级别
    if (pp === "*") return true;

    // 精确匹配
    if (i >= channelParts.length || pp !== channelParts[i]) {
      return false;
    }
  }

  return channelParts.length === patternParts.length;
}
