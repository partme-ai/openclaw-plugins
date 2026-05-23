/**
 * @module streaming-config
 *
 * WeCom 流式输出配置解析与 stream 气泡拼接（委托 message-sdk transcript）。
 *
 * **职责**：
 * - 解析 `channels.wecom.streaming` / `footer` 嵌套配置
 * - 将 status / answer / footer 合成单条 `replyStream` 纯文本
 * - 提供 Bot 首帧占位、enter_chat 欢迎语、Webhook 空 content 兜底
 *
 * **适用场景**：WS `ws-reply-pipeline`、Webhook reply-pipeline、Agent API stream。
 *
 * **上下游**：
 * - 上游：`@partme.ai/openclaw-message-sdk/transcript`
 * - 下游：`templates`（文案）、`finish-thinking`（关流文本）
 *
 * **关键导出**：`resolveWecomStreamingConfig`、`syncWecomStreamContent`、`buildWecomStreamBubbleText`
 */

import {
  buildStreamBubbleText,
  resolveChannelStreamingConfig,
  shouldShowStreamStatusLine,
  syncStreamContent,
  type ResolvedChannelStreamingConfig,
  type StreamCompositionState,
} from "@partme.ai/openclaw-message-sdk/transcript";
import type { WeComConfig, ResolvedWeComAccount } from "./wecom-config.js";
import type { WecomFooterConfig, WecomStreamingNestedConfig } from "../types/config.js";
import {
  formatWecomElapsedFooter,
  WECOM_DEFAULT_TEMPLATES,
  type ResolvedWecomTemplates,
} from "./templates.js";

export {
  formatWecomElapsedFooter,
  WECOM_STATUS_COMPACTING,
  WECOM_STATUS_GENERATING,
  WECOM_STATUS_READING,
  WECOM_STATUS_RECEIVED,
  WECOM_STATUS_THINKING,
  WECOM_STATUS_TOOL,
} from "./templates.js";
export type { ResolvedWecomTemplates };

/** 解析后的流式配置（status / answer / footer 开关与样式） */
export type ResolvedWecomStreamingConfig = ResolvedChannelStreamingConfig;

/** 流式气泡合成中间状态（content / statusLine / answerText 等） */
export type WecomStreamCompositionState = StreamCompositionState;

/**
 * 将 WeComConfig 转为 message-sdk 流式解析所需的 raw 形状。
 *
 * @param cfg - channels.wecom 账号配置
 */
function toStreamingRaw(cfg: WeComConfig) {
  return {
    streaming: cfg.streaming as boolean | WecomStreamingNestedConfig | undefined,
    footer: cfg.footer as WecomFooterConfig | undefined,
  };
}

/**
 * 解析 `channels.wecom.streaming` / `footer` 配置。
 *
 * @param accountOrConfig - 已解析账号或裸 WeComConfig
 * @returns 合并默认值后的流式配置
 */
export function resolveWecomStreamingConfig(
  accountOrConfig: ResolvedWeComAccount | WeComConfig,
): ResolvedWecomStreamingConfig {
  const cfg = "config" in accountOrConfig ? accountOrConfig.config : accountOrConfig;
  return resolveChannelStreamingConfig(toStreamingRaw(cfg));
}

/**
 * 是否应在 stream 气泡中展示状态行（thinking / tool / reading 等）。
 *
 * @param cfg - 解析后的流式配置
 */
export function shouldShowWecomStatusLine(cfg: ResolvedWecomStreamingConfig): boolean {
  return shouldShowStreamStatusLine(cfg);
}

/**
 * 将 status / answer / footer 拼成单条 replyStream 纯文本。
 *
 * @param params.statusLine - 状态行（可选）
 * @param params.answerText - 正文（可选）
 * @param params.footerLine - 脚注（可选）
 * @param params.includeStatus - 是否包含状态行
 * @param params.includeAnswer - 是否包含正文
 * @param params.includeFooter - 是否包含脚注
 * @returns 合成后的气泡文本
 */
export function buildWecomStreamBubbleText(params: {
  statusLine?: string;
  answerText?: string;
  footerLine?: string;
  includeStatus?: boolean;
  includeAnswer?: boolean;
  includeFooter?: boolean;
}): string {
  return buildStreamBubbleText(params);
}

/**
 * 根据 streaming 配置将 status / answer / footer 写入 state.content。
 *
 * @param state - 流式合成状态（会被原地更新 content）
 * @param streamingConfig - 流式开关配置
 * @param options.includeAnswer - 是否写入 answer
 * @param options.includeFooter - 是否写入耗时脚注
 * @param options.includeStatus - 是否写入 status
 * @param options.finishedAt - 关流时刻（用于脚注耗时）
 * @param options.templates - 文案模板（默认内置）
 */
export function syncWecomStreamContent(
  state: WecomStreamCompositionState,
  streamingConfig: ResolvedWecomStreamingConfig,
  options: {
    includeAnswer?: boolean;
    includeFooter?: boolean;
    includeStatus?: boolean;
    finishedAt?: number;
    templates?: ResolvedWecomTemplates;
  } = {},
): void {
  const templates = options.templates ?? WECOM_DEFAULT_TEMPLATES;
  syncStreamContent(state, streamingConfig, {
    ...options,
    formatElapsedFooter: (elapsedMs) => formatWecomElapsedFooter(elapsedMs, templates),
  });
}

/**
 * 解析 Bot 流式 **首帧占位** 文案（replyStream 第一条 content，与状态栏 thinkingText 不同）。
 *
 * - **Webhook**：企微要求先回一条 `finish=false` 的 stream；未配置时通常为 `"1"`（最小占位）。
 * - **WebSocket**：首帧常为 `<think></think>` 或自定义短句，用于占住流式通道。
 *
 * 配置：`streamPlaceholderText`。与 `welcomeText`、`thinkingText` 职责不同。
 *
 * @param cfg - WeCom 配置
 * @param fallback - 未配置时的回退文案
 * @returns 占位文本或 `undefined`
 */
export function resolveWecomStreamPlaceholderText(
  cfg: WeComConfig,
  fallback?: string,
): string | undefined {
  const fromText = cfg.streamPlaceholderText?.trim();
  if (fromText) {
    return fromText;
  }
  const fb = fallback?.trim();
  return fb || undefined;
}

/**
 * 解析 enter_chat / subscribe 欢迎语（`welcomeText`）。
 *
 * @param cfg - WeCom 配置
 * @returns 欢迎语文本或 `undefined`
 */
export function resolveWecomEnterChatWelcomeText(cfg: WeComConfig): string | undefined {
  const welcome = cfg.welcomeText?.trim();
  return welcome || undefined;
}

/**
 * Agent 欢迎语：`agent.welcomeText` 优先，否则与 Bot 共用 `channels.wecom.welcomeText`。
 *
 * @param agentWelcomeText - Agent 级欢迎语
 * @param channelConfig - 渠道级配置（回退）
 * @returns 欢迎语文本或 `undefined`
 */
export function resolveAgentWelcomeText(
  agentWelcomeText: string | undefined,
  channelConfig?: WeComConfig,
): string | undefined {
  const agentOnly = agentWelcomeText?.trim();
  if (agentOnly) {
    return agentOnly;
  }
  if (channelConfig) {
    return resolveWecomEnterChatWelcomeText(channelConfig);
  }
  return undefined;
}

/**
 * Webhook 关流前空 content 兜底：写入 answerText 并按 streaming 配置合成气泡。
 *
 * **触发条件**：关流时 content 为空且无图片，但媒体已通过其他通路送达或需 processedComplete 提示。
 *
 * @param state - 流式状态（含 images / fallbackMode 等扩展字段）
 * @param streamingConfig - 流式配置
 * @param options.hasMediaDelivered - 是否已单独投递媒体
 * @param options.hasFallback - 是否已有其他 fallback 文本
 * @param options.finishedAt - 关流时刻
 * @param options.templates - 文案模板
 */
export function applyWecomWebhookEmptyContentFallback(
  state: WecomStreamCompositionState & {
    images?: Array<unknown>;
    agentMediaKeys?: string[];
    fallbackMode?: string;
  },
  streamingConfig: ResolvedWecomStreamingConfig,
  options: {
    hasMediaDelivered?: boolean;
    hasFallback?: boolean;
    finishedAt?: number;
    templates?: ResolvedWecomTemplates;
  } = {},
): void {
  const templates = options.templates ?? WECOM_DEFAULT_TEMPLATES;
  if (state.content.trim() || (state.images?.length ?? 0) > 0) {
    return;
  }
  if (options.hasMediaDelivered) {
    state.answerText = templates.mediaDelivered;
  } else if (!options.hasFallback) {
    state.answerText = templates.processedComplete;
  } else {
    return;
  }
  syncWecomStreamContent(state, streamingConfig, {
    includeAnswer: true,
    includeFooter: true,
    includeStatus: false,
    finishedAt: options.finishedAt,
    templates,
  });
}
