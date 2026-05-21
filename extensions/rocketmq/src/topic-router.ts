/**
 * RocketMQ 主题路由。
 * 支持显式 topic+tag 绑定与标准 Topic 格式回退。
 *
 * Topic 规范：
 * - {topicPrefix}.agent.<agentId>.in[.<peerId>]  -- 入站
 * - {topicPrefix}.agent.<agentId>.out[.<peerId>] -- 出站
 */

import type { RockermqConfig, TopicBinding } from "./rocketmq-config.js";

export type RockermqInboundRoute = {
  agentId: string;
  accountId: string;
  peerId: string;
  replyTopic?: string;
  replyTag?: string;
  source: "binding" | "standard";
  matchedTopic?: string;
};

/**
 * 解析标准 Topic。
 */
export function parseStandardTopic(
  topic: string,
  topicPrefix: string,
): { agentId: string; direction: "in" | "out"; peerId: string } | null {
  const prefix = topicPrefix ? `${topicPrefix}.` : "";
  if (!topic.startsWith(prefix)) {
    return null;
  }
  const parts = topic.slice(prefix.length).split(".");
  if (parts.length < 3 || parts[0] !== "agent") {
    return null;
  }
  const direction = parts[2];
  if (direction !== "in" && direction !== "out") {
    return null;
  }
  return {
    agentId: parts[1],
    direction,
    peerId: parts.slice(3).join("."),
  };
}

/**
 * 根据 Topic 与 Tag 解析入站目标。
 */
export function resolveInboundRoute(
  topic: string,
  tag: string | undefined,
  config: RockermqConfig,
  peerIdHint?: string,
): RockermqInboundRoute | null {
  for (const binding of config.topicBindings) {
    if (matchBinding(binding, topic, tag)) {
      return {
        agentId: binding.agentId,
        accountId: binding.accountId,
        peerId: binding.peerId ?? peerIdHint ?? derivePeerId(topic),
        replyTopic: binding.replyTopic,
        replyTag: binding.replyTag,
        source: "binding",
        matchedTopic: binding.topic,
      };
    }
  }

  const parsed = parseStandardTopic(topic, config.topicPrefix);
  if (parsed?.direction === "in") {
    return {
      agentId: parsed.agentId,
      accountId: "default",
      peerId: peerIdHint ?? parsed.peerId ?? "",
      replyTopic: buildReplyTopicFromInbound(topic, config.topicPrefix),
      source: "standard",
      matchedTopic: topic,
    };
  }
  return null;
}

/**
 * 基于入站 Topic 推导出站 Topic。
 */
export function buildReplyTopicFromInbound(inboundTopic: string, _topicPrefix: string): string {
  return inboundTopic.endsWith(".in") ? `${inboundTopic.slice(0, -3)}.out` : `${inboundTopic}.out`;
}

/**
 * 构建标准出站 Topic。
 */
export function buildOutboundTopic(agentId: string, topicPrefix: string, peerId?: string): string {
  const prefix = topicPrefix ? `${topicPrefix}.` : "";
  return peerId ? `${prefix}agent.${agentId}.out.${peerId}` : `${prefix}agent.${agentId}.out`;
}

/**
 * RabbitMQ-style Topic 通配符匹配。
 * 支持 * (单级) 和 # (多级) 通配符，主要用于 subscribeTopics 过滤。
 *
 * @param topic - 实际 Topic
 * @param pattern - 匹配模式
 */
export function matchTopic(topic: string, pattern: string): boolean {
  const topicParts = normalizeTopic(topic).split(".");
  const patternParts = normalizeTopic(pattern).split(".");

  let topicIndex = 0;
  let patternIndex = 0;

  while (patternIndex < patternParts.length) {
    const pp = patternParts[patternIndex];

    if (pp === "#") {
      return true;
    }

    if (topicIndex >= topicParts.length) {
      return false;
    }

    if (pp === "*" || pp === "+") {
      topicIndex++;
      patternIndex++;
      continue;
    }

    if (pp !== topicParts[topicIndex]) {
      return false;
    }

    topicIndex++;
    patternIndex++;
  }

  return topicIndex === topicParts.length;
}

/**
 * 判断显式绑定是否命中。
 */
function matchBinding(binding: TopicBinding, topic: string, tag?: string): boolean {
  const tagFilter = binding.tag || "*";
  return binding.topic === topic && (tagFilter === "*" || tagFilter === (tag ?? ""));
}

/**
 * 从 Topic 派生 peerId。
 */
function derivePeerId(topic: string): string {
  const parts = topic.split(".");
  return parts.length > 3 ? parts.slice(3).join(".") : topic;
}

function normalizeTopic(topic: string): string {
  return topic.replaceAll("/", ".");
}
