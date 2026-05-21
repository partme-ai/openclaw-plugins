/**
 * OpenClaw Bridge — 渠道消息规范化
 *
 * 根据渠道能力声明，对出站消息进行格式转换：
 * - stripMarkdown:         移除所有 Markdown 格式
 * - escapeMarkdownV2:      Telegram MarkdownV2 特殊字符转义
 * - convertToMrkdwn:       Slack mrkdwn 子集转换
 * - stripAdvancedMarkdown: 保留 bold/italic，移除表格/脚注等高级语法
 * - splitText:             按长度智能分段（换行→句子→词语边界）
 * - normalizeForChannel:   综合规范化入口
 */

import { getChannelCapabilities, type MarkdownDialect } from "./capabilities.js";

export interface NormalizedMessage {
  contentType: "text" | "markdown" | "html";
  segments: string[];
  warnings: string[];
}

// ── 基础转换函数 ──

/** 移除所有 Markdown 格式，返回纯文本 */
export function stripMarkdown(text: string): string {
  return text
    // 代码块 → 内容
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, "").replace(/```$/g, ""))
    // 行内代码
    .replace(/`([^`]+)`/g, "$1")
    // 图片 ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // 链接 [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // 标题 # → 移除
    .replace(/^#{1,6}\s+/gm, "")
    // 粗体+斜体 ***text***
    .replace(/\*{3}(.+?)\*{3}/g, "$1")
    // 粗体 **text** 或 __text__
    .replace(/(\*{2}|__)(.+?)\1/g, "$2")
    // 斜体 *text* 或 _text_
    .replace(/(\*|_)(.+?)\1/g, "$2")
    // 删除线 ~~text~~
    .replace(/~~(.+?)~~/g, "$1")
    // 引用 > 移除
    .replace(/^>\s?/gm, "")
    // 无序列表 - / * / + → 移除符号
    .replace(/^[\s]*[-*+]\s+/gm, "")
    // 有序列表 1. → 移除序号
    .replace(/^[\s]*\d+\.\s+/gm, "")
    // 水平线 --- / *** / ___
    .replace(/^[-*_]{3,}\s*$/gm, "")
    // 表格行分隔 |---|---|
    .replace(/^\|?[-:| ]+\|?$/gm, "")
    // 表格管道符
    .replace(/\|/g, " ")
    // 清理多余空行
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Telegram MarkdownV2 特殊字符转义 */
export function escapeMarkdownV2(text: string): string {
  // MarkdownV2 需转义的字符: _ * [ ] ( ) ~ ` > # + - = | { } . !
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

/** 将标准 Markdown 转换为 Slack mrkdwn 子集 */
export function convertToMrkdwn(text: string): string {
  return text
    // 删除线 → 移除（mrkdwn 不支持）
    .replace(/~~(.+?)~~/g, "$1")
    // # 标题 → *bold*
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    // 保留 *bold*、_italic_、`code`、```code block```
    // mrkdwn 原生支持这些
    .trim();
}

/** 保留基本 Markdown（bold/italic/links/code），移除高级语法 */
export function stripAdvancedMarkdown(text: string): string {
  return text
    // 移除表格行分隔符 |---|---|
    .replace(/^\|[-:| ]+\|[-:| \s]*$/gm, "")
    // 移除以 | 开头的表格数据行（至少2个管道）→ 替换管道为 " - "
    .replace(/^\|(.+?\|)+.*$/gm, (line) => line.replace(/\|/g, " - "))
    // 移除脚注 [^1] 和 [^1]: definition
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/^\[\^[^\]]+\]:.*$/gm, "")
    // 移除 HTML 标签
    .replace(/<[^>]+>/g, "")
    .trim();
}

// ── 智能分段 ──

/** 按长度智能分段：优先在换行→句子→词语边界处切分 */
export function splitText(text: string, maxLen: number): string[] {
  if (!text) return [];
  if (text.length <= maxLen) return [text];

  const segments: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      segments.push(remaining);
      break;
    }

    // 优先在换行边界切分（保留换行符到前一段末尾）
    let cutIdx = remaining.lastIndexOf("\n", maxLen);
    if (cutIdx > 0) {
      segments.push(remaining.slice(0, cutIdx + 1)); // include the \n
      remaining = remaining.slice(cutIdx + 1);
      continue;
    }

    // 次选在句号/问号/叹号等句子边界切分
    cutIdx = findLastSentenceEnd(remaining, maxLen);
    if (cutIdx > 0) {
      segments.push(remaining.slice(0, cutIdx));
      remaining = remaining.slice(cutIdx);
      continue;
    }

    // 最后在空格词语边界切分
    cutIdx = remaining.lastIndexOf(" ", maxLen);
    if (cutIdx > 0) {
      segments.push(remaining.slice(0, cutIdx));
      remaining = remaining.slice(cutIdx + 1);
      continue;
    }

    // 无合适边界，硬切
    segments.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }

  return segments;
}

function findLastSentenceEnd(text: string, maxLen: number): number {
  const sentenceEnders = [".", "。", "！", "？", "!", "?", "；", ";"];
  let lastIdx = -1;
  for (const ender of sentenceEnders) {
    const idx = text.lastIndexOf(ender, maxLen);
    if (idx > lastIdx) lastIdx = idx;
  }
  return lastIdx > 0 ? lastIdx + 1 : -1;
}

// ── 渠道规范化入口 ──

export interface ChannelNormalizer {
  transform: (text: string) => string;
  maxLen: number;
  overflowStrategy: "truncate" | "split" | "error";
}

const DIALECT_NORMALIZERS: Record<MarkdownDialect, (text: string) => string> = {
  none: stripMarkdown,
  basic: stripAdvancedMarkdown,
  github: (t) => t,
  "markdown-v2": escapeMarkdownV2,
  mrkdwn: convertToMrkdwn,
  commonmark: (t) => t,
  html: (t) => t,
};

/** 获取渠道的规范化器配置 */
export function getChannelNormalizer(channelId: string): ChannelNormalizer | undefined {
  const cap = getChannelCapabilities(channelId);
  if (!cap) return undefined;
  const transform = DIALECT_NORMALIZERS[cap.escaping.markdownDialect] ?? ((t: string) => t);
  return {
    transform,
    maxLen: cap.textLimits.maxPerMessage,
    overflowStrategy: cap.textLimits.overflowStrategy,
  };
}

/** 综合规范化：根据渠道能力转换格式 + 分段 */
export function normalizeForChannel(
  channelId: string,
  content: string,
  options?: { preferFormat?: "text" | "markdown" | "html" },
): NormalizedMessage {
  const normalizer = getChannelNormalizer(channelId);
  const warnings: string[] = [];

  // 未知渠道：原样返回
  if (!normalizer) {
    return { contentType: options?.preferFormat ?? "markdown", segments: [content], warnings: [] };
  }

  const transformed = normalizer.transform(content);
  const contentType = resolveContentType(channelId, options?.preferFormat);

  if (normalizer.overflowStrategy === "truncate") {
    const truncated = transformed.length > normalizer.maxLen
      ? transformed.slice(0, normalizer.maxLen)
      : transformed;
    if (transformed.length > normalizer.maxLen) {
      warnings.push(`Content truncated from ${transformed.length} to ${normalizer.maxLen} characters`);
    }
    return { contentType, segments: [truncated], warnings };
  }

  // split 策略
  const segments = splitText(transformed, normalizer.maxLen);
  if (segments.length > 1) {
    warnings.push(`Content split into ${segments.length} segments (max ${normalizer.maxLen} chars each)`);
  }
  return { contentType, segments, warnings };
}

function resolveContentType(
  channelId: string,
  prefer?: "text" | "markdown" | "html",
): "text" | "markdown" | "html" {
  const cap = getChannelCapabilities(channelId);
  if (!cap) return prefer ?? "markdown";

  const dialect = cap.escaping.markdownDialect;
  if (dialect === "none") return "text";
  if (dialect === "html" && cap.supportedFormats.includes("html")) return "html";
  if (prefer && cap.supportedFormats.includes(prefer)) return prefer;
  if (cap.supportedFormats.includes("markdown")) return "markdown";
  return "text";
}
