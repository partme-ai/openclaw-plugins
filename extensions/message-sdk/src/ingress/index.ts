/**
 * @module ingress
 *
 * 入站（ingress）模块 barrel export。
 *
 * **职责**：聚合消息 SDK 入站链路所需的归一化、策略校验、Wire 解析、命令授权等能力，
 * 供 WeCom / Feishu 等 IM 插件按需 import。
 *
 * **子模块概览**：
 * - `normalize` — 插件字段 → UnifiedMessage
 * - `wire-ingress` — 传输层载荷解析 + 幂等短路
 * - `policy` — 可组合 policy hooks 链
 * - `group-policy` / `dm-policy` — 群聊 / 私聊访问控制
 * - `command-auth` — slash command 授权解析
 * - `active-reply-store` — response_url 主动回复地址存储
 *
 * **上下游**：
 * - 上游：渠道 Webhook / WebSocket adapter
 * - 下游：dispatch pipeline、OpenClaw pairing / commands runtime
 */

export {
  normalizeIngress,
  type NormalizeIngressParams,
} from "./normalize.js";

export {
  parseTransportPayload,
  parseInboundText,
  type ParsedTransportPayload,
  type PayloadParseMode,
} from "../pipeline/parse-payload.js";

export {
  normalizeWireIngress,
  type WireIngressParams,
  type WireIngressResult,
} from "./wire-ingress.js";

export {
  createDeferredDeliveryAck,
  type CreateDeferredDeliveryAckOptions,
  type IngressDeliveryControls,
} from "./deferred-delivery-ack.js";

export {
  runIngressPolicyChain,
  createAllowlistIngressHook,
  type IngressPolicyContext,
  type IngressPolicyDecision,
  type IngressPolicyHook,
} from "./policy.js";

export {
  ActiveReplyStore,
  ACTIVE_REPLY_LIMITS,
  type ActiveReplyState,
} from "./active-reply-store.js";

export {
  checkChannelGroupPolicy,
  isSenderInAllowlist,
  resolveChannelGroupConfig,
  type ChannelGroupConfig,
  type ChannelGroupPolicyConfig,
  type GroupPolicyCheckResult,
  type GroupPolicyMode,
} from "./group-policy.js";

export {
  checkChannelDmPolicy,
  type DmPolicyCheckResult,
  type DmPolicyMode,
  type ReadPairingAllowFrom,
  type SendPairingReply,
  type UpsertPairingRequest,
} from "./dm-policy.js";

export {
  createAllowFromNormalizer,
  isSenderInAllowFrom,
  resolveCommandAuthorization,
  type CommandAuthAccountConfig,
  type CommandAuthResult,
  type CreateAllowFromNormalizerOptions,
  type DmPolicy,
} from "./command-auth.js";
