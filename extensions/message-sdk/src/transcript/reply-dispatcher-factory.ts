/**
 * @module transcript/reply-dispatcher-factory
 *
 * Transcript 回复管线 hooks 工厂（OpenClaw SDK 组合 + 渠道 deliver 注入）。
 *
 * **职责**：将 OpenClaw `createChannelMessageReplyPipeline`、prefix context、
 * typing lifecycle 与渠道 `deliver` / `updateStatusLine` 组合为
 * `dispatcherOptions` + `replyOptions` bundle，供插件传入 dispatch。
 *
 * **适用场景**：WeCom / Feishu transcript 通道在创建 reply dispatcher 时
 * 一次性获取标准 hooks，避免各插件重复拼装 onToolStart / onCompaction 逻辑。
 *
 * **上下游**：
 * - 上游：OpenClaw PluginRuntime channel API、渠道 streaming 配置与模板
 * - 下游：OpenClaw reply dispatcher、stream status line 推送
 *
 * **关键导出**：`createTranscriptReplyDispatcherHooks`、`TranscriptReplyPipelineParams`
 */

import { createTypingLifecycleHooks } from "../lifecycle/typing-lifecycle.js";
import type { ResolvedChannelStreamingConfig } from "./stream-state-types.js";
import { shouldShowStreamStatusLine } from "./streaming-config.js";
import { resolveToolStatusLine } from "./templates.js";

/** OpenClaw createChannelMessageReplyPipeline 返回的 typing 回调形状 */
export type ChannelMessageTypingCallbacks = {
  onReplyStart?: () => void | Promise<void>;
  onIdle?: () => void | Promise<void>;
  onCleanup?: () => void;
  onError?: (err: unknown) => void | Promise<void>;
};

/**
 * 工具进度格式化函数（可选，由 openclaw/plugin-sdk/channel-streaming 提供）。
 *
 * @param config - 渠道账号 config
 * @param entry - tool 事件条目
 * @param options.detailMode - explain / raw 详情模式
 * @returns 格式化后的状态行，无法格式化时 undefined
 */
export type FormatToolProgressLine = (
  config: unknown,
  entry: {
    event: "tool";
    name?: string;
    phase?: string;
    args?: Record<string, unknown>;
  },
  options?: { detailMode?: "explain" | "raw" },
) => string | undefined;

/**
 * Transcript 回复管线创建参数。
 *
 * 渠道插件注入 deliver / updateStatusLine，SDK 负责 hooks 组合。
 */
export type TranscriptReplyPipelineParams<TTarget = unknown> = {
  cfg: unknown;
  agentId: string;
  channel: string;
  accountId: string;
  target: TTarget;
  /** 渠道账号 config（传给 tool progress formatter） */
  channelConfig?: unknown;
  streamingConfig: ResolvedChannelStreamingConfig;
  templates: {
    thinking: string;
    generating: string;
    compaction: string;
    tool: string;
  };
  /** 外部 typing 回调；未提供时使用 createReplyPipeline 内置回调 */
  typingCallbacks?: ChannelMessageTypingCallbacks;
  /** onReplyStart 额外钩子（如发送 thinking 消息） */
  onReplyStartExtra?: () => void | Promise<void>;
  /** 渠道消息投递函数 */
  deliver: (payload: unknown, info: unknown) => void | Promise<void>;
  /** pipeline 错误回调（与 typing onError 链式调用） */
  onPipelineError?: (err: unknown) => void | Promise<void>;
  /** 更新 stream 状态行（thinking / tool / generating 等） */
  updateStatusLine: (statusLine: string) => void | Promise<void>;
  formatToolProgressLine?: FormatToolProgressLine;
  createReplyPipeline: (params: {
    cfg: unknown;
    agentId: string;
    channel: string;
    accountId: string;
  }) => { typingCallbacks?: ChannelMessageTypingCallbacks };
  createPrefixContext: (params: { cfg: unknown; agentId: string }) => {
    responsePrefix?: string;
    responsePrefixContextProvider?: unknown;
    onModelSelected?: unknown;
  };
  resolveHumanDelay?: (cfg: unknown, agentId: string) => unknown;
  /** 过滤非 progress 类 tool（如 internal） */
  isProgressWorkTool?: (toolName?: string) => boolean;
};

/** createTranscriptReplyDispatcherHooks 返回值 */
export type TranscriptReplyDispatchBundle = {
  /** 传给 OpenClaw createReplyDispatcher 的 options */
  dispatcherOptions: Record<string, unknown>;
  /** 传给 reply pipeline 的 hooks options */
  replyOptions: Record<string, unknown>;
};

/**
 * 创建 Transcript 通道回复分发 bundle（dispatcher + reply hooks）。
 *
 * @typeParam TTarget - 渠道投递目标类型（如 WeCom chat target）
 * @param params - 管线参数，见 {@link TranscriptReplyPipelineParams}
 * @returns dispatcherOptions 与 replyOptions
 *
 * @example
 * ```ts
 * const { dispatcherOptions, replyOptions } = createTranscriptReplyDispatcherHooks({
 *   cfg, agentId, channel, accountId, target,
 *   streamingConfig, templates, deliver, updateStatusLine,
 *   createReplyPipeline, createPrefixContext,
 * });
 * ```
 */
export function createTranscriptReplyDispatcherHooks<TTarget>(
  params: TranscriptReplyPipelineParams<TTarget>,
): TranscriptReplyDispatchBundle {
  const {
    cfg,
    agentId,
    channel,
    accountId,
    streamingConfig,
    templates,
    typingCallbacks: externalTypingCallbacks,
    onReplyStartExtra,
    deliver,
    onPipelineError,
    updateStatusLine,
    formatToolProgressLine,
    createReplyPipeline,
    createPrefixContext,
    resolveHumanDelay,
    isProgressWorkTool,
  } = params;

  const showStatusLine = shouldShowStreamStatusLine(streamingConfig);
  const showCompactionStatus =
    streamingConfig.footerStatus ||
    (streamingConfig.streaming && streamingConfig.streamingStatus);

  const prefixContext = createPrefixContext({ cfg, agentId });
  const { typingCallbacks: pipelineTypingCallbacks } = createReplyPipeline({
    cfg,
    agentId,
    channel,
    accountId,
  });
  const typingCallbacks = externalTypingCallbacks ?? pipelineTypingCallbacks;

  const lifecycle = createTypingLifecycleHooks({
    onTypingIdle: typingCallbacks?.onIdle,
    onCleanup: typingCallbacks?.onCleanup,
    onError: async (err) => {
      await typingCallbacks?.onError?.(err);
      await onPipelineError?.(err);
    },
  });

  return {
    dispatcherOptions: {
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      ...(resolveHumanDelay ? { humanDelay: resolveHumanDelay(cfg, agentId) } : {}),
      onReplyStart: async () => {
        await typingCallbacks?.onReplyStart?.();
        await onReplyStartExtra?.();
      },
      deliver,
      onError: lifecycle.onError,
      onIdle: lifecycle.onIdle,
      onCleanup: lifecycle.onCleanup,
    },
    replyOptions: {
      onModelSelected: prefixContext.onModelSelected,
      disableBlockStreaming: false,
      // 展示 statusLine 时由 SDK 统一推送 tool 进度，抑制 OpenClaw 默认 tool 消息
      ...(showStatusLine ? { suppressDefaultToolProgressMessages: true as const } : {}),
      onToolStart: showStatusLine
        ? async (payload: {
            name?: string;
            phase?: string;
            args?: Record<string, unknown>;
            detailMode?: "explain" | "raw";
          }) => {
            if (isProgressWorkTool && !isProgressWorkTool(payload.name)) {
              return;
            }
            let nextStatus = resolveToolStatusLine(templates.tool, payload.name);
            if (
              streamingConfig.streaming &&
              streamingConfig.streamingStatus &&
              formatToolProgressLine
            ) {
              const formatted = formatToolProgressLine(
                params.channelConfig,
                {
                  event: "tool",
                  name: payload.name,
                  phase: payload.phase,
                  args: payload.args,
                },
                { detailMode: payload.detailMode },
              );
              if (formatted) {
                nextStatus = formatted;
              }
            }
            await updateStatusLine(nextStatus);
          }
        : undefined,
      onAssistantMessageStart: showStatusLine
        ? async () => {
            await updateStatusLine(templates.generating);
          }
        : undefined,
      onCompactionStart: showCompactionStatus
        ? async () => {
            await updateStatusLine(templates.compaction);
          }
        : undefined,
      onCompactionEnd: showCompactionStatus
        ? async () => {
            // compaction 结束后回到 thinking，等待下一轮 model 输出
            await updateStatusLine(templates.thinking);
          }
        : undefined,
    },
  };
}
