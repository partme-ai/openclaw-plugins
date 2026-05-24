/**
 * @fileoverview RocketMQ 主题路由：显式 binding 与标准 Topic 命名规范。
 *
 * @description
 * 支持 `topicBindings` 精确匹配与 `{prefix}.agent.<agentId>.in[.<peerId>]` 标准格式回退；
 * 提供通配符 `matchTopic`、出站 Topic 构造及入站 reply Topic 推导。
 *
 * Topic 规范：
 * - {topicPrefix}.agent.<agentId>.in[.<peerId>]  -- 入站
 * - {topicPrefix}.agent.<agentId>.out[.<peerId>] -- 出站
 *
 * @module routing/topic-router
 */

/**
 * RocketMQ 主题路由 — Base Profile 入口。
 */

import type { RockermqConfig, TopicBinding } from "../config.js";

/** @description 入站路由解析结果（binding 或 standard 来源）。 */
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
 * @description 解析标准命名 Topic（`{prefix}.agent.<id>.in|out[.<peer>]`）。
 * @param topic - 完整 Topic 名。
 * @param topicPrefix - 配置中的 topic 前缀。
 * @returns 解析出的 agentId、方向与 peerId，或 `null`。
 * @throws 不抛出。
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
 * @description 根据 Topic 与 Tag 解析入站 Agent/Account/peer 路由。
 * @param topic - 入站 Topic。
 * @param tag - 可选 Tag 过滤。
 * @param config - RocketMQ 配置（含 topicBindings）。
 * @param peerIdHint - 可选 peer 提示（binding 未指定 peerId 时使用）。
 * @returns 路由结果，无匹配时 `null`。
 * @throws 不抛出。
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
 * @description 基于入站 Topic 推导默认 reply 出站 Topic（`.in` → `.out`）。
 * @param inboundTopic - 入站 Topic。
 * @param _topicPrefix - 保留参数（标准格式下由 inboundTopic 自身携带前缀）。
 * @returns reply Topic 名。
 * @throws 不抛出。
 */
export function buildReplyTopicFromInbound(inboundTopic: string, _topicPrefix: string): string {
  return inboundTopic.endsWith(".in") ? `${inboundTopic.slice(0, -3)}.out` : `${inboundTopic}.out`;
}

/**
 * @description 构建标准出站 Topic（`{prefix}.agent.<agentId>.out[.<peerId>]`）。
 * @param agentId - 目标 Agent ID。
 * @param topicPrefix - Topic 前缀。
 * @param peerId - 可选 peer 后缀。
 * @returns 出站 Topic 名。
 * @throws 不抛出。
 */
export function buildOutboundTopic(agentId: string, topicPrefix: string, peerId?: string): string {
  const prefix = topicPrefix ? `${topicPrefix}.` : "";
  return peerId ? `${prefix}agent.${agentId}.out.${peerId}` : `${prefix}agent.${agentId}.out`;
}

/**
 * @description RabbitMQ 风格 Topic 通配符匹配（`*` 单级、`#` 多级）。
 * @param topic - 实际 Topic。
 * @param pattern - 订阅或 binding 模式。
 * @returns 是否匹配。
 * @throws 不抛出。
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
 * @description 判断显式 topicBindings 项是否命中当前 topic+tag。
 * @param binding - 绑定配置。
 * @param topic - 实际 Topic。
 * @param tag - 可选 Tag。
 * @returns 是否命中。
 * @throws 不抛出。
 */
function matchBinding(binding: TopicBinding, topic: string, tag?: string): boolean {
  const tagFilter = binding.tag || "*";
  return binding.topic === topic && (tagFilter === "*" || tagFilter === (tag ?? ""));
}

/**
 * @description 从 Topic 路径后缀派生 peerId（标准格式第 4 段起）。
 * @param topic - 完整 Topic。
 * @returns peer 标识或原 topic。
 * @throws 不抛出。
 */
function derivePeerId(topic: string): string {
  const parts = topic.split(".");
  return parts.length > 3 ? parts.slice(3).join(".") : topic;
}

/**
 * @description 将 Topic 路径分隔符 `/` 归一化为 `.` 以便通配符比较。
 * @param topic - 原始 Topic。
 * @returns 归一化后的 Topic 字符串。
 * @throws 不抛出。
 */
function normalizeTopic(topic: string): string {
  return topic.replaceAll("/", ".");
}
