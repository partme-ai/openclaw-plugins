/**
 * @module webhook/reply-pipeline
 *
 * WeCom **Webhook** 回复管线 — OpenClaw SDK + message-sdk transcript + StreamStore deliver。
 *
 * **职责**：
 * - 创建 Webhook 专用的 `createTranscriptReplyDispatcherHooks`  bundle
 * - block deliver 写入 `StreamStore`（content / statusLine / images）
 * - 委托 `deliverWecomReply` 完成媒体与流式内容落盘
 *
 * **与 message-sdk 关系**：
 * - `createTranscriptReplyDispatcherHooks`（transcript）统一 thinking/tool/status
 * - `truncateUtf8Bytes`（util）限制 stream content 字节（STREAM_MAX_BYTES）
 * - `syncWecomStreamContent` 合成 status + answer 展示文本
 *
 * **关键导出**：`createWecomReplyDispatcher`
 */

import type {
  GetReplyOptions,
  OpenClawConfig,
  ReplyDispatcherWithTypingOptions,
  ReplyPayload,
} from "../runtime/runtime-api.js";
import {
  createChannelMessageReplyPipeline,
  createReplyPrefixContext,
} from "../runtime/runtime-api.js";
import {
  createTranscriptReplyDispatcherHooks,
  shouldShowStreamStatusLine,
} from "@partme.ai/openclaw-message-sdk/transcript";
import { truncateUtf8Bytes } from "@partme.ai/openclaw-message-sdk/util";
import {
  formatChannelProgressDraftLineForEntry,
  isChannelProgressDraftWorkToolName,
} from "openclaw/plugin-sdk/channel-streaming";
import { getWeComRuntime } from "../runtime.js";
import type { WecomWebhookTarget } from "./types.js";
import { STREAM_MAX_BYTES } from "./types.js";
import { deliverWecomReply } from "../outbound/reply-deliver.js";
import { getMonitorState } from "./gateway.js";
import {
  resolveWecomStreamingConfig,
  syncWecomStreamContent,
} from "../config/streaming-config.js";
import {
  resolveWecomTemplates,
} from "../config/templates.js";

/** 创建 Webhook 回复分发器的入参。 */
export type CreateWecomReplyDispatcherParams = {
  /** Webhook Target 上下文 */
  target: WecomWebhookTarget;
  /** 当前 stream ID */
  streamId: string;
  /** 会话类型（group / direct） */
  chatType: string;
  /** 用户原始消息正文（媒体兜底等） */
  rawBody: string;
  /** Markdown 表格转换模式 */
  tableMode: Parameters<
    import("../runtime/runtime-api.js").PluginRuntime["channel"]["text"]["convertMarkdownTables"]
  >[1];
  /** Agent 调度用 config（含 tools.deny message） */
  cfg: OpenClawConfig;
  /** 路由到的 Agent ID */
  agentId: string;
};

/** `createWecomReplyDispatcher` 返回值。 */
export type WecomReplyDispatchBundle = {
  dispatcherOptions: ReplyDispatcherWithTypingOptions;
  replyOptions: Omit<GetReplyOptions, "onBlockReply"> & { disableBlockStreaming: boolean };
};

/**
 * 更新 Webhook stream 的状态栏并同步 content（streaming.status 模式）。
 *
 * @param streamId - stream ID
 * @param target - Webhook Target
 * @param nextStatus - 新状态栏文案
 */
function updateWebhookStatusLine(
  streamId: string,
  target: WecomWebhookTarget,
  nextStatus: string,
): void {
  const streamingConfig = resolveWecomStreamingConfig(target.account);
  const templates = resolveWecomTemplates(target.account);
  if (!shouldShowStreamStatusLine(streamingConfig)) {
    return;
  }
  const { streamStore } = getMonitorState();
  streamStore.updateStream(streamId, (s) => {
    s.statusLine = nextStatus;
    syncWecomStreamContent(s, streamingConfig, { includeAnswer: false, templates });
    s.content = truncateUtf8Bytes(s.content, STREAM_MAX_BYTES) || s.content;
  });
}

/**
 * 创建 WeCom Webhook 回复分发器。
 *
 * WHY：Webhook 无 WS 实时 push，所有 deliver 必须写入 StreamStore，供 stream_refresh
 * 轮询或 response_url 最终推送读取。
 *
 * @param params - 见 {@link CreateWecomReplyDispatcherParams}
 * @returns dispatcherOptions 与 replyOptions
 */
export function createWecomReplyDispatcher(
  params: CreateWecomReplyDispatcherParams,
): WecomReplyDispatchBundle {
  const core = getWeComRuntime();
  const { target, streamId, chatType, rawBody, tableMode, cfg, agentId } = params;
  const streamingConfig = resolveWecomStreamingConfig(target.account);
  const templates = resolveWecomTemplates(target.account);
  const { streamStore } = getMonitorState();

  const bundle = createTranscriptReplyDispatcherHooks({
    cfg,
    agentId,
    channel: "wecom",
    accountId: target.account.accountId,
    target,
    channelConfig: target.account.config,
    streamingConfig,
    templates: {
      thinking: templates.thinking,
      generating: templates.generating,
      compaction: templates.compaction,
      tool: templates.tool,
    },
    createReplyPipeline: createChannelMessageReplyPipeline as Parameters<
      typeof createTranscriptReplyDispatcherHooks
    >[0]["createReplyPipeline"],
    createPrefixContext: createReplyPrefixContext as Parameters<
      typeof createTranscriptReplyDispatcherHooks
    >[0]["createPrefixContext"],
    resolveHumanDelay: (c, id) => core.channel.reply.resolveHumanDelayConfig(c as OpenClawConfig, id),
    isProgressWorkTool: isChannelProgressDraftWorkToolName,
    formatToolProgressLine: formatChannelProgressDraftLineForEntry as Parameters<
      typeof createTranscriptReplyDispatcherHooks
    >[0]["formatToolProgressLine"],
    onPipelineError: (err) => {
      target.runtime.error?.(
        `[webhook] Agent reply failed (streamId=${streamId}): ${String(err)}`,
      );
    },
    onReplyStartExtra: async () => {
      streamStore.updateStream(streamId, (s) => {
        s.replyStartedAt = s.replyStartedAt ?? Date.now();
        if (shouldShowStreamStatusLine(streamingConfig)) {
          s.statusLine = templates.thinking;
          syncWecomStreamContent(s, streamingConfig, { includeAnswer: false, templates });
          s.content = truncateUtf8Bytes(s.content, STREAM_MAX_BYTES) || s.content;
        }
      });
    },
    updateStatusLine: (statusLine) => updateWebhookStatusLine(streamId, target, statusLine),
    deliver: async (payload: unknown, info: unknown) => {
      await deliverWecomReply({
        payload: payload as ReplyPayload,
        info: info as { kind?: string },
        target,
        streamId,
        chatType,
        rawBody,
        tableMode,
      });
    },
  });

  return {
    dispatcherOptions: bundle.dispatcherOptions as ReplyDispatcherWithTypingOptions,
    replyOptions: bundle.replyOptions as WecomReplyDispatchBundle["replyOptions"],
  };
}
