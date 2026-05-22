/**
 * Shared metadata carried inside channel-native extension fields.
 *
 * Gotify stores it under `extras.openclaw`; MQ/webhook style transports can
 * carry the same shape in headers or JSON envelopes. Keeping this shape in the
 * SDK gives channels one place for echo guards, peer identity, tracing, and
 * cross-channel reply routing.
 */

import type { ReplyRoute } from "../core/types.js";

/**
 * METADATA_EXTRAS_KEY 是 metadata 模块对外共享的常量或默认实现。
 *
 * 修改该值会影响多个通道插件的默认行为，变更前应同步更新相关测试与文档。
 */
export const METADATA_EXTRAS_KEY = "openclaw";
/**
 * METADATA_SOURCE 是 metadata 模块对外共享的常量或默认实现。
 *
 * 修改该值会影响多个通道插件的默认行为，变更前应同步更新相关测试与文档。
 */
export const METADATA_SOURCE = "openclaw";

/**
 * MessageMetadata 描述 metadata 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface MessageMetadata {
  source?: string;
  outbound?: boolean;
  peerId?: string;
  correlationId?: string;
  traceId?: string;
  replyRoute?: ReplyRoute;
  [key: string]: unknown;
}

/**
 * NativeExtras 是 metadata 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type NativeExtras = Record<string, unknown>;

/**
 * MetadataCarrier 是 metadata 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type MetadataCarrier =
  | NativeExtras
  | {
      extras?: NativeExtras | null;
    }
  | null
  | undefined;

/**
 * readMetadata 是 metadata 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function readMetadata(input: MetadataCarrier): MessageMetadata | undefined {
  const extras = resolveExtrasRecord(input);
  const metadata = extras?.[METADATA_EXTRAS_KEY];
  if (!isPlainObject(metadata)) {
    return undefined;
  }
  return metadata as MessageMetadata;
}

/**
 * mergeMetadata 是 metadata 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function mergeMetadata(
  baseExtras?: NativeExtras | null,
  patch: MessageMetadata = {},
): NativeExtras {
  const base = baseExtras ?? {};
  const existing = readMetadata(base) ?? {};
  return {
    ...base,
    [METADATA_EXTRAS_KEY]: {
      ...existing,
      ...patch,
    },
  };
}

/**
 * markOutboundMetadata 是 metadata 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function markOutboundMetadata(baseExtras?: NativeExtras | null): NativeExtras {
  return mergeMetadata(baseExtras, {
    source: METADATA_SOURCE,
    outbound: true,
  });
}

/**
 * isOutboundEcho 是 metadata 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function isOutboundEcho(input: MetadataCarrier): boolean {
  const metadata = readMetadata(input);
  return metadata?.source === METADATA_SOURCE && metadata.outbound === true;
}

/**
 * resolveMetadataPeerId 是 metadata 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function resolveMetadataPeerId(input: MetadataCarrier): string | undefined {
  const peerId = readMetadata(input)?.peerId;
  return typeof peerId === "string" && peerId.trim()
    ? peerId.trim()
    : undefined;
}

/**
 * resolveMetadataCorrelationId 是 metadata 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function resolveMetadataCorrelationId(
  input: MetadataCarrier,
): string | undefined {
  const correlationId = readMetadata(input)?.correlationId;
  return typeof correlationId === "string" && correlationId.trim()
    ? correlationId.trim()
    : undefined;
}

/**
 * resolveMetadataTraceId 是 metadata 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function resolveMetadataTraceId(input: MetadataCarrier): string | undefined {
  const traceId = readMetadata(input)?.traceId;
  return typeof traceId === "string" && traceId.trim()
    ? traceId.trim()
    : undefined;
}

/**
 * resolveMetadataReplyRoute 是 metadata 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function resolveMetadataReplyRoute(
  input: MetadataCarrier,
): ReplyRoute | undefined {
  const replyRoute = readMetadata(input)?.replyRoute;
  if (!isPlainObject(replyRoute)) {
    return undefined;
  }

  const normalized: ReplyRoute = {};
  for (const [key, value] of Object.entries(replyRoute)) {
    if (typeof value === "string" && value.trim()) {
      normalized[key] = value.trim();
    }
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

function resolveExtrasRecord(input: MetadataCarrier): NativeExtras | undefined {
  if (!isPlainObject(input)) {
    return undefined;
  }

  if (METADATA_EXTRAS_KEY in input) {
    return input as NativeExtras;
  }

  const maybeCarrier = input as { extras?: unknown };
  if ("extras" in maybeCarrier) {
    return isPlainObject(maybeCarrier.extras)
      ? (maybeCarrier.extras as NativeExtras)
      : undefined;
  }

  return input as NativeExtras;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
