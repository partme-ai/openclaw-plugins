/**
 * Topic 路由模块。
 * 提供 subscribeTopics 白名单、显式 bindings 路由、标准回退路由。
 * 通配符匹配委托 message-sdk/transport。
 */

import { matchTopic, isTopicAllowed } from "@partme.ai/openclaw-message-sdk/transport";

export { matchTopic, isTopicAllowed };

import type { InboundRoute, WebMqttConfig } from "../types.js";

/**
 * 解析入站 MQTT topic 到 Agent 路由（binding 优先，其次标准 `<prefix>agent/<id>/in`）。
 *
 * @param topic - 入站 MQTT topic
 * @param config - Web MQTT 通道配置
 * @returns InboundRoute；不在白名单或不可路由时 null
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
