/**
 * MQTT 细粒度 ACL 判断。
 */

import type { MqttAclRule, MqttUser } from "./types.js";

/**
 * MQTT topic 匹配（支持 + / #）。
 */
export function aclTopicMatches(topic: string, pattern: string): boolean {
  const topicParts = topic.split("/");
  const patternParts = pattern.split("/");
  for (let i = 0; i < patternParts.length; i += 1) {
    const p = patternParts[i];
    const t = topicParts[i];
    if (p === "#") return true;
    if (p === "+") {
      if (t === undefined) return false;
      continue;
    }
    if (p !== t) return false;
  }
  return topicParts.length === patternParts.length;
}

/**
 * 按用户 ACL 决策某动作是否允许。
 */
export function isUserActionAllowed(params: {
  user: MqttUser | undefined;
  action: MqttAclRule["action"];
  topic: string;
  accountId?: string;
}): boolean {
  const { user, action, topic, accountId } = params;
  if (!user) return false;

  const rules = user.aclRules;
  if (Array.isArray(rules) && rules.length > 0) {
    const matched = rules.filter((rule) => {
      if (rule.action !== action) return false;
      if (rule.accountId && accountId && rule.accountId !== accountId) return false;
      return aclTopicMatches(topic, rule.topicPattern);
    });
    const deny = matched.some((rule) => rule.effect === "deny");
    if (deny) return false;
    const allow = matched.some((rule) => rule.effect === "allow");
    return allow;
  }

  // 兼容旧配置
  if (action === "publish") {
    if (!user.publishAllow || user.publishAllow.length === 0) return true;
    return user.publishAllow.some((pattern) => aclTopicMatches(topic, pattern));
  }
  if (action === "subscribe") {
    if (!user.subscribeAllow || user.subscribeAllow.length === 0) return true;
    return user.subscribeAllow.some((pattern) => aclTopicMatches(topic, pattern));
  }

  // inbound/outbound 默认允许（无规则时）
  return true;
}

