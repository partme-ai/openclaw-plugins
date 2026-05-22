/**
 * @partme.ai/openclaw-message-sdk — 统一消息格式 SDK + 公共工具库
 *
 * - 统一消息类型、信封、入站/出站队列
 * - 传输层 parse/serialize 管线
 * - OpenClaw 桥接（子路径 bridge）
 * - 媒体 / HTTP / ASR / OCR / TTS 工具
 */

export * from "./core/index.js";

export {
  importOpenClawPluginSdk,
} from "./openclaw/index.js";

export {
  normalizeIngress,
  type NormalizeIngressParams,
} from "./ingress/index.js";

export {
  dispatchWireMessage,
  dispatchTranscriptTurn,
  dispatchChannelMessage,
  dispatchEmbeddedAgentMessage,
  dispatchSubagentMessage,
  CHANNEL_CLASS_WIRE,
  CHANNEL_CLASS_TRANSCRIPT,
  isWireChannelClass,
  isTranscriptChannelClass,
  type ChannelClass,
  type ChannelDispatchMode,
  type ChannelDispatchParams,
  type ChannelDispatchResult,
  type ChannelDispatchDeliverParams,
  type ChannelDispatchReplyConfig,
  type EmbeddedAgentRuntime,
  type SubagentRuntime,
  type WireDispatchConfig,
  type TranscriptDispatchConfig,
  type DispatchConfig,
  type WireDispatchParams,
  type WireDispatchResult,
  type TranscriptChannelRuntime,
  type TranscriptDispatchParams,
  type TranscriptRecordParams,
  type WireDispatchOptions,
} from "./dispatch/index.js";

export {
  createReplyDispatcherBundle,
  preprocessOutboundReply,
  maskThinkingBlocks,
  restoreThinkingBlocks,
  type CreateReplyDispatcherBundleParams,
  type ReplyDispatcherBundle,
  type ReplyDispatcherOptions,
  type PreprocessOutboundReplyParams,
  type PreprocessedOutboundReply,
} from "./reply/index.js";

export {
  createTypingLifecycleHooks,
  type TypingLifecycleCallbacks,
  type TypingLifecycleHooks,
} from "./lifecycle/index.js";

export {
  parseTransportPayload,
  parseInboundText,
  type ParsedTransportPayload,
  type PayloadParseMode,
} from "./pipeline/parse-payload.js";

export {
  serializeForTransport,
  wrapTextPayload,
  type SerializeOutboundParams,
  type OutboundWireFormat,
} from "./pipeline/serialize-payload.js";

export { createIdempotencyCache, type IdempotencyCache, type IdempotencyCacheOptions } from "./dedup/idempotency-cache.js";

export {
  createPersistentDedupe,
  createLocalPersistentDedupeSync,
  type PersistentDedupe,
  type PersistentDedupeOptions,
  type PersistentDedupeCheckOptions,
} from "./dedup/persistent-dedupe.js";

export {
  createClaimableDedupe,
  type ClaimableDedupe,
  type ClaimableDedupeClaim,
  type ClaimableDedupeClaimKind,
  type ClaimableDedupeClaimOptions,
  type ClaimableDedupeOptions,
  type ClaimableDedupeReleaseOptions,
} from "./dedup/claimable-dedupe.js";

export { getPathGuard, createLocalPathGuard, type PathGuardApi, type PathGuardReadOptions } from "./media/path-guard.js";

export {
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  RequestBodyLimitError,
  DEFAULT_WEBHOOK_MAX_BODY_BYTES,
  DEFAULT_WEBHOOK_BODY_TIMEOUT_MS,
  type ReadRequestBodyOptions,
} from "./http/body-limit.js";

export { safeFetch, type SafeFetchOptions } from "./http/safe-fetch.js";

export {
  resolveSendableOutboundReplyParts,
  resolveTextChunksWithFallback,
  type OutboundReplyPart,
  type ResolveReplyPartsParams,
} from "./pipeline/reply-parts.js";

export { formatErrorMessage, formatErrorMessageSync } from "./util/format-error.js";

export {
  InboundMessageQueue,
  type InboundPushParams,
  type InboundQueueItem,
  type InboundMessageQueueOptions,
} from "./queue/inbound-message-queue.js";

export {
  OutboundMessageQueue,
  type OutboundQueueItem,
} from "./queue/outbound-message-queue.js";

export {
  createKeyedRunQueue,
  KeyedRunQueueInactiveError,
  type KeyedRunQueue,
  type KeyedRunQueueOptions,
  type KeyedRunQueueTask,
} from "./queue/keyed-run-queue.js";

export {
  createInboundDebounceBuffer,
  type InboundDebounceBuffer,
  type InboundDebounceBufferOptions,
  type InboundDebounceFlush,
  type InboundDebounceFlushReason,
} from "./queue/inbound-debounce-buffer.js";

export {
  METADATA_EXTRAS_KEY,
  METADATA_SOURCE,
  isOutboundEcho,
  markOutboundMetadata,
  mergeMetadata,
  readMetadata,
  resolveMetadataCorrelationId,
  resolveMetadataPeerId,
  resolveMetadataReplyRoute,
  resolveMetadataTraceId,
  type MessageMetadata,
  type MetadataCarrier,
  type NativeExtras,
} from "./metadata/index.js";

export {
  parseMediaDirectives,
  extractLocalImagePathsFromText,
  extractLocalFilePathsFromText,
  resolveOutboundMedia,
  isImageContentType,
  type ParseMediaDirectivesResult,
  type ResolvedOutboundMedia,
} from "./media/index.js";

export {
  extractMediaFromText,
  extractImagesFromText,
  extractFilesFromText,
  isHttpUrl,
  isLocalReference,
  normalizeLocalPath,
  isImagePath,
  isNonImageFilePath,
  getExtension,
  detectMediaTypeFromPath,
  type ExtractedMedia,
  type MediaParseResult,
  type MediaParseOptions,
  type MediaType,
} from "./media/index.js";

export {
  httpPost,
  httpGet,
  withRetry,
  defaultShouldRetry,
  HttpError,
  TimeoutError,
  type HttpRequestOptions,
  type RetryOptions,
} from "./http/index.js";

export {
  transcribeTencentFlash,
  ASRError,
  ASRTimeoutError,
  ASRAuthError,
  ASRRequestError,
  ASRResponseParseError,
  ASRServiceError,
  ASREmptyResultError,
  type TencentFlashASRConfig,
  type ASRErrorKind,
} from "./asr/index.js";

export {
  FileSizeLimitError,
  MediaTimeoutError,
  PathSecurityError,
  fetchMediaFromUrl,
  downloadToTempFile,
  readMedia,
  readMediaBatch,
  finalizeInboundMediaFile,
  pruneInboundMediaDir,
  cleanupFileSafe,
  type MediaReadResult,
  type DownloadToTempFileResult,
} from "./media/media-io.js";

export * from "./file/index.js";
export * from "./ocr/index.js";
export * from "./tts/index.js";
