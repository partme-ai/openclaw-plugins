/**
 * WeCom 流式输出配置解析与 stream 气泡拼接。
 *
 * 对齐 Feishu 式布尔开关：streaming / streaming.status / streaming.content / footer.*
 */

import type { WeComConfig, ResolvedWeComAccount } from "./utils.js";
import type { WecomFooterConfig, WecomStreamingNestedConfig } from "./types/config.js";

/** 解析后的流式配置（账号级 merged config 输入） */
export type ResolvedWecomStreamingConfig = {
  /** 流式输出总开关（false = 默认模式） */
  streaming: boolean;
  /** 中间状态流式（tool / 阶段文案），仅 streaming=true 时生效 */
  streamingStatus: boolean;
  /** 答案 block 增量流式，仅 streaming=true 时生效 */
  streamingContent: boolean;
  /** 状态栏阶段文案（默认模式核心） */
  footerStatus: boolean;
  /** 关流时展示耗时 */
  footerElapsed: boolean;
};

/** 状态栏阶段文案 */
export const WECOM_STATUS_RECEIVED = "已收到，正在处理…";
export const WECOM_STATUS_THINKING = "正在思考…";
export const WECOM_STATUS_TOOL = "正在查资料…";
export const WECOM_STATUS_READING = "正在阅读附件…";
export const WECOM_STATUS_GENERATING = "正在组织回复…";
export const WECOM_STATUS_COMPACTING = "📦 正在压缩上下文…";

/**
 * 解析 channels.wecom.streaming / footer 配置，合并账号级 overrides。
 */
export function resolveWecomStreamingConfig(
  accountOrConfig: ResolvedWeComAccount | WeComConfig,
): ResolvedWecomStreamingConfig {
  const cfg = "config" in accountOrConfig ? accountOrConfig.config : accountOrConfig;
  const footer: WecomFooterConfig = cfg.footer ?? {};
  const rawStreaming = cfg.streaming;

  let streaming = false;
  let nested: WecomStreamingNestedConfig = {};

  if (rawStreaming === true) {
    streaming = true;
  } else if (rawStreaming === false || rawStreaming == null) {
    streaming = false;
  } else if (typeof rawStreaming === "object") {
    nested = rawStreaming;
    streaming = nested.enabled !== false;
  }

  return {
    streaming,
    streamingStatus: streaming ? (nested.status ?? true) : false,
    streamingContent: streaming ? (nested.content ?? true) : false,
    footerStatus: footer.status ?? true,
    footerElapsed: footer.elapsed ?? false,
  };
}

/** 是否应在 stream 气泡中展示状态行 */
export function shouldShowWecomStatusLine(cfg: ResolvedWecomStreamingConfig): boolean {
  return cfg.footerStatus || (cfg.streaming && cfg.streamingStatus);
}

/** 关流耗时脚注 */
export function formatWecomElapsedFooter(elapsedMs: number): string {
  const seconds = Math.max(1, Math.round(elapsedMs / 1000));
  return `⏱ ${seconds}s · 已完成`;
}

/**
 * 将 status / answer / footer 拼成单条 replyStream 纯文本。
 */
export function buildWecomStreamBubbleText(params: {
  statusLine?: string;
  answerText?: string;
  footerLine?: string;
  includeStatus?: boolean;
  includeAnswer?: boolean;
  includeFooter?: boolean;
}): string {
  const parts: string[] = [];
  const includeStatus = params.includeStatus !== false;
  const includeAnswer = params.includeAnswer !== false;
  const includeFooter = params.includeFooter !== false;

  const status = params.statusLine?.trim();
  const answer = params.answerText?.trim();
  const footer = params.footerLine?.trim();

  if (includeStatus && status) {
    parts.push(status);
  }
  if (includeAnswer && answer) {
    if (parts.length > 0) {
      parts.push("\n\n---\n\n");
    }
    parts.push(answer);
  }
  if (includeFooter && footer) {
    if (parts.length > 0) {
      parts.push("\n\n---\n\n");
    }
    parts.push(footer);
  }

  return parts.join("");
}

/** StreamState / MessageState 共用的 content 同步参数 */
export type WecomStreamCompositionState = {
  statusLine?: string;
  answerText?: string;
  content: string;
  replyStartedAt?: number;
};

/**
 * 根据 streaming 配置将 status / answer / footer 写入 state.content。
 */
export function syncWecomStreamContent(
  state: WecomStreamCompositionState,
  streamingConfig: ResolvedWecomStreamingConfig,
  options: {
    includeAnswer?: boolean;
    includeFooter?: boolean;
    includeStatus?: boolean;
    finishedAt?: number;
  } = {},
): void {
  const showAnswer =
    options.includeAnswer === true ||
    (options.includeAnswer !== false &&
      streamingConfig.streaming &&
      streamingConfig.streamingContent &&
      Boolean(state.answerText?.trim()));

  const statusLine =
    options.includeStatus !== false && shouldShowWecomStatusLine(streamingConfig)
      ? state.statusLine
      : undefined;

  const footerLine =
    options.includeFooter === true &&
    streamingConfig.footerElapsed &&
    state.replyStartedAt != null
      ? formatWecomElapsedFooter((options.finishedAt ?? Date.now()) - state.replyStartedAt)
      : undefined;

  state.content = buildWecomStreamBubbleText({
    statusLine,
    answerText: showAnswer ? state.answerText : undefined,
    footerLine,
    includeStatus: options.includeStatus !== false,
    includeAnswer: showAnswer,
    includeFooter: Boolean(footerLine),
  });
}

/**
 * 解析 WS / Webhook thinking 占位文案（streamPlaceholderContent 优先）。
 */
export function resolveWecomStreamPlaceholder(cfg: WeComConfig, fallback: string): string {
  const custom = cfg.streamPlaceholderContent?.trim();
  return custom || fallback;
}

/**
 * 解析 WS enter_chat 欢迎语文案（welcomeText 优先，其次自定义 stream 占位）。
 */
export function resolveWecomEnterChatWelcomeText(cfg: WeComConfig): string | undefined {
  const welcome = cfg.welcomeText?.trim();
  if (welcome) {
    return welcome;
  }
  const placeholder = cfg.streamPlaceholderContent?.trim();
  if (placeholder && placeholder !== "1") {
    return placeholder;
  }
  return undefined;
}

/**
 * Webhook 关流前空 content 兜底：写入 answerText 并按 streaming 配置合成气泡。
 */
export function applyWecomWebhookEmptyContentFallback(
  state: WecomStreamCompositionState & {
    images?: Array<unknown>;
    agentMediaKeys?: string[];
    fallbackMode?: string;
  },
  streamingConfig: ResolvedWecomStreamingConfig,
  options: { hasMediaDelivered?: boolean; hasFallback?: boolean; finishedAt?: number } = {},
): void {
  if (state.content.trim() || (state.images?.length ?? 0) > 0) {
    return;
  }
  if (options.hasMediaDelivered) {
    state.answerText = "✅ 文件已发送。";
  } else if (!options.hasFallback) {
    state.answerText = "✅ 已处理完成。";
  } else {
    return;
  }
  syncWecomStreamContent(state, streamingConfig, {
    includeAnswer: true,
    includeFooter: true,
    includeStatus: false,
    finishedAt: options.finishedAt,
  });
}
