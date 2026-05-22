/**
 * 出站回复拆分（对齐 OpenClaw reply-payload，无 OpenClaw 时提供基础实现）。
 */

import { importOpenClawPluginSdk } from "../openclaw-loader.js";

export type OutboundReplyPart = {
  text?: string;
  mediaUrl?: string;
  caption?: string;
};

export type ResolveReplyPartsParams = {
  text?: string;
  mediaUrls?: string[];
  maxChunkChars?: number;
};

/**
 * 将出站载荷拆为可发送片段（文本块 + 媒体）。
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
 * 文本分块（带单块 fallback）。
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
