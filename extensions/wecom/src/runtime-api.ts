/**
 * WeCom 插件 OpenClaw plugin-sdk 薄 barrel（对齐 Feishu runtime-api.ts）。
 * 企微收发仍走 @wecom/aibot-node-sdk + Agent HTTP；此处仅 OpenClaw 通道抽象。
 */

export type {
  OpenClawConfig,
  OpenClawPluginApi,
  PluginRuntime,
  ReplyPayload,
  OutboundIdentity,
} from "openclaw/plugin-sdk/core";
export type { RuntimeEnv } from "openclaw/plugin-sdk/runtime";
export { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
export { createPersistentDedupe, type PersistentDedupe } from "openclaw/plugin-sdk/persistent-dedupe";
export {
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  requestBodyErrorToText,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
} from "openclaw/plugin-sdk/webhook-ingress";
export { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";
export { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
export {
  createChannelMessageReplyPipeline,
  createReplyPrefixContext,
} from "openclaw/plugin-sdk/channel-message";
export {
  resolveSendableOutboundReplyParts,
  resolveTextChunksWithFallback,
  sendMediaWithLeadingCaption,
} from "openclaw/plugin-sdk/reply-payload";
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
