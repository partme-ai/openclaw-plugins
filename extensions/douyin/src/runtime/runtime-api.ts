/**
 * Douyin 插件 message-sdk 薄 barrel（re-export）。
 *
 * **架构角色**：隔离 `@partme.ai/openclaw-message-sdk` 依赖，inbound 与 runtime
 * 仅从此模块导入 Webhook 读取、幂等缓存、Transcript 派发与 HTTP API。
 */

export {
  createIdempotencyCache,
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
  dispatchTranscriptTurn,
  parseMediaDirectives,
  resolveOutboundMedia,
  isHttpUrl,
  undiciFetch,
  readResponseBodyAsBuffer,
  withTimeout,
  AsyncTimeoutError,
  buildAgentReplyTimeoutSummary,
  resolveChannelMediaMaxBytes,
  resolveChannelAgentReplyTimeoutMs,
  resolveChannelEgressProxyUrl,
  type IdempotencyCache,
  type TranscriptChannelRuntime,
  type ChannelLimitsOpenClawConfig,
  type UndiciFetchOptions,
} from "@partme.ai/openclaw-message-sdk";

export {
  normalizeWireIngress,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";

export { AsyncTimeoutError as TimeoutError } from "@partme.ai/openclaw-message-sdk";
