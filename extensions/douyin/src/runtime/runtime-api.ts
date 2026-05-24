/**
 * Douyin 插件 message-sdk 薄 barrel（re-export）。
 *
 * **架构角色**：隔离 `@partme.ai/openclaw-message-sdk` 依赖，inbound 与 runtime
 * 仅从此模块导入 Webhook 读取、幂等缓存与 bridge 派发 API。
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
