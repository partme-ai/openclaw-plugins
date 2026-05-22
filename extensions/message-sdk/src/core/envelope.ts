/**
 * MessageEnvelope 构建与解析。
 */

import { buildMessage, parseMessage, parseMessageAny } from "./message.js";
import type {
  MessageEnvelope,
  MessageEnvelopeHeaders,
  ReplyRoute,
  UnifiedMessage,
} from "./types.js";

/**
 * buildEnvelope 是 core 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function buildEnvelope(
  message: UnifiedMessage,
  headers?: MessageEnvelopeHeaders,
): MessageEnvelope {
  return {
    version: "1",
    message,
    ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

/**
 * buildOutboundEnvelope 是 core 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function buildOutboundEnvelope(params: {
  channel: string;
  accountId: string;
  userId: string;
  text: string;
  agentId?: string;
  replyToMessageId?: string;
  headers?: MessageEnvelopeHeaders;
}): MessageEnvelope {
  const message = buildMessage({
    channel: params.channel,
    accountId: params.accountId,
    userId: params.userId,
    agentId: params.agentId,
    text: params.text,
    replyToMessageId: params.replyToMessageId,
    direction: "outbound",
  });
  return buildEnvelope(message, params.headers);
}

/**
 * parseEnvelope 是 core 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function parseEnvelope(raw: string): MessageEnvelope | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return null;
    if (obj.version === "1" && obj.message && typeof obj.message === "object") {
      const msg = obj.message as UnifiedMessage;
      if (!msg.messageId || !msg.source?.channel) return null;
      return {
        version: "1",
        message: msg,
        headers: (obj.headers as MessageEnvelopeHeaders) ?? undefined,
      };
    }
    const legacy = parseMessage(raw);
    if (legacy) {
      return { version: "1", message: legacy };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * extractRoutingMetadata 是 core 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function extractRoutingMetadata(msg: UnifiedMessage): {
  correlationId?: string;
  idempotencyKey?: string;
} {
  const meta = msg.metadata ?? {};
  return {
    correlationId:
      typeof meta.correlationId === "string" ? meta.correlationId : undefined,
    idempotencyKey:
      typeof meta.idempotencyKey === "string" ? meta.idempotencyKey : undefined,
  };
}

/**
 * mergeReplyRouteIntoHeaders 是 core 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function mergeReplyRouteIntoHeaders(
  headers: MessageEnvelopeHeaders | undefined,
  replyRoute: ReplyRoute | undefined,
): MessageEnvelopeHeaders | undefined {
  if (!replyRoute || Object.keys(replyRoute).length === 0) {
    return headers;
  }
  return { ...headers, replyRoute };
}

/**
 * serializeEnvelope 是 core 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function serializeEnvelope(envelope: MessageEnvelope): string {
  return JSON.stringify(envelope);
}

/**
 * parseEnvelopeAny 是 core 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function parseEnvelopeAny(
  input: string | Buffer | Uint8Array | unknown,
): MessageEnvelope | null {
  if (typeof input === "string") return parseEnvelope(input);
  if (Buffer.isBuffer(input)) return parseEnvelope(input.toString("utf-8"));
  if (input instanceof Uint8Array) return parseEnvelope(new TextDecoder().decode(input));
  if (typeof input === "object" && input !== null) {
    const o = input as Record<string, unknown>;
    if (o.version === "1" && o.message) {
      return o as unknown as MessageEnvelope;
    }
    const unified = parseMessageAny(input);
    if (unified) {
      return { version: "1", message: unified };
    }
  }
  return null;
}
