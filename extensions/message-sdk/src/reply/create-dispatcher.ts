/**
 * 通用 IM 出站 deliver 前处理链（reasoning、thinking 占位、reply-parts、markdown、MEDIA:）。
 */

import { parseMediaDirectives } from "../media/parse-directives.js";
import {
  maskThinkingBlocks,
  restoreThinkingBlocks,
} from "./format-thinking-blocks.js";
import {
  resolveSendableOutboundReplyParts,
  type ResolveReplyPartsParams,
} from "../pipeline/reply-parts.js";

export type OutboundReplyPayload = ResolveReplyPartsParams & {
  isReasoning?: boolean;
  hasMedia?: boolean;
};

export type PreprocessOutboundReplyParams = {
  payload: OutboundReplyPayload;
  formatReasoning?: (text: string) => string;
  convertMarkdownTables?: (text: string, tableMode?: unknown) => string;
  tableMode?: unknown;
  homedir?: string;
};

export type PreprocessedOutboundReply = {
  text: string;
  mediaUrls: string[];
  hasMedia: boolean;
};

/**
 * 将 OpenClaw ReplyPayload 规范为可交付文本与媒体 URL 列表。
 */
export async function preprocessOutboundReply(
  params: PreprocessOutboundReplyParams,
): Promise<PreprocessedOutboundReply> {
  const payloadText =
    params.payload.isReasoning && params.payload.text && params.formatReasoning
      ? params.formatReasoning(params.payload.text)
      : params.payload.text;

  const parts = await resolveSendableOutboundReplyParts({
    ...params.payload,
    text: payloadText,
  });

  const textChunks = parts.map((p) => p.text?.trim()).filter(Boolean) as string[];
  let text = textChunks.length > 0 ? textChunks.join("\n\n") : (params.payload.text ?? "");
  const mediaFromParts = parts
    .map((p) => p.mediaUrl)
    .filter((u): u is string => Boolean(u?.trim()));

  const { text: masked, placeholders } = maskThinkingBlocks(text);
  text = masked;

  if (params.convertMarkdownTables) {
    text = params.convertMarkdownTables(text, params.tableMode);
  }

  text = restoreThinkingBlocks(text, placeholders);

  const { text: stripped, paths: directivePaths } = parseMediaDirectives(text, {
    homedir: params.homedir,
  });
  text = stripped;

  const mediaUrls = Array.from(
    new Set([...(params.payload.mediaUrls ?? []), ...mediaFromParts, ...directivePaths]),
  );

  const hasMedia = Boolean(params.payload.hasMedia || mediaUrls.length > 0);

  return { text, mediaUrls, hasMedia };
}
