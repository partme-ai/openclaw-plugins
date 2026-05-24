/**
 * Meituan 插件 message-sdk 薄 barrel（re-export）。
 *
 * **架构角色**：统一 Webhook 读 body、幂等缓存与 bridge 派发 API 的导入路径。
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
  dispatchChannelMessage,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";
