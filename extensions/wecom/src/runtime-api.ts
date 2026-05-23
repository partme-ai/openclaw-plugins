/**
 * WeCom 插件薄 barrel：message-sdk 公共能力 + OpenClaw plugin-sdk 通道抽象。
 * 企微收发仍走 @wecom/aibot-node-sdk + Agent HTTP；此处仅共享出站/入站工具与 OpenClaw 抽象。
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
