/**
 * Douyin 插件 message-sdk 薄 barrel。
 */

export {
  createIdempotencyCache,
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
  type IdempotencyCache,
} from "@partme.ai/openclaw-message-sdk";

export {
  normalizeWireIngress,
  createChannelDispatch,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";
