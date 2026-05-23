/**
 * WeCom Webhook 回复管线（OpenClaw SDK + 企微 outbound 适配）。
 */

import type {
  GetReplyOptions,
  OpenClawConfig,
  ReplyDispatcherWithTypingOptions,
  ReplyPayload,
} from "../runtime-api.js";
import {
  createChannelMessageReplyPipeline,
  createReplyPrefixContext,
  createTypingLifecycleHooks,
} from "../runtime-api.js";
import {
  formatChannelProgressDraftLineForEntry,
  isChannelProgressDraftWorkToolName,
} from "openclaw/plugin-sdk/channel-streaming";
import { getWeComRuntime } from "../runtime.js";
import type { WecomWebhookTarget } from "./types.js";
import { STREAM_MAX_BYTES } from "./types.js";
import { deliverWecomReply } from "../outbound/reply-deliver.js";
import { getMonitorState } from "./gateway.js";
import { truncateUtf8Bytes } from "./helpers.js";
import {
  resolveWecomStreamingConfig,
  shouldShowWecomStatusLine,
  syncWecomStreamContent,
  WECOM_STATUS_COMPACTING,
  WECOM_STATUS_GENERATING,
  WECOM_STATUS_THINKING,
  WECOM_STATUS_TOOL,
} from "../streaming-config.js";

export type CreateWecomReplyDispatcherParams = {
  target: WecomWebhookTarget;
  streamId: string;
  chatType: string;
  rawBody: string;
  tableMode: Parameters<
    import("../runtime-api.js").PluginRuntime["channel"]["text"]["convertMarkdownTables"]
  >[1];
  cfg: OpenClawConfig;
  agentId: string;
};

export type WecomReplyDispatchBundle = {
  dispatcherOptions: ReplyDispatcherWithTypingOptions;
  replyOptions: Omit<GetReplyOptions, "onBlockReply"> & { disableBlockStreaming: boolean };
};

/**
 * 更新 Webhook stream 状态栏并同步 content。
 */
function updateWebhookStatusLine(
  streamId: string,
  target: WecomWebhookTarget,
  nextStatus: string,
): void {
  const streamingConfig = resolveWecomStreamingConfig(target.account);
  if (!shouldShowWecomStatusLine(streamingConfig)) {
    return;
  }
  const { streamStore } = getMonitorState();
  streamStore.updateStream(streamId, (s) => {
    s.statusLine = nextStatus;
    syncWecomStreamContent(s, streamingConfig, { includeAnswer: false });
    s.content = truncateUtf8Bytes(s.content, STREAM_MAX_BYTES) || s.content;
  });
}

/**
 * 创建 WeCom Webhook 回复分发器。
 */
export function createWecomReplyDispatcher(
  params: CreateWecomReplyDispatcherParams,
): WecomReplyDispatchBundle {
  const core = getWeComRuntime();
  const { target, streamId, chatType, rawBody, tableMode, cfg, agentId } = params;
  const streamingConfig = resolveWecomStreamingConfig(target.account);
  const showStatusLine = shouldShowWecomStatusLine(streamingConfig);
  const showCompactionStatus =
    streamingConfig.footerStatus ||
    (streamingConfig.streaming && streamingConfig.streamingStatus);
  const { streamStore } = getMonitorState();

  const prefixContext = createReplyPrefixContext({ cfg, agentId });
  const { typingCallbacks } = createChannelMessageReplyPipeline({
    cfg,
    agentId,
    channel: "wecom",
    accountId: target.account.accountId,
  });

  const lifecycle = createTypingLifecycleHooks({
    onTypingIdle: typingCallbacks?.onIdle,
    onCleanup: typingCallbacks?.onCleanup,
    onError: async (err) => {
      target.runtime.error?.(
        `[webhook] Agent reply failed (streamId=${streamId}): ${String(err)}`,
      );
    },
  });

  return {
    dispatcherOptions: {
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: async () => {
        await typingCallbacks?.onReplyStart?.();
        streamStore.updateStream(streamId, (s) => {
          s.replyStartedAt = s.replyStartedAt ?? Date.now();
          if (shouldShowWecomStatusLine(streamingConfig)) {
            s.statusLine = WECOM_STATUS_THINKING;
            syncWecomStreamContent(s, streamingConfig, { includeAnswer: false });
            s.content = truncateUtf8Bytes(s.content, STREAM_MAX_BYTES) || s.content;
          }
        });
      },
      deliver: async (payload: ReplyPayload, info) => {
        await deliverWecomReply({
          payload,
          info,
          target,
          streamId,
          chatType,
          rawBody,
          tableMode,
        });
      },
      onError: lifecycle.onError,
      onIdle: lifecycle.onIdle,
      onCleanup: lifecycle.onCleanup,
    },
    replyOptions: {
      onModelSelected: prefixContext.onModelSelected,
      disableBlockStreaming: false,
      ...(showStatusLine ? { suppressDefaultToolProgressMessages: true as const } : {}),
      onToolStart: showStatusLine
        ? async (payload: {
            name?: string;
            phase?: string;
            args?: Record<string, unknown>;
            detailMode?: "explain" | "raw";
          }) => {
            if (!isChannelProgressDraftWorkToolName(payload.name)) {
              return;
            }
            let nextStatus = WECOM_STATUS_TOOL;
            if (streamingConfig.streaming && streamingConfig.streamingStatus) {
              const formatted = formatChannelProgressDraftLineForEntry(
                target.account.config,
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
            updateWebhookStatusLine(streamId, target, nextStatus);
          }
        : undefined,
      onAssistantMessageStart: showStatusLine
        ? async () => {
            updateWebhookStatusLine(streamId, target, WECOM_STATUS_GENERATING);
          }
        : undefined,
      onCompactionStart: showCompactionStatus
        ? async () => {
            updateWebhookStatusLine(streamId, target, WECOM_STATUS_COMPACTING);
          }
        : undefined,
      onCompactionEnd: showCompactionStatus
        ? async () => {
            updateWebhookStatusLine(streamId, target, WECOM_STATUS_THINKING);
          }
        : undefined,
    },
  };
}

/** @deprecated 使用 createWecomReplyDispatcher */
export const createWecomReplyPipeline = createWecomReplyDispatcher;
