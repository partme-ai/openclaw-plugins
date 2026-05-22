/**
 * ACL 评估模块。
 * 支持 publish/subscribe/inbound/outbound 四类动作与 account 粒度控制。
 */

import type { WebMqttAclRule, WebMqttUser } from "../types.js";
import { matchTopic } from "../routing/topic-router.js";

/**
 * 基于用户与动作判断是否允许。
 */
export function isUserActionAllowed(params: {
  user: WebMqttUser;
  action: "publish" | "subscribe" | "inbound" | "outbound";
  topic: string;
  accountId?: string;
}): boolean {
  const rules = params.user.aclRules ?? [];
  if (rules.length > 0) {
    return evaluateAclRules(rules, params.action, params.topic, params.accountId);
  }

  if (params.action === "publish" || params.action === "inbound") {
    if (!params.user.publishAllow || params.user.publishAllow.length === 0) return true;
    return params.user.publishAllow.some((pattern) => matchTopic(params.topic, pattern));
  }
  if (!params.user.subscribeAllow || params.user.subscribeAllow.length === 0) return true;
  return params.user.subscribeAllow.some((pattern) => matchTopic(params.topic, pattern));
}

function evaluateAclRules(
  rules: WebMqttAclRule[],
  action: "publish" | "subscribe" | "inbound" | "outbound",
  topic: string,
  accountId?: string,
): boolean {
  let hasAllowMatch = false;

  for (const rule of rules) {
    if (rule.action !== action) continue;
    if (rule.accountId && accountId && rule.accountId !== accountId) continue;
    if (!matchTopic(topic, rule.topicPattern)) continue;
    if (rule.effect === "deny") return false;
    hasAllowMatch = true;
  }

  const hasActionRules = rules.some((rule) => rule.action === action);
  if (!hasActionRules) return true;
  return hasAllowMatch;
}
