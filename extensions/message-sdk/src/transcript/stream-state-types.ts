/**
 * @module transcript/stream-state-types
 *
 * Transcript 流式输出状态类型（渠道无关）。
 *
 * **职责**：定义流式回复链路中关流决策、气泡拼接、配置解析所需的 TypeScript 类型，
 * 供 WeCom / Feishu 等插件与 SDK 共享同一套契约。
 *
 * **适用场景**：stream session 状态机、finish 文案决策、streaming 配置 resolve。
 *
 * **上下游**：
 * - 上游：渠道 openclaw.json streaming/footer 配置
 * - 下游：`streaming-config`、`finish-stream`、`reply-dispatcher-factory`
 *
 * **关键导出**：`StreamFinishState`、`StreamCompositionState`、`ResolvedChannelStreamingConfig` 等
 */

/**
 * 关流（finish=true）文案决策所需的状态快照。
 *
 * 由 dispatch / media 管线在关流前填充，供 `resolveStreamFinishText` 选择用户可见文案。
 */
export type StreamFinishState = {
  /** 已累积的 Assistant 纯文本（trim 后用于判断是否为空回复） */
  accumulatedText?: string;
  /** 是否已发送媒体附件 */
  hasMedia?: boolean;
  /** 媒体发送是否部分/全部失败 */
  hasMediaFailed?: boolean;
  /** 是否已发送模板卡片 */
  hasTemplateCard?: boolean;
  /** 媒体错误用户可见摘要 */
  mediaErrorSummary?: string;
  /** dispatch onError 用户可见摘要 */
  dispatchErrorSummary?: string;
  /** 入站消息是否含媒体（用于空回复时区分 mediaParseFailed） */
  inboundHadMedia?: boolean;
  /** 回复开始时间戳（用于耗时脚注） */
  replyStartedAt?: number;
};

/**
 * stream 气泡 content 同步状态。
 *
 * 由 `syncStreamContent` 写入 `content` 字段，供 IM 平台 stream API 推送。
 */
export type StreamCompositionState = {
  /** 当前状态行（thinking / tool / generating 等） */
  statusLine?: string;
  /** 已累积的回答正文 */
  answerText?: string;
  /** 拼接后的完整 stream 气泡文本 */
  content: string;
  /** 回复开始时间戳 */
  replyStartedAt?: number;
};

/**
 * 嵌套 streaming 配置（Feishu / WeCom 对齐）。
 *
 * @remarks CLI dot-path 写入时可能为 `{ enabled?, status?, content? }` 对象形态。
 */
export type ChannelStreamingNestedConfig = {
  /** 嵌套总开关；false 时等效 streaming=false */
  enabled?: boolean;
  /** 是否在 stream 气泡中展示状态行 */
  status?: boolean;
  /** 是否在 stream 气泡中展示回答正文 */
  content?: boolean;
};

/** footer（气泡脚注）配置 */
export type ChannelFooterConfig = {
  /** 是否展示状态类脚注（与 streamingStatus 组合决定 statusLine） */
  status?: boolean;
  /** 是否在关流时附加耗时脚注 */
  elapsed?: boolean;
};

/** 原始渠道 streaming 配置片段（openclaw.json 子集） */
export type ChannelStreamingRawConfig = {
  /** 流式总开关：boolean 或嵌套对象 */
  streaming?: boolean | ChannelStreamingNestedConfig;
  /** 脚注配置 */
  footer?: ChannelFooterConfig;
};

/**
 * 解析后的流式配置（布尔开关已展开）。
 *
 * 由 `resolveChannelStreamingConfig` 产出，供整条 transcript 管线只读使用。
 */
export type ResolvedChannelStreamingConfig = {
  /** 流式模式总开关 */
  streaming: boolean;
  /** 流式模式下是否推送状态行 */
  streamingStatus: boolean;
  /** 流式模式下是否推送回答内容 */
  streamingContent: boolean;
  /** footer 状态行开关（非流式模式下也可单独开启） */
  footerStatus: boolean;
  /** 关流时是否附加耗时脚注 */
  footerElapsed: boolean;
};

/** 关流模板键（最小集，finish-stream 必需） */
export type StreamFinishTemplates = {
  /** 空回复兜底文案 */
  emptyReply: string;
  /** 已发送卡片时的占位文案 */
  cardSent: string;
  /** 已发送媒体时的占位文案 */
  mediaSent: string;
  /** 入站含媒体但解析失败时的文案（含 `{emptyReply}` 占位） */
  mediaParseFailed: string;
  /** 耗时脚注模板（含 `{elapsed}` 秒数占位） */
  finishFooter: string;
};

/**
 * 完整用户可见模板键（扩展集）。
 *
 * 涵盖 thinking / tool / timeout / dispatchError 等 transcript 全生命周期文案。
 */
export type ChannelStatusTemplates = StreamFinishTemplates & {
  thinking: string;
  received: string;
  tool: string;
  reading: string;
  generating: string;
  compaction: string;
  welcome: string;
  mediaDelivered: string;
  processedComplete: string;
  timeout: string;
  dispatchError: string;
  mediaErrorNoAccess: string;
  mediaErrorReason: string;
  mediaErrorGeneric: string;
  [key: string]: string;
};
