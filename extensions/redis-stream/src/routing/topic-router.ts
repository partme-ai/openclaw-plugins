/**
 * @fileoverview Redis Channel 路由模块。
 *
 * @description
 * 将 Redis Pub/Sub channel 映射到 OpenClaw Agent：显式 `channelBindings` 优先，
 * 标准格式 `openclaw:agent:<agentId>:in` 回退。参考 openclaw-mqtt topic-router 模式。
 *
 * @module routing/topic-router
 */

import type { RedisChannelBinding, RedisInboundRoute } from "../types.js";

/** 标准 channel 前缀 */
const AGENT_INBOUND_PREFIX = "openclaw:agent:";
const AGENT_INBOUND_SUFFIX = ":in";

/** 已加载的绑定规则 */
let loadedBindings: RedisChannelBinding[] = [];

/**
 * @description 解析入站 channel → agent 路由（显式绑定优先，标准格式回退）。
 * @param channel - 实际 Redis channel 名
 * @param bindings - 可选绑定列表；缺省时使用模块内已加载规则
 * @returns 路由结果；null 表示无匹配
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
 * @description 从入站 channel 推导默认回复 channel（`:in` → `:out`）。
 * @param inboundChannel - 入站 channel 名
 * @returns 回复 channel 名
 */
export function buildReplyChannelFromInbound(inboundChannel: string): string {
  if (inboundChannel.endsWith(":in")) {
    return inboundChannel.slice(0, -3) + ":out";
  }
  return inboundChannel + ":out";
}

/**
 * @description 构建 Agent 默认出站 channel（`openclaw:agent:<agentId>:out`）。
 * @param agentId - Agent ID
 * @returns 出站 channel 名
 */
export function buildOutboundChannel(agentId: string): string {
  return `openclaw:agent:${agentId}:out`;
}

/**
 * @description 加载显式 channel 绑定规则到模块级缓存（gateway 启动时调用）。
 * @param bindings - 来自配置的绑定数组
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
 * @description 获取已加载的绑定规则（只读快照）。
 * @returns 绑定规则只读数组
 */
export function getLoadedChannelBindings(): ReadonlyArray<RedisChannelBinding> {
  return loadedBindings;
}

/**
 * @description Redis glob 风格 channel 匹配（冒号分隔，* 匹配剩余级别）。
 * @param channel - 实际 channel 名
 * @param pattern - 匹配模式
 * @returns 是否匹配
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
