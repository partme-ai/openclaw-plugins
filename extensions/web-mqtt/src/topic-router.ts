/**
 * Topic 路由模块。
 * 提供 subscribeTopics 白名单、显式 bindings 路由、标准回退路由与通配符匹配。
 */

import type { InboundRoute, WebMqttConfig } from "./types.js";

/**
 * 解析入站消息目标。
 */
export function resolveInboundRoute(topic: string, config: WebMqttConfig): InboundRoute | null {
  if (!isTopicAllowed(topic, config.subscribeTopics)) return null;

  for (const binding of config.topicBindings) {
    if (!matchTopic(topic, binding.topicPattern)) continue;
    return {
      agentId: binding.agentId,
      accountId: binding.accountId ?? "default",
      replyTopic: binding.replyTopic,
      matchedPattern: binding.topicPattern,
      source: "binding",
    };
  }

  const standard = resolveStandardInbound(topic, config.topicPrefix);
  if (!standard) return null;
  return {
    agentId: standard.agentId,
    accountId: "default",
    replyTopic: `${config.topicPrefix}agent/${standard.agentId}/out`,
    matchedPattern: `${config.topicPrefix}agent/<agentId>/in`,
    source: "standard",
  };
}

/**
 * 判断 topic 是否在订阅白名单中。
 */
export function isTopicAllowed(topic: string, subscribeTopics: string[]): boolean {
  if (subscribeTopics.length === 0) return true;
  return subscribeTopics.some((pattern) => matchTopic(topic, pattern));
}

/**
 * MQTT topic 通配符匹配（支持 + 和 #）。
 */
export function matchTopic(topic: string, pattern: string): boolean {
  const topicParts = topic.split("/");
  const patternParts = pattern.split("/");

  for (let i = 0; i < patternParts.length; i += 1) {
    const pp = patternParts[i];
    if (pp === "#") return true;
    if (pp === "+") {
      if (i >= topicParts.length) return false;
      continue;
    }
    if (topicParts[i] !== pp) return false;
  }

  return topicParts.length === patternParts.length;
}

/**
 * 解析标准 topic：<prefix>agent/<agentId>/in
 */
function resolveStandardInbound(topic: string, prefix: string): { agentId: string } | null {
  if (!topic.startsWith(prefix)) return null;
  const tail = topic.slice(prefix.length);
  const parts = tail.split("/");
  if (parts.length !== 3 || parts[0] !== "agent" || parts[2] !== "in") return null;
  const agentId = parts[1];
  if (!agentId) return null;
  return { agentId };
}
