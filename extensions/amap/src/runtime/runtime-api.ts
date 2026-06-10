/**
 * Amap 插件 message-sdk 薄 barrel（Runtime API Re-export）
 *
 * **架构角色**：统一 re-export `@partme.ai/openclaw-message-sdk` 能力，
 * 避免插件内各模块直接依赖 message-sdk 子路径，便于版本升级与 mock。
 *
 * **关键依赖**：
 * - `@partme.ai/openclaw-message-sdk` — 请求体读取、幂等缓存
 * - `@partme.ai/openclaw-message-sdk/bridge` — 入站解析与 reply-pipeline 派发
 */

/** Webhook 请求体读取、体积限制与幂等缓存工厂。 */
export {
  createIdempotencyCache,
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
  type IdempotencyCache,
} from "@partme.ai/openclaw-message-sdk";

/** 入站 wire 解析、Channel 派发与 Agent 路由解析。 */
export {
  normalizeWireIngress,
  dispatchChannelMessage,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";
