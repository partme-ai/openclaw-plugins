/**
 * @module reply
 *
 * 出站回复预处理、thinking 块占位、dispatcher bundle 与 reply-parts 的 barrel export。
 *
 * **职责**：在 OpenClaw `deliver` 之前统一处理 reasoning 格式化、thinking 占位、
 * markdown 表格转换、MEDIA: 指令解析与 reply-parts 分片。
 *
 * **适用场景**：WeCom / Feishu 等 IM 插件的出站管线，避免各通道重复实现相同预处理链。
 *
 * **关键导出**：
 * - `preprocessOutboundReply` — deliver 前完整预处理链
 * - `maskThinkingBlocks` / `restoreThinkingBlocks` — redacted_thinking 占位与还原
 * - `createReplyDispatcherBundle` — deliver + lifecycle 标准 bundle
 * - `resolveSendableOutboundReplyParts` — 可发送 reply 分片（re-export）
 */

export {
  createReplyDispatcherBundle,
  type CreateReplyDispatcherBundleParams,
  type ReplyDispatcherBundle,
  type ReplyDispatcherOptions,
} from "./bundle.js";

export {
  resolveSendableOutboundReplyParts,
  resolveTextChunksWithFallback,
  type OutboundReplyPart,
  type ResolveReplyPartsParams,
} from "../pipeline/reply-parts.js";

export {
  maskThinkingBlocks,
  restoreThinkingBlocks,
  DEFAULT_THINK_REGEX,
  type MaskThinkingBlocksResult,
} from "./format-thinking-blocks.js";

export {
  preprocessOutboundReply,
  type OutboundReplyPayload,
  type PreprocessOutboundReplyParams,
  type PreprocessedOutboundReply,
} from "./create-dispatcher.js";
