/**
 * @module message-sdk/transport/acl-engine
 *
 * 统一 ACL 评估引擎 — 按 user 的 ACL 规则判断动作是否允许。
 *
 * mqtt 和 web-mqtt 各自实现了 `isUserActionAllowed()` + `evaluateAclRules()`，
 * 逻辑结构一致，收敛到此处。
 */

import { matchTopic } from "./topic-matcher.js";

// ──────────────────── 类型 ────────────────────

/** 通用 ACL 规则 */
export interface AclRule {
  /** 动作类型 */
  action: string;
  /** topic 通配符 pattern */
  topicPattern: string;
  /** 允许或拒绝 */
  effect: "allow" | "deny";
  /** 账号维度过滤（可选） */
  accountId?: string;
}

/** 通用 ACL 用户（兼容新旧配置格式） */
export interface AclUser {
  /** 新格式：ACL 规则列表 */
  aclRules?: AclRule[];
  /** 旧格式：发布白名单 */
  publishAllow?: string[];
  /** 旧格式：订阅白名单 */
  subscribeAllow?: string[];
}

/** ACL 动作类型（可扩展） */
export type AclAction = "publish" | "subscribe" | "inbound" | "outbound";

// ──────────────────── 核心 ────────────────────

/**
 * 按用户 ACL 规则判断动作是否允许。
 *
 * 评估逻辑：
 * 1. 有 `aclRules` → 按 deny 优先、allow 其次评估
 * 2. 否则走旧格式 `publishAllow` / `subscribeAllow`
 * 3. 无规则时默认拒绝（安全优先）
 *
 * @param params.user - ACL 用户
 * @param params.action - 动作类型
 * @param params.topic - 目标 topic
 * @param params.accountId - 可选账号 id（多账号 ACL 过滤）
 * @returns 是否允许
 */
export function isUserActionAllowed(params: {
  user: AclUser | undefined;
  action: AclAction;
  topic: string;
  accountId?: string;
}): boolean {
  const { user, action, topic, accountId } = params;
  if (!user) return false;

  const rules = user.aclRules;
  if (Array.isArray(rules) && rules.length > 0) {
    return evaluateAclRules(rules, action, topic, accountId);
  }

  // 兼容旧配置 — 保持安全一致性，默认拒绝
  if (action === "publish" || action === "inbound") {
    if (!user.publishAllow || user.publishAllow.length === 0) return false;
    return user.publishAllow.some((p) => matchTopic(topic, p));
  }
  if (action === "subscribe" || action === "outbound") {
    if (!user.subscribeAllow || user.subscribeAllow.length === 0) return false;
    return user.subscribeAllow.some((p) => matchTopic(topic, p));
  }

  return false;
}

/**
 * 按 ACL 规则列表评估权限。
 *
 * - deny 优先：匹配到 deny 直接返回 false
 * - 有 allow 匹配返回 true
 * - 无该 action 的规则 → 默认拒绝（安全优先）
 */
function evaluateAclRules(
  rules: AclRule[],
  action: string,
  topic: string,
  accountId?: string,
): boolean {
  let hasAllowMatch = false;

  for (const rule of rules) {
    if (rule.action !== action) continue;
    // 账号限定规则只能在调用方明确提供同一 accountId 时命中。
    // 缺少账号上下文不能被当作“任意账号”，否则会绕过多租户隔离边界。
    if (rule.accountId !== undefined && rule.accountId !== accountId) continue;
    if (!matchTopic(topic, rule.topicPattern)) continue;
    if (rule.effect === "deny") return false;
    hasAllowMatch = true;
  }

  // 如果没有任何该 action 的规则，默认拒绝（安全优先）
  const hasActionRules = rules.some((r) => r.action === action);
  if (!hasActionRules) return false;
  return hasAllowMatch;
}
