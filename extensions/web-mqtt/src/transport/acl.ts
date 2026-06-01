/**
 * ACL 评估模块 — 委托 message-sdk/transport 共享引擎。
 * 支持 publish/subscribe/inbound/outbound 四类动作与 account 粒度控制。
 */

import {
  isUserActionAllowed as isUserActionAllowedShared,
  matchTopic,
  type AclAction,
} from "@partme.ai/openclaw-message-sdk/transport";

import type { WebMqttAclRule, WebMqttUser } from "../types.js";

export { matchTopic };

/**
 * 基于用户与动作判断是否允许。
 */
export function isUserActionAllowed(params: {
  user: WebMqttUser;
  action: "publish" | "subscribe" | "inbound" | "outbound";
  topic: string;
  accountId?: string;
}): boolean {
  return isUserActionAllowedShared({
    user: params.user as import("@partme.ai/openclaw-message-sdk/transport").AclUser,
    action: params.action as AclAction,
    topic: params.topic,
    accountId: params.accountId,
  });
}
