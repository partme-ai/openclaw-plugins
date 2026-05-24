/**
 * @fileoverview 出站文本按渠道能力进行格式清洗、转义与分段的核心实现。
 *
 * @description
 * **架构角色**：介于「模型通用 Markdown 输出」与各 IM 网关「方言 + 长度限制」之间的适配层。
 *
 * **管线概览**：
 * 1. `getChannelCapabilities(channelId)` → `markdownDialect` / `maxPerMessage` / `overflowStrategy`
 * 2. `DIALECT_NORMALIZERS[dialect]` 做单轮字符串变换（剥离 / 转义 / mrkdwn 映射等）
 * 3. `overflowStrategy` 为 `truncate` 时硬裁切；为 `split` 时调用 `splitText` 语义切段
 *
 * **非目标**：不做 HTML sanitize XSS 审计（宿主应在更外层处理不可信富文本）。
 *
 * @module bridge/normalize
 */

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

/**
 * @description 出站规范化结果：内容类型声明、分段后的文本数组、以及可被 UI/日志消费的人读警告。
 */
export interface NormalizedMessage {
  /** @description 建议宿主投递到渠道 API 时的顶层格式标签。 */
  contentType: "text" | "markdown" | "html";
  /** @description 多端消息：每段均满足最大长度策略（`truncate` 时通常仅一段）。 */
  segments: string[];
  /** @description 例如发生截断或多段拆分时给出的解释性提示（非对用户直接展示强制）。 */
  warnings: string[];
}

// ── 基础转换函数 ──

/**
 * @description 将常见 Markdown 体面降级为近似纯文本：保留语义连续，移除强调/链接/代码栅栏等标记。
 * @param text - 模型或上游产生的 Markdown 源串。
 * @returns 纯文本近似；空入参得到空串。
 * @throws 不抛出。
 */
export function stripMarkdown(text: string): string {
  return text
    // 代码块 → 提取内部文本
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, "").replace(/```$/g, ""))
    // 行内代码：`code` → code
    .replace(/`([^`]+)`/g, "$1")
    // 图片：保留 alt 文案
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // 链接：保留可见文本
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // ATX 标题去掉井号前缀
    .replace(/^#{1,6}\s+/gm, "")
    // 粗斜体组合
    .replace(/\*{3}(.+?)\*{3}/g, "$1")
    // 粗体 ** 或 __
    .replace(/(\*{2}|__)(.+?)\1/g, "$2")
    // 斜体 * 或 _
    .replace(/(\*|_)(.+?)\1/g, "$2")
    // 删除线
    .replace(/~~(.+?)~~/g, "$1")
    // 块引用前缀
    .replace(/^>\s?/gm, "")
    // 无序列表符号
    .replace(/^[\s]*[-*+]\s+/gm, "")
    // 有序列表前缀
    .replace(/^[\s]*\d+\.\s+/gm, "")
    // 水平分割线
    .replace(/^[-*_]{3,}\s*$/gm, "")
    // 表格分隔行
    .replace(/^\|?[-:| ]+\|?$/gm, "")
    // 普通表格竖线 → 空白，避免残留的管道布局
    .replace(/\|/g, " ")
    // 合并多余空行，控制最终密度
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * @description 为 Telegram MarkdownV2 预处理反斜杠转义：对齐官方要求的高危标点集合。
 * @param text - 待发送的原始 UTF-16 文本（应已决定走 MarkdownV2 模式）。
 * @returns 转义后的文本；正则替换失败不会由本函数显式向外抛出。
 * @throws 不抛出。
 */
export function escapeMarkdownV2(text: string): string {
  // MarkdownV2 需转义的字符: _ * [ ] ( ) ~ ` > # + - = | { } . !
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

/**
 * @description 粗粒度把「类 CommonMark」文本压成 Slack mrkdwn 可接受子集：删掉不兼容结构、把标题降级为加粗。
 * @param text - 源 Markdown。
 * @returns 适用于 Slack `mrkdwn` 解析的近似串。
 * @throws 不抛出。
 */
export function convertToMrkdwn(text: string): string {
  return text
    // 删除线 mrkdwn 不兼容 → 直接移除标记保留内文
    .replace(/~~(.+?)~~/g, "$1")
    // ATX 标题行提升为 *bold*，避免保留 # 前缀
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    // 保留 *bold*、_italic_、`code`、```fenced```（由 Slack 客户端再解释）
    .trim();
}

/**
 * @description 移除表格/脚注/裸 HTML 等「高阶」Markdown 结构，同时尽量保留轻量内联样式标记给后续渠道解释。
 * @param text - 源 Markdown / 混合文本。
 * @returns 清洗后的文本；可能仍含 `**` 等基础强调（视渠道后续管线）。
 * @throws 不抛出。
 */
export function stripAdvancedMarkdown(text: string): string {
  return text
    // 去掉 GFM 表格分隔线
    .replace(/^\|[-:| ]+\|[-:| \s]*$/gm, "")
    // 将表格行转为连字符清单式弱结构化（避免裸露管道布局）
    .replace(/^\|(.+?\|)+.*$/gm, (line) => line.replace(/\|/g, " - "))
    // 脚注引用与定义
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/^\[\^[^\]]+\]:.*$/gm, "")
    // 简单 HTML 标签剔除（非完整 sanitizer）
    .replace(/<[^>]+>/g, "")
    .trim();
}

// ── 智能分段 ──

/**
 * @description 在 `maxLen` 限制内尽量保持语义边界：换行 > 句末标点 > 空格 > 硬切。
 * @param text - 待切段的长文本。
 * @param maxLen - 单段最大字符数（应 > 0；若上游传 0 可能出现异常切段，本函数不单独校验业务合法性）。
 * @returns 非重叠片段数组；空入参返回 `[]`。
 * @throws 不抛出。
 */
export function splitText(text: string, maxLen: number): string[] {
  if (!text) return [];
  if (text.length <= maxLen) return [text];

  const segments: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // 尾部短包：直接收尾，避免无意义空迭代
    if (remaining.length <= maxLen) {
      segments.push(remaining);
      break;
    }

    // 优先级 1：保留段落感，在换行前切开（换行符附着在上一段末尾）
    let cutIdx = remaining.lastIndexOf("\n", maxLen);
    if (cutIdx > 0) {
      segments.push(remaining.slice(0, cutIdx + 1)); // include the \n
      remaining = remaining.slice(cutIdx + 1);
      continue;
    }

    // 优先级 2：中日英混排句末标点，减少半句悬垂
    cutIdx = findLastSentenceEnd(remaining, maxLen);
    if (cutIdx > 0) {
      segments.push(remaining.slice(0, cutIdx));
      remaining = remaining.slice(cutIdx);
      continue;
    }

    // 优先级 3：空格分词边界（拉丁词界）
    cutIdx = remaining.lastIndexOf(" ", maxLen);
    if (cutIdx > 0) {
      segments.push(remaining.slice(0, cutIdx));
      remaining = remaining.slice(cutIdx + 1); // 吃掉分隔空格，防止下一段前缀空白膨胀
      continue;
    }

    // 兜底：无 Soft break，只能硬切（长无空白 CJK/URL 场景）
    segments.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }

  return segments;
}

/**
 * @description 在 `0..maxLen` 窗口内寻找「最后一句结束符」位置，供 `splitText` 复用。
 * @param text - 当前剩余缓冲。
 * @param maxLen - 搜索上界（不包含更远的句点，避免第一段过长）。
 * @returns 切分点：**紧随**句末标点的下一个索引；找不到则 `-1`。
 * @throws 不抛出。
 */
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

/**
 * @description 描述「单渠道出站变换函数 + 限额策略」的策略对象。
 */
export interface ChannelNormalizer {
  /** @description 单轮字符串映射（剥离 / 转义 / 恒等）。 */
  transform: (text: string) => string;
  /** @description `splitText`/`truncate` 阈值，来自能力矩阵。 */
  maxLen: number;
  /** @description 与 `ChannelCapabilities.textLimits.overflowStrategy` 对齐。 */
  overflowStrategy: "truncate" | "split" | "error";
}

/** @description Markdown 方言到具体转换 lambda 的映射表（新增方言时须同步扩展）。 */
const DIALECT_NORMALIZERS: Record<MarkdownDialect, (text: string) => string> = {
  none: stripMarkdown,
  basic: stripAdvancedMarkdown,
  github: (t) => t,
  "markdown-v2": escapeMarkdownV2,
  mrkdwn: convertToMrkdwn,
  commonmark: (t) => t,
  html: (t) => t,
};

/**
 * @description 聚合 `getChannelCapabilities` 与方言表，得到可直接应用于原始模型输出的变换描述符。
 * @param channelId - OpenClaw 逻辑渠道 ID。
 * @returns 规范器；未知渠道返回 `undefined` 以令上层退化为默认行为。
 * @throws 不抛出。
 */
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

/**
 * @description 一站式出站规范化：套用渠道变换并按溢出策略切段或截断。
 *
 * @param channelId - OpenClaw 逻辑渠道 ID。
 * @param content - 原始模型文本。
 * @param options.preferFormat - 当渠道允许多格式时的偏好提示（可被能力矩阵否决）。
 * @returns `NormalizedMessage`：`segments` 长度 ≥ 1。
 * @throws 不抛出。
 */
export function normalizeForChannel(
  channelId: string,
  content: string,
  options?: { preferFormat?: "text" | "markdown" | "html" },
): NormalizedMessage {
  const normalizer = getChannelNormalizer(channelId);
  const warnings: string[] = [];

  // 未知渠道：不做变换，保持上游格式猜测（降低意外损坏风险）
  if (!normalizer) {
    return { contentType: options?.preferFormat ?? "markdown", segments: [content], warnings: [] };
  }

  const transformed = normalizer.transform(content);
  const contentType = resolveContentType(channelId, options?.preferFormat);

  // Twitch 等极端「硬上限 + 不允许多条气泡」类策略：直接 slice
  if (normalizer.overflowStrategy === "truncate") {
    const truncated =
      transformed.length > normalizer.maxLen ? transformed.slice(0, normalizer.maxLen) : transformed;
    if (transformed.length > normalizer.maxLen) {
      warnings.push(`Content truncated from ${transformed.length} to ${normalizer.maxLen} characters`);
    }
    return { contentType, segments: [truncated], warnings };
  }

  // 默认：`split` —— 语义软切，尽量保持用户阅读连贯
  const segments = splitText(transformed, normalizer.maxLen);
  if (segments.length > 1) {
    warnings.push(`Content split into ${segments.length} segments (max ${normalizer.maxLen} chars each)`);
  }
  return { contentType, segments, warnings };
}

/**
 * @description 根据渠道支持格式与 Markdown 方言推导 `NormalizedMessage.contentType`。
 * @param channelId - OpenClaw 逻辑渠道 ID。
 * @param prefer - 调用方首选格式（若与能力冲突则降级）。
 * @returns `"text" | "markdown" | "html"` 三选一。
 * @throws 不抛出。
 */
function resolveContentType(
  channelId: string,
  prefer?: "text" | "markdown" | "html",
): "text" | "markdown" | "html" {
  const cap = getChannelCapabilities(channelId);
  if (!cap) return prefer ?? "markdown";

  const dialect = cap.escaping.markdownDialect;
  // 明确声明「无 Markdown」→ 强制 text，避免下游再去走 md 解析
  if (dialect === "none") return "text";
  // HTML 方言且平台 API 接受 html 载荷
  if (dialect === "html" && cap.supportedFormats.includes("html")) return "html";
  // 尊重显式偏好但若渠道根本不支持则继续向下尝试
  if (prefer && cap.supportedFormats.includes(prefer)) return prefer;
  if (cap.supportedFormats.includes("markdown")) return "markdown";
  return "text";
}
