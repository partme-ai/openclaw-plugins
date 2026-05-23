/**
 * @module ws-reply-pipeline
 *
 * WeCom **WebSocket** 回复管线 — OpenClaw SDK + message-sdk transcript 工厂 + 企微 WS deliver。
 *
 * **职责**：
 * - 将 Agent block/stream 输出桥接到企微 WS 流式气泡（thinking / status / answer）
 * - 媒体 block 走 `uploadAndSendMedia` + 可选 native image item
 * - 关流（finish）与 StreamExpiredError（846608）降级为主动 `sendMessage`
 *
 * **与 message-sdk 关系**：
 * - 使用 `createTranscriptReplyDispatcherHooks`（transcript 模块）统一 thinking/tool/status 文案
 * - `shouldShowStreamStatusLine` 控制状态栏是否参与气泡合成
 * - 媒体本地读取依赖 {@link getExtendedMediaLocalRoots} / Path Guard
 *
 * **关键流程**：
 * 1. `createWsWecomReplyDispatcher` → 注册 onReplyStart / deliver / onError hooks
 * 2. deliver 累积 `accumulatedText` + 推送中间帧（非阻塞）或媒体批次
 * 3. `finalizeWsWecomReply` → 模板卡片处理 + `finishWsThinkingStream`
 *
 * **关键导出**：`createWsWecomReplyDispatcher`、`finishWsThinkingStream`、
 * `finalizeWsWecomReply`、`WsDeliverContext`、`WsWecomReplyDispatchBundle`
 */

import type { WSClient, WsFrame } from "@wecom/aibot-node-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime";
import {
  createTranscriptReplyDispatcherHooks,
  shouldShowStreamStatusLine,
} from "@partme.ai/openclaw-message-sdk/transcript";
import {
  formatChannelProgressDraftLineForEntry,
  isChannelProgressDraftWorkToolName,
} from "openclaw/plugin-sdk/channel-streaming";
import { THINKING_MESSAGE } from "../types/const.js";
import type { MessageState } from "../types/interface.js";
import { getExtendedMediaLocalRoots } from "../media/media-path-guard.js";
import { getWeComRuntime } from "../runtime.js";
import {
  createChannelMessageReplyPipeline,
  createReplyPrefixContext,
  type GetReplyOptions,
  type ReplyDispatcherWithTypingOptions,
  type ReplyPayload,
} from "../runtime/runtime-api.js";
import { uploadAndSendMedia } from "../media/media-uploader.js";
import type { MessageBody } from "../dispatch/message-parser.js";
import { sendWeComReply, sendWeComReplyNonBlocking, StreamExpiredError } from "../dispatch/message-sender.js";
import { processTemplateCardsIfNeeded } from "../outbound/template-card-manager.js";
import { maskTemplateCardBlocks } from "../outbound/template-card-parser.js";
import {
  buildWecomStreamBubbleText,
  resolveWecomStreamingConfig,
  resolveWecomStreamPlaceholderText,
  type ResolvedWecomStreamingConfig,
} from "../config/streaming-config.js";
import {
  buildDispatchErrorSummary,
  buildMediaErrorSummary,
  resolveWecomTemplates,
  type ResolvedWecomTemplates,
} from "../config/templates.js";
import { resolveThinkingFinishText } from "../dispatch/finish-thinking.js";
import type { ResolvedWeComAccount, WeComConfig } from "../config/wecom-config.js";
import { buildWecomNativeReplyImageItem } from "../media/ws-media.js";

/** WS deliver 回调所需的上下文（stream 状态 + 账号 + 流式配置）。 */
export type WsDeliverContext = {
  /** 企微 WS 客户端 */
  wsClient: WSClient;
  /** 当前入站帧（含 body / chatid 等） */
  frame: WsFrame;
  /** 单条消息的流式/累积状态 */
  state: MessageState;
  /** 解析后的企微账号 */
  account: ResolvedWeComAccount;
  /** OpenClaw 运行时（日志） */
  runtime: RuntimeEnv;
  /** 流式展示配置（streaming / status / footer） */
  streamingConfig: ResolvedWecomStreamingConfig;
  /** 中文模板（thinking / generating / tool 等） */
  templates: ResolvedWecomTemplates;
};

/** 创建 WS 回复分发器的入参。 */
export type CreateWsWecomReplyDispatcherParams = {
  /** 企微 WS 客户端 */
  wsClient: WSClient;
  /** 触发回复的入站帧 */
  frame: WsFrame;
  /** 消息级流式状态（streamId / accumulatedText 等） */
  state: MessageState;
  /** 解析后的企微账号 */
  account: ResolvedWeComAccount;
  /** OpenClaw 运行时 */
  runtime: RuntimeEnv;
  /** 全局 OpenClaw 配置 */
  config: OpenClawConfig;
  /** 路由到的 Agent ID */
  agentId: string;
};

/** `createWsWecomReplyDispatcher` 返回值：dispatcher + replyOptions + deliver 上下文。 */
export type WsWecomReplyDispatchBundle = {
  dispatcherOptions: ReplyDispatcherWithTypingOptions;
  replyOptions: Omit<GetReplyOptions, "onBlockReply"> & { disableBlockStreaming: boolean };
  deliverCtx: WsDeliverContext;
};

/**
 * 推送 stream 气泡中间帧或关流帧（`finish=false` / `true`）。
 *
 * WHY：企微 WS 流式要求非阻塞中间更新 + 最终 finish 帧；846608 过期后仅允许 finish
 * 或降级为主动 sendMessage（见 {@link finishWsThinkingStream}）。
 *
 * @param ctx - WS deliver 上下文
 * @param options.includeAnswer - 是否在气泡中包含累积答案
 * @param options.includeFooter - 是否包含页脚（elapsed 等）
 * @param options.includeStatus - 是否包含状态栏行
 * @param options.finish - 是否为关流帧
 * @returns Promise（中间帧失败仅打日志，finish 帧 StreamExpiredError 会向上抛）
 */
async function flushStreamingUpdate(
  ctx: WsDeliverContext,
  options: {
    includeAnswer?: boolean;
    includeFooter?: boolean;
    includeStatus?: boolean;
    finish?: boolean;
  } = {},
): Promise<void> {
  const { wsClient, frame, state, runtime, streamingConfig } = ctx;
  const body = frame.body as MessageBody;
  const isEventCallback = body.msgtype === "event";

  // 流已过期：不再推送中间帧（避免 846608 刷屏），仅 finish 路径可继续
  if (state.streamExpired && !options.finish) {
    return;
  }
  // 事件回调不走流式中间更新（无用户可见气泡上下文）
  if (isEventCallback && !options.finish) {
    return;
  }

  const showAnswer =
    options.includeAnswer === true ||
    (options.includeAnswer !== false &&
      streamingConfig.streaming &&
      streamingConfig.streamingContent &&
      Boolean(state.accumulatedText?.trim()));

  const answerText =
    showAnswer && state.accumulatedText
      ? maskTemplateCardBlocks(state.accumulatedText, (...args: unknown[]) => runtime.log?.(...args))
      : undefined;

  const statusLine =
    options.includeStatus !== false && shouldShowStreamStatusLine(streamingConfig)
      ? state.statusLine
      : undefined;

  let bubbleText = buildWecomStreamBubbleText({
    statusLine,
    answerText: answerText || undefined,
    includeStatus: options.includeStatus !== false,
    includeAnswer: showAnswer,
    includeFooter: false,
  });

  if (!bubbleText.trim()) {
    if (options.finish) {
      bubbleText = resolveThinkingFinishText(state, { streamingConfig, templates: ctx.templates });
    } else {
      return;
    }
  }

  try {
    if (options.finish) {
      await sendWeComReply({
        wsClient,
        frame,
        text: bubbleText,
        runtime,
        finish: true,
        streamId: state.streamId,
      });
    } else {
      await sendWeComReplyNonBlocking({
        wsClient,
        frame,
        text: bubbleText,
        runtime,
        finish: false,
        streamId: state.streamId!,
      });
    }
  } catch (err) {
    if (err instanceof StreamExpiredError) {
      state.streamExpired = true;
      if (options.finish) {
        throw err;
      }
    }
    runtime.log?.(
      `[wecom] ${options.finish ? "Final" : "Non-blocking intermediate"} stream update skipped or failed: ${String(err)}`,
    );
  }
}

/**
 * 更新状态栏并推送中间帧（streaming.status 模式）。
 *
 * @param ctx - WS deliver 上下文
 * @param nextStatus - 新的状态栏文案（如 tool 进度）
 * @returns Promise
 */
async function updateWecomStatusLine(ctx: WsDeliverContext, nextStatus: string): Promise<void> {
  if (!shouldShowStreamStatusLine(ctx.streamingConfig)) {
    return;
  }
  ctx.state.statusLine = nextStatus;
  await flushStreamingUpdate(ctx, { includeAnswer: false });
}

/**
 * 发送「思考中」占位流式帧（reply 开始且尚无正文时）。
 *
 * WHY：企微 WS 要求在 Agent 首 token 前给用户可见反馈，避免长时间空白气泡。
 *
 * @param params.wsClient - WS 客户端
 * @param params.frame - 入站帧
 * @param params.streamId - 流 ID
 * @param params.runtime - 运行时
 * @param params.account - 账号（占位文案配置）
 * @param params.state - 可选，用于写入 statusLine
 * @param params.templates - 中文模板
 * @returns Promise（失败仅打日志）
 */
async function sendThinkingReply(params: {
  wsClient: WSClient;
  frame: WsFrame;
  streamId: string;
  runtime: RuntimeEnv;
  account: ResolvedWeComAccount;
  state?: MessageState;
  templates: ResolvedWecomTemplates;
}): Promise<void> {
  const { wsClient, frame, streamId, runtime, account, state, templates } = params;
  const placeholder =
    resolveWecomStreamPlaceholderText(account.config, THINKING_MESSAGE) ?? THINKING_MESSAGE;
  try {
    await sendWeComReplyNonBlocking({
      wsClient,
      frame,
      text: placeholder,
      runtime,
      finish: false,
      streamId,
    });
  } catch (err) {
    runtime.log?.(`[wecom] Non-blocking thinking reply skipped or failed: ${String(err)}`);
  }
  if (state && shouldShowStreamStatusLine(resolveWecomStreamingConfig(account))) {
    state.statusLine = templates.thinking;
  }
}

/**
 * 上传并发送一批媒体文件（统一走 WS 主动发送通道）。
 *
 * WHY：Agent deliver 的 mediaUrl 可能是本地路径或 HTTP URL，需 Path Guard + 上传
 * 后由企微 WS API 投递；失败累积到 `mediaErrorSummary` 供 finish 帧展示。
 *
 * @param ctx - WS deliver 上下文
 * @param mediaUrls - 待发送的媒体 URL/路径列表
 * @returns Promise
 */
async function sendMediaBatch(ctx: WsDeliverContext, mediaUrls: string[]): Promise<void> {
  const { wsClient, frame, state, account, runtime, templates } = ctx;
  const body = frame.body as MessageBody;
  const chatId = body.chatid || body.from.userid;
  const mediaLocalRoots = await getExtendedMediaLocalRoots(account.config);

  runtime.log?.(
    `[wecom][debug] mediaLocalRoots=${JSON.stringify(mediaLocalRoots)}, mediaUrls=${JSON.stringify(mediaUrls)}`,
  );

  for (const mediaUrl of mediaUrls) {
    const result = await uploadAndSendMedia({
      wsClient,
      mediaUrl,
      chatId,
      mediaLocalRoots,
      log: (...args: unknown[]) => runtime.log?.(...args),
      errorLog: (...args: unknown[]) => runtime.error?.(...args),
    });

    if (result.ok) {
      state.hasMedia = true;
    } else {
      state.hasMediaFailed = true;
      runtime.error?.(
        `[wecom] Media send failed: url=${mediaUrl}, reason=${result.rejectReason || result.error}`,
      );
      const summary = buildMediaErrorSummary(mediaUrl, result, templates);
      state.mediaErrorSummary = state.mediaErrorSummary
        ? `${state.mediaErrorSummary}\n\n${summary}`
        : summary;
    }
  }
}

/**
 * 关闭 thinking 流；846608 过期时降级为主动 `sendMessage`（markdown）。
 *
 * WHY：企微 stream 有 TTL，过期后 finish 帧会失败，必须用 proactive 通道交付最终文本。
 *
 * @param ctx - WS deliver 上下文
 * @returns Promise
 */
export async function finishWsThinkingStream(ctx: WsDeliverContext): Promise<void> {
  const { wsClient, frame, state, runtime, streamingConfig } = ctx;
  const body = frame.body as MessageBody;
  const chatId = body.chatid || body.from.userid;
  const finishText = resolveThinkingFinishText(state, { streamingConfig, templates: ctx.templates });

  let expired = state.streamExpired;
  if (!expired) {
    try {
      await sendWeComReply({
        wsClient,
        frame,
        text: finishText,
        runtime,
        finish: true,
        streamId: state.streamId,
      });
    } catch (err) {
      if (err instanceof StreamExpiredError) {
        expired = true;
        state.streamExpired = true;
      } else {
        throw err;
      }
    }
  }
  if (expired) {
    runtime.log?.(`[wecom] Stream expired, sending final text via sendMessage (proactive)`);
    await wsClient.sendMessage(chatId, {
      msgtype: "markdown",
      markdown: { content: finishText },
    });
  }
}

/**
 * 模板卡片处理后关闭 WS thinking 流。
 *
 * @param ctx - WS deliver 上下文
 * @returns Promise
 */
export async function finalizeWsWecomReply(ctx: WsDeliverContext): Promise<void> {
  const cardResult = await processTemplateCardsIfNeeded({
    wsClient: ctx.wsClient,
    frame: ctx.frame,
    state: ctx.state,
    account: ctx.account,
    runtime: ctx.runtime,
  });
  if (cardResult) {
    ctx.state.accumulatedText = cardResult.remainingText;
  }
  await finishWsThinkingStream(ctx);
}

/**
 * 创建 WeCom WebSocket 回复分发器（transcript hooks + WS deliver 注入）。
 *
 * **关键 hook**：
 * - `onReplyStartExtra`：thinking 占位 + status 首帧
 * - `deliver`：文本累积 / 媒体批次 / 中间 stream 刷新
 * - `onError`：dispatch 错误摘要写入 state
 *
 * @param params - 见 {@link CreateWsWecomReplyDispatcherParams}
 * @returns dispatcherOptions、replyOptions 与 deliverCtx
 */
export function createWsWecomReplyDispatcher(
  params: CreateWsWecomReplyDispatcherParams,
): WsWecomReplyDispatchBundle {
  const { wsClient, frame, state, account, runtime, config, agentId } = params;
  const core = getWeComRuntime();
  const streamingConfig = resolveWecomStreamingConfig(account);
  const templates = resolveWecomTemplates(account);
  const deliverCtx: WsDeliverContext = {
    wsClient,
    frame,
    state,
    account,
    runtime,
    streamingConfig,
    templates,
  };

  let isShowThink = !(account.sendThinkingMessage ?? true);

  const bundle = createTranscriptReplyDispatcherHooks({
    cfg: config,
    agentId,
    channel: "wecom",
    accountId: account.accountId,
    target: deliverCtx,
    channelConfig: account.config,
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
    onReplyStartExtra: async () => {
      state.replyStartedAt = state.replyStartedAt ?? Date.now();
      if (shouldShowStreamStatusLine(streamingConfig)) {
        state.statusLine = templates.thinking;
      }
      if (!isShowThink && state.streamId && !state.accumulatedText) {
        try {
          await sendThinkingReply({
            wsClient,
            frame,
            streamId: state.streamId,
            runtime,
            account,
            state,
            templates,
          });
        } catch (e) {
          runtime.error?.(`[wecom] sendThinkingReply threw err: ${String(e)}`);
        }
        isShowThink = true;
      }
      if (shouldShowStreamStatusLine(streamingConfig)) {
        try {
          await flushStreamingUpdate(deliverCtx, { includeAnswer: false });
        } catch (e) {
          runtime.log?.(`[wecom] status flush on reply start failed: ${String(e)}`);
        }
      }
    },
    updateStatusLine: (statusLine) => updateWecomStatusLine(deliverCtx, statusLine),
    deliver: async (payload: unknown, info: unknown) => {
      const replyPayload = payload as ReplyPayload;
      const replyInfo = info as { kind?: string };
      runtime.log?.(
        `[openclaw -> plugin] kind=${replyInfo.kind}, payload=${JSON.stringify(replyPayload)}, info=${JSON.stringify(replyInfo)}`,
      );

      // block deliver：逐块拼接正文，供后续 stream 中间帧/关流帧合成
      if (replyPayload.text) {
        state.accumulatedText += `${replyPayload.text || ""}`;
      }

      const mediaUrls = replyPayload.mediaUrls?.length
        ? replyPayload.mediaUrls
        : replyPayload.mediaUrl
          ? [replyPayload.mediaUrl]
          : [];
      if (mediaUrls.length > 0) {
        try {
          await sendMediaBatch(deliverCtx, mediaUrls);
        } catch (mediaErr) {
          state.hasMediaFailed = true;
          const errMsg = String(mediaErr);
          const summary = `⚠️ 文件发送失败：内部处理异常，请升级 openclaw 到最新版本后重试。\n错误详情：${errMsg}`;
          state.mediaErrorSummary = state.mediaErrorSummary
            ? `${state.mediaErrorSummary}\n\n${summary}`
            : summary;
          runtime.error?.(`[wecom] sendMediaBatch threw: ${errMsg}`);
        }

        for (const mUrl of mediaUrls) {
          try {
            const nativeItem = await buildWecomNativeReplyImageItem({
              source: mUrl,
              log: { debug: (msg) => runtime.log?.(msg) },
            });
            if (nativeItem) {
              runtime.log?.(`[wecom] Native WS image item created for ${mUrl}`);
            }
          } catch {
            // 降级为 sendMediaBatch 标准流程（native item 为可选优化路径）
          }
        }
      }

      // 流未过期时推送中间帧，让用户实时看到 status + answer 增量
      if (!state.streamExpired) {
        try {
          if (streamingConfig.streaming && streamingConfig.streamingContent && state.accumulatedText) {
            await flushStreamingUpdate(deliverCtx, { includeAnswer: true, includeStatus: true });
          }
        } catch (err) {
          if (err instanceof StreamExpiredError) {
            state.streamExpired = true;
          }
          runtime.log?.(
            `[wecom] Non-blocking intermediate reply skipped or failed: ${String(err)}`,
          );
        }
      }
    },
  });

  const baseOnError = bundle.dispatcherOptions.onError as
    | ((err: unknown, info?: { kind?: string }) => void | Promise<void>)
    | undefined;
  bundle.dispatcherOptions.onError = async (err: unknown, info?: { kind?: string }) => {
    runtime.error?.(`[wecom] ${info?.kind ?? "reply"} reply failed: ${String(err)}`);
    const summary = buildDispatchErrorSummary(info?.kind ?? "dispatch", err, templates);
    state.dispatchErrorSummary = state.dispatchErrorSummary
      ? `${state.dispatchErrorSummary}\n\n${summary}`
      : summary;
    await baseOnError?.(err, info);
  };

  return {
    dispatcherOptions: bundle.dispatcherOptions as ReplyDispatcherWithTypingOptions,
    replyOptions: bundle.replyOptions as WsWecomReplyDispatchBundle["replyOptions"],
    deliverCtx,
  };
}
