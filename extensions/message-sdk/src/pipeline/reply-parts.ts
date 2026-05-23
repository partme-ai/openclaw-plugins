/**
 * @module pipeline/reply-parts
 *
 * 出站回复拆分（对齐 OpenClaw reply-payload，无 OpenClaw 时提供基础实现）。
 *
 * **职责**：将长文本按 maxChunkChars 分块，并将 mediaUrls 拆为可发送片段列表。
 *
 * **关键导出**：`resolveSendableOutboundReplyParts`、`resolveTextChunksWithFallback`
 */

import { importOpenClawPluginSdk } from "../openclaw/loader.js";

/** 单个可发送出站片段 / Single sendable outbound part */
export type OutboundReplyPart = {
  /** 文本块 / Text chunk */
  text?: string;
  /** 媒体 URL / Media URL */
  mediaUrl?: string;
  /** 媒体说明 / Media caption */
  caption?: string;
};

/** resolveSendableOutboundReplyParts 入参 / Params for resolving sendable parts */
export type ResolveReplyPartsParams = {
  /** 原始文本 / Raw text */
  text?: string;
  /** 媒体 URL 列表 / Media URLs */
  mediaUrls?: string[];
  /** 单块最大字符数，默认 4000 / Max chars per chunk */
  maxChunkChars?: number;
};

/**
 * 将出站载荷拆为可发送片段（文本块 + 媒体）/ Split outbound payload into sendable parts.
 *
 * 优先委托 OpenClaw `resolveSendableOutboundReplyParts`；不可用时本地按 maxChunkChars 分块。
 *
 * @param params - 文本与媒体 URL
 * @returns 按顺序发送的片段列表
 */
export async function resolveSendableOutboundReplyParts(
  params: ResolveReplyPartsParams,
): Promise<OutboundReplyPart[]> {
  const sdk = await importOpenClawPluginSdk<{
    resolveSendableOutboundReplyParts?: (p: ResolveReplyPartsParams) => Promise<OutboundReplyPart[]>;
  }>("reply-payload");

  if (typeof sdk?.resolveSendableOutboundReplyParts === "function") {
    return sdk.resolveSendableOutboundReplyParts(params);
  }

  // Fallback：本地分块 + 媒体 URL 逐条追加
  const parts: OutboundReplyPart[] = [];
  const text = params.text?.trim() ?? "";
  const maxChunk = params.maxChunkChars ?? 4000;

  if (text) {
    for (let i = 0; i < text.length; i += maxChunk) {
      parts.push({ text: text.slice(i, i + maxChunk) });
    }
  }

  for (const url of params.mediaUrls ?? []) {
    const trimmed = url?.trim();
    if (trimmed) parts.push({ mediaUrl: trimmed });
  }

  return parts;
}

/**
 * 文本分块（带 OpenClaw fallback）/ Chunk text with optional OpenClaw delegation.
 *
 * @param text - 原始文本
 * @param maxChunkChars - 单块最大字符数
 * @returns 非空文本块数组；空文本返回 []
 */
export async function resolveTextChunksWithFallback(
  text: string,
  maxChunkChars: number,
): Promise<string[]> {
  const sdk = await importOpenClawPluginSdk<{
    resolveTextChunksWithFallback?: (t: string, m: number) => Promise<string[]>;
  }>("reply-payload");

  if (typeof sdk?.resolveTextChunksWithFallback === "function") {
    return sdk.resolveTextChunksWithFallback(text, maxChunkChars);
  }

  const trimmed = text.trim();
  if (!trimmed) return [];
  const chunks: string[] = [];
  for (let i = 0; i < trimmed.length; i += maxChunkChars) {
    chunks.push(trimmed.slice(i, i + maxChunkChars));
  }
  return chunks;
}
