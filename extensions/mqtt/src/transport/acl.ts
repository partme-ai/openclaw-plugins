/**
 * @module mqtt/transport/acl
 *
 * MQTT 细粒度 ACL 判断 — 委托 message-sdk/transport 共享引擎。
 */

import {
  matchTopic,
  isUserActionAllowed as isUserActionAllowedShared,
  type AclAction,
} from "@partme.ai/openclaw-message-sdk/transport";

import type { MqttAclRule, MqttUser } from "../types.js";

/**
 * MQTT topic 通配符匹配（支持 `+` 单级与 `#` 多级）。
 *
 * @param topic - 实际 topic
 * @param pattern - ACL 模式（可含 +/#）
 * @returns 是否匹配
 */
export function aclTopicMatches(topic: string, pattern: string): boolean {
  return matchTopic(topic, pattern);
}

/**
 * 按用户 ACL 规则判断动作是否允许。
 *
 * @param params.user - MQTT 用户（含 ACL 规则）
 * @param params.action - ACL 动作类型
 * @param params.topic - 目标 topic
 * @param params.accountId - 可选账号 id（多账号 ACL 过滤）
 * @returns 是否允许
 */
export function isUserActionAllowed(params: {
  user: MqttUser | undefined;
  action: MqttAclRule["action"];
  topic: string;
  accountId?: string;
}): boolean {
  return isUserActionAllowedShared({
    user: params.user as import("@partme.ai/openclaw-message-sdk/transport").AclUser | undefined,
    action: params.action as AclAction,
    topic: params.topic,
    accountId: params.accountId,
  });
}
