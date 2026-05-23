/**
 * @module bridge
 *
 * OpenClaw 桥接层 — 统一入站 dispatch 与出站 deliver。
 *
 * **职责**：
 * - 保留 `dispatchInbound` / `createReplyHandler` 作为 Wire 核心
 * - re-export Wire dispatch facade、channel dispatch、parse/ingress 工具
 *
 * **适用场景**：MQ 插件、bridge 插件、message-sdk 包主入口 re-export。
 */

export {
  dispatchInbound,
  toInboundUnifiedMessage,
  type DispatchInboundParams,
  type DispatchInboundResult,
} from "./inbound-bridge.js";

export { createReplyHandler, type ReplyBridgeResult } from "./reply-bridge.js";

export {
  dispatchWireMessage,
  type WireDispatchOptions,
} from "../dispatch/wire-dispatch.js";

export {
  dispatchChannelMessage,
  dispatchEmbeddedAgentMessage,
  dispatchSubagentMessage,
  type ChannelDispatchMode,
  type ChannelDispatchParams,
  type ChannelDispatchResult,
} from "../dispatch/index.js";

export {
  CHANNEL_CLASS_WIRE,
  CHANNEL_CLASS_TRANSCRIPT,
  type ChannelClass,
} from "../core/channel-class.js";

/** 重新导出 Wire dispatch 类型别名 / Re-export wire dispatch type aliases */
export type { WireDispatchConfig, WireDispatchParams, WireDispatchResult } from "../dispatch/types.js";

export { parseTransportPayload, type ParsedTransportPayload, type PayloadParseMode } from "../pipeline/parse-payload.js";

export {
  normalizeWireIngress,
  type WireIngressParams,
  type WireIngressResult,
} from "../ingress/wire-ingress.js";

export {
  resolveChannelAgentRoute,
  resolveChannelDispatchIdentity,
  type ChannelAgentRoute,
  type ResolveChannelAgentRouteParams,
} from "./resolve-channel-route.js";

/** 重新导出桥接层公共类型 / Re-export bridge public types */
export type {
  BridgePluginRuntime,
  InboundBridgeParams,
  ReplyBridgeParams,
} from "./types.js";
