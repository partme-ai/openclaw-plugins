/**
 * OpenClaw 桥接层 — 统一入站 dispatch 与出站 deliver。
 * 向后兼容：保留 dispatchInbound / createReplyHandler，并 re-export Wire dispatch facade。
 */

export {
  dispatchInbound,
  toInboundUnifiedMessage,
  type DispatchInboundParams,
  type DispatchInboundResult,
} from "./inbound-bridge.js";

export { createReplyHandler, type ReplyBridgeResult } from "./reply-bridge.js";

export { createWireDispatch, type CreateWireDispatchOptions } from "../dispatch/wire-dispatch.js";

export {
  createChannelDispatch,
  createEmbeddedAgentDispatch,
  createSubagentDispatch,
  type ChannelDispatchMode,
  type ChannelDispatchParams,
  type ChannelDispatchResult,
} from "../dispatch/index.js";

export {
  CHANNEL_CLASS_WIRE,
  CHANNEL_CLASS_TRANSCRIPT,
  type ChannelClass,
} from "../core/channel-class.js";

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

export type {
  BridgePluginRuntime,
  InboundBridgeParams,
  ReplyBridgeParams,
} from "./types.js";
