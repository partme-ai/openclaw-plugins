/**
 * WeCom 运行时 API 聚合层（runtime-api）
 *
 * 薄 barrel：将 message-sdk 与 openclaw plugin-sdk 的跨通道能力集中 re-export，
 * 供 wecom 插件内 webhook、出站、去重、SSRF 防护等模块单一入口引用。
 *
 * message-sdk（@partme.ai/openclaw-message-sdk）：
 * - 入站：readRequestBodyWithLimit、createPersistentDedupe
 * - 出站：preprocessOutboundReply、resolveSendableOutboundReplyParts、parseMediaDirectives 等
 *
 * openclaw plugin-sdk：
 * - 通道回复管线 createChannelMessageReplyPipeline
 * - SSRF：fetchWithSsrFGuard
 * - 安全读写：readRegularFile、safeEqualSecret
 *
 * 企微专有协议（XML/JSON 加解密、@wecom/aibot-node-sdk）不在此文件，见 agent/、webhook/。
 */

export {
  createPersistentDedupe,
  createIdempotencyCache,
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
  preprocessOutboundReply,
  createTypingLifecycleHooks,
  extractLocalImagePathsFromText,
  extractLocalFilePathsFromText,
  resolveOutboundMedia,
  isImageContentType,
  parseMediaDirectives,
  maskThinkingBlocks,
  restoreThinkingBlocks,
  resolveSendableOutboundReplyParts,
  resolveTextChunksWithFallback,
  formatErrorMessage,
  type PersistentDedupe,
  type IdempotencyCache,
  type PreprocessOutboundReplyParams,
  type PreprocessedOutboundReply,
  type TypingLifecycleCallbacks,
  type TypingLifecycleHooks,
  type ResolvedOutboundMedia,
  type ParseMediaDirectivesResult,
} from "@partme.ai/openclaw-message-sdk";

export type {
  OpenClawConfig,
  OpenClawPluginApi,
  PluginRuntime,
  ReplyPayload,
  OutboundIdentity,
} from "openclaw/plugin-sdk/core";
export type { RuntimeEnv } from "openclaw/plugin-sdk/runtime";
export { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
export {
  requestBodyErrorToText,
} from "openclaw/plugin-sdk/webhook-ingress";
export { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";
export {
  createChannelMessageReplyPipeline,
  createReplyPrefixContext,
} from "openclaw/plugin-sdk/channel-message";
export { sendMediaWithLeadingCaption } from "openclaw/plugin-sdk/reply-payload";
export { formatReasoningMessage } from "openclaw/plugin-sdk/agent-runtime";
export { stripReasoningTagsFromText } from "openclaw/plugin-sdk/text-chunking";
export type {
  GetReplyOptions,
  ReplyDispatcherWithTypingOptions,
} from "openclaw/plugin-sdk/reply-runtime";
export {
  readRegularFile,
  statRegularFileSync,
  writeExternalFileWithinRoot,
  safeEqualSecret,
} from "openclaw/plugin-sdk/security-runtime";
export { PAIRING_APPROVED_MESSAGE } from "openclaw/plugin-sdk/channel-status";
