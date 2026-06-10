/**
 * @module reply/create-dispatcher
 *
 * 通用 IM 出站 deliver 前预处理链（reasoning、thinking 占位、reply-parts、markdown、MEDIA:）。
 *
 * **职责**：将 OpenClaw ReplyPayload 规范为可交付的 `{ text, mediaUrls, hasMedia }`，
 * 在通道 `deliver` 之前统一完成分片、thinking 掩码、表格转换与媒体指令解析。
 *
 * **适用场景**：WeCom / Feishu 等插件的出站 deliver 钩子，避免各通道重复实现预处理。
 *
 * **关键导出**：`preprocessOutboundReply`、`OutboundReplyPayload`、`PreprocessedOutboundReply`
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

/**
 * 出站回复 payload（扩展 reply-parts 参数）。
 *
 * @property isReasoning - 是否为 reasoning 块，为 true 时可经 formatReasoning 格式化
 * @property hasMedia - 是否含媒体（可与解析出的 mediaUrls 合并）
 */
export type OutboundReplyPayload = ResolveReplyPartsParams & {
  isReasoning?: boolean;
  hasMedia?: boolean;
};

/**
 * `preprocessOutboundReply` 入参。
 *
 * @property payload - OpenClaw ReplyPayload 子集
 * @property formatReasoning - 可选 reasoning 文本格式化函数
 * @property convertMarkdownTables - 可选 markdown 表格转换函数
 * @property tableMode - 表格模式，传给 convertMarkdownTables
 * @property homedir - 解析 MEDIA: 本地路径时的 homedir
 */
export type PreprocessOutboundReplyParams = {
  payload: OutboundReplyPayload;
  formatReasoning?: (text: string) => string;
  convertMarkdownTables?: (text: string, tableMode?: unknown) => string;
  tableMode?: unknown;
  homedir?: string;
};

/**
 * 预处理后的可投递出站回复。
 *
 * @property text - 最终纯文本（已 strip MEDIA: 指令）
 * @property mediaUrls - 合并后的媒体 URL 列表（去重）
 * @property hasMedia - 是否含媒体
 */
export type PreprocessedOutboundReply = {
  text: string;
  mediaUrls: string[];
  hasMedia: boolean;
};

/**
 * 将 OpenClaw ReplyPayload 规范为可交付文本与媒体 URL 列表。
 *
 * **处理顺序**：
 * 1. reasoning 格式化（可选）
 * 2. reply-parts 分片与文本合并
 * 3. thinking 块掩码 → markdown 表格转换 → thinking 还原
 * 4. MEDIA: 指令解析与 strip
 * 5. 合并 payload / parts / directive 中的 mediaUrls
 *
 * @param params - payload 与各阶段可选转换函数
 * @returns 预处理后的 text / mediaUrls / hasMedia
 *
 * @example
 * ```ts
 * const { text, mediaUrls, hasMedia } = await preprocessOutboundReply({
 *   payload: { text: reply.text, mediaUrls: reply.mediaUrls },
 *   convertMarkdownTables: (t) => convertTables(t),
 *   homedir: os.homedir(),
 * });
 * await deliver({ text, mediaUrls });
 * ```
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

  // thinking 掩码：避免 markdown / 表格转换误改 thinking 块内容
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
