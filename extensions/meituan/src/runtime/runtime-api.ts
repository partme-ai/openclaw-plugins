/**
 * Meituan 插件 message-sdk 薄 barrel（re-export）。
 *
 * **架构角色**：统一 Webhook 读 body、幂等缓存、Transcript 派发、HTTP 与配置解析 API 的导入路径。
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

/** 历史兼容：Agent 派发超时错误别名 */
export { AsyncTimeoutError as TimeoutError } from "@partme.ai/openclaw-message-sdk";
