/**
 * @module transcript/streaming-config
 *
 * Transcript 流式配置解析与 stream 气泡拼接（Feishu 式布尔开关对齐）。
 *
 * **职责**：将 openclaw.json 中 boolean / 嵌套 object 形态的 streaming 配置
 * 解析为扁平布尔开关；提供 status / answer / footer 三段式气泡拼接与 state 同步。
 *
 * **适用场景**：WeCom / Feishu stream 模式 vs 默认模式（状态栏 + 最终整包）切换。
 *
 * **上下游**：
 * - 上游：`ChannelStreamingRawConfig`（账号 config 子集）
 * - 下游：stream session、`resolveStreamFinishText`、`createTranscriptReplyDispatcherHooks`
 *
 * **关键导出**：`resolveChannelStreamingConfig`、`buildStreamBubbleText`、`syncStreamContent`
 */

import type {
  ChannelStreamingRawConfig,
  ResolvedChannelStreamingConfig,
  StreamCompositionState,
} from "./stream-state-types.js";

export type { ChannelStreamingRawConfig, ResolvedChannelStreamingConfig, StreamCompositionState };

/** 气泡各段之间的默认分隔符 */
const DEFAULT_SECTION_SEPARATOR = "\n\n---\n\n";

/**
 * 解析 streaming / footer 配置为扁平布尔开关。
 *
 * 规则：
 * - `streaming: true` → 全开（status + content）
 * - `streaming: false | null` → 全关
 * - `streaming: { enabled?, status?, content? }` → 嵌套细粒度控制
 *
 * @param raw - 原始配置片段，默认 `{}`
 * @returns 解析后的 {@link ResolvedChannelStreamingConfig}
 */
export function resolveChannelStreamingConfig(
  raw: ChannelStreamingRawConfig = {},
): ResolvedChannelStreamingConfig {
  const footer = raw.footer ?? {};
  const rawStreaming = raw.streaming;

  let streaming = false;
  let nested: { enabled?: boolean; status?: boolean; content?: boolean } = {};

  if (rawStreaming === true) {
    streaming = true;
  } else if (rawStreaming === false || rawStreaming == null) {
    streaming = false;
  } else if (typeof rawStreaming === "object") {
    nested = rawStreaming;
    // 嵌套对象：enabled 显式 false 时关闭流式，否则默认开启
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

/**
 * 是否应在 stream 气泡中展示状态行。
 *
 * footerStatus 或（streaming 且 streamingStatus）任一为 true 即展示。
 *
 * @param cfg - 解析后的流式配置
 * @returns 是否展示 statusLine
 */
export function shouldShowStreamStatusLine(cfg: ResolvedChannelStreamingConfig): boolean {
  return cfg.footerStatus || (cfg.streaming && cfg.streamingStatus);
}

/**
 * 将 status / answer / footer 拼成单条纯文本 stream 内容。
 *
 * 各段 trim 后非空才纳入；段间用 `sectionSeparator` 连接（默认 `---`）。
 *
 * @param params.statusLine - 状态行
 * @param params.answerText - 回答正文
 * @param params.footerLine - 脚注行
 * @param params.includeStatus - 是否包含状态段，默认 true
 * @param params.includeAnswer - 是否包含回答段，默认 true
 * @param params.includeFooter - 是否包含脚注段，默认 true
 * @param params.sectionSeparator - 段间分隔符
 * @returns 拼接后的纯文本
 */
export function buildStreamBubbleText(params: {
  statusLine?: string;
  answerText?: string;
  footerLine?: string;
  includeStatus?: boolean;
  includeAnswer?: boolean;
  includeFooter?: boolean;
  sectionSeparator?: string;
}): string {
  const separator = params.sectionSeparator ?? DEFAULT_SECTION_SEPARATOR;
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
      parts.push(separator);
    }
    parts.push(answer);
  }
  if (includeFooter && footer) {
    if (parts.length > 0) {
      parts.push(separator);
    }
    parts.push(footer);
  }

  return parts.join("");
}

/**
 * 根据 streaming 配置将 status / answer / footer 写入 `state.content`。
 *
 * 由 stream session 在每次状态/正文变更后调用，保证 IM 平台收到的 content 与配置一致。
 *
 * @param state - 可变 stream 组合状态（写入 content）
 * @param streamingConfig - 解析后的流式配置
 * @param options.includeAnswer - 强制包含/排除回答段
 * @param options.includeFooter - 是否尝试附加耗时脚注
 * @param options.includeStatus - 是否包含状态段
 * @param options.finishedAt - 关流时间戳（脚注计算用）
 * @param options.formatElapsedFooter - 耗时脚注格式化函数
 * @param options.sectionSeparator - 段间分隔符
 */
export function syncStreamContent(
  state: StreamCompositionState,
  streamingConfig: ResolvedChannelStreamingConfig,
  options: {
    includeAnswer?: boolean;
    includeFooter?: boolean;
    includeStatus?: boolean;
    finishedAt?: number;
    formatElapsedFooter?: (elapsedMs: number) => string;
    sectionSeparator?: string;
  } = {},
): void {
  // 回答段：显式 includeAnswer=true 强制展示；否则需 streaming+streamingContent 且有正文
  const showAnswer =
    options.includeAnswer === true ||
    (options.includeAnswer !== false &&
      streamingConfig.streaming &&
      streamingConfig.streamingContent &&
      Boolean(state.answerText?.trim()));

  const statusLine =
    options.includeStatus !== false && shouldShowStreamStatusLine(streamingConfig)
      ? state.statusLine
      : undefined;

  const footerLine =
    options.includeFooter === true &&
    streamingConfig.footerElapsed &&
    state.replyStartedAt != null &&
    options.formatElapsedFooter
      ? options.formatElapsedFooter((options.finishedAt ?? Date.now()) - state.replyStartedAt)
      : undefined;

  state.content = buildStreamBubbleText({
    statusLine,
    answerText: showAnswer ? state.answerText : undefined,
    footerLine,
    includeStatus: options.includeStatus !== false,
    includeAnswer: showAnswer,
    includeFooter: Boolean(footerLine),
    sectionSeparator: options.sectionSeparator,
  });
}
