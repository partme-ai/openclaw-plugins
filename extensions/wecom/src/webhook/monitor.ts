/**
 * @module webhook/monitor
 *
 * Webhook **核心消息处理**（入站、防抖、Agent 调度、流式输出、兜底）。
 *
 * **职责**：
 * - 入站解析、msgid 去重、防抖入队、access-policy 门禁
 * - `startAgentForStream`：媒体解密、路由、reply-pipeline、response_url 最终推送
 * - stream_refresh / enter_chat / template_card_event 分支
 *
 * **与 message-sdk 关系**：
 * - 队列/防抖：`StreamSessionStore`（queue）
 * - 去重：`claimWecomInboundMsgid`（createPersistentDedupe）
 * - 回复：`createWecomReplyDispatcher` → transcript hooks
 * - 媒体：`truncateUtf8Bytes`、Path Guard
 *
 * **关键流程**：handleInboundMessage → debounce → flushPending → startAgentForStream
 *
 * **关键导出**：`handleInboundMessage`、`handleStreamRefresh`、`handleEnterChat`、
 * `handleTemplateCardEvent`、`startAgentForStream`
 */

import { pathToFileURL } from "node:url";
import os from "node:os";
import { shouldShowStreamStatusLine } from "@partme.ai/openclaw-message-sdk/transcript";
import type {
  WecomWebhookTarget,
  WebhookInboundMessage,
} from "./types.js";
import {
  resolveWecomCommandAuthorization,
  buildWecomUnauthorizedCommandPrompt,
} from "./command-auth.js";
import {
  STREAM_MAX_BYTES,
  BOT_WINDOW_MS,
  REQUEST_TIMEOUT_MS,
} from "./types.js";
import { getMonitorState } from "./gateway.js";
import { wecomFetch } from "./http.js";
import {
  buildFallbackPrompt,
  extractLocalFilePathsFromText,
  looksLikeSendLocalFileIntent,
  computeTaskKey,
  isAgentConfigured,
  guessContentTypeFromPath,
  buildStreamReplyFromState,
  computeMd5,
  resolveWecomMediaMaxBytes,
  buildCfgForDispatch,
  processInboundMessage,
  resolveWecomSenderUserId,
  buildInboundBody,
  hasMedia,
  buildStreamResponse,
  buildStreamPlaceholderReply,
  buildStreamTextPlaceholderReply,
  truncateUtf8Bytes,
} from "./inbound-helpers.js";
import { processDynamicRouting } from "../config/dynamic-routing.js";
import { claimWecomInboundMsgid } from "./dedup.js";
import { checkWebhookDmPolicy, checkWebhookGroupPolicy } from "./access-policy.js";
import { createWecomReplyDispatcher } from "./reply-pipeline.js";
import {
  applyWecomWebhookEmptyContentFallback,
  resolveWecomEnterChatWelcomeText,
  resolveWecomStreamPlaceholderText,
  resolveWecomStreamingConfig,
  syncWecomStreamContent,
} from "../config/streaming-config.js";
import {
  resolveWecomTemplates,
  buildMediaErrorSummary,
  buildAgentReplyTimeoutSummary,
  buildDispatchErrorSummary,
} from "../config/templates.js";
import { resolveWecomAgentReplyTimeoutMs } from "../config/wecom-config.js";
import { TimeoutError, withTimeout } from "../shared/timeout.js";
import {
  getExtendedMediaLocalRoots,
  readGuardedLocalMediaFile,
} from "../media/media-path-guard.js";
import {
  getActiveReplyUrl,
  sendBotFallbackPromptNow,
  pushFinalStreamReplyNow,
  useActiveReplyOnce,
} from "./active-reply.js";
import { agentDmText, agentDmMedia } from "./agent-dm.js";
// ============================================================================
// 入站消息处理
// ============================================================================

/**
 * 处理入站用户消息：去重 → 策略 → 防抖入队 → 占位符响应。
 *
 * WHY：企微要求 HTTP 回调快速返回 stream 占位符；真实 Agent 处理在 debounce 后异步进行。
 *
 * @param target - Webhook Target
 * @param message - 解密后的入站消息
 * @param timestamp - 回调 timestamp（加密响应用）
 * @param nonce - 回调 nonce
 * @param proxyUrl - 可选出口代理
 * @param msgFilterData - 预解析的 senderUserId / chatId
 * @returns 加密前的响应 JSON；跳过时 null
 */
export async function handleInboundMessage(
  target: WecomWebhookTarget,
  message: WebhookInboundMessage,
  timestamp: string,
  nonce: string,
  proxyUrl?: string,
  msgFilterData?: {
    senderUserId?: string;
    chatId?: string;
  }
): Promise<Record<string, unknown> | null> {
  const state = getMonitorState();

  const { streamStore, activeReplyStore } = state;
  const msgid = message.msgid;

  // 持久化 msgid 去重：跨重启防止企微重试导致重复 dispatch
  if (msgid) {
    const claimed = await claimWecomInboundMsgid(target.account.accountId, String(msgid));
    if (!claimed) {
      const existingStreamId = streamStore.getStreamByMsgId(String(msgid));
      if (existingStreamId) {
        const existingStream = streamStore.getStream(existingStreamId);
        if (existingStream) {
          target.runtime.log?.(
            `[webhook] 消息去重(持久): msgid=${msgid} streamId=${existingStreamId}`,
          );
          return buildStreamResponse(existingStream);
        }
      }
      target.runtime.log?.(`[webhook] 消息去重(持久): msgid=${msgid} 已处理，跳过`);
      return null;
    }
  }

  // 进程内 msgid → stream 映射：同进程重入时直接返回已有 stream 响应
  if (msgid) {
    const existingStreamId = streamStore.getStreamByMsgId(msgid);
    if (existingStreamId) {
      const existingStream = streamStore.getStream(existingStreamId);
      if (existingStream) {
        target.runtime.log?.(
          `[webhook] 消息去重: msgid=${msgid} 已关联 streamId=${existingStreamId}`,
        );
        return buildStreamResponse(existingStream);
      }
    }
  }

  // 解析消息内容（对齐原版 buildInboundBody）
  const msgContent = buildInboundBody(message);
  if (!msgContent && !hasMedia(message)) {
    target.runtime.log?.(`[webhook] 空消息内容 (type=${message.msgtype}, msgid=${msgid})`);
    return null;
  }

  const userid = msgFilterData?.senderUserId ?? "";
  const chatType = String(message.chattype ?? "").trim().toLowerCase();
  const chatId = msgFilterData?.chatId ?? message.chatid ?? "";
  // 原版 conversationKey 格式：wecom:{accountId}:{userid}:{chatId}
  // 单聊时 chatId 等于 userid
  const resolvedChatId = chatId || userid;
  const isGroupChat = chatType === "group";
  const conversationKey = `wecom:${target.account.accountId}:${userid}:${resolvedChatId}`;

  if (isGroupChat) {
    if (
      !checkWebhookGroupPolicy({
        chatId: resolvedChatId,
        senderId: userid,
        account: target.account,
        config: target.config,
        runtime: target.runtime,
      })
    ) {
      return null;
    }
  }

  // 防抖入队：同 conversationKey 短时多条消息合并为一批（DEFAULT_DEBOUNCE_MS）
  const result = streamStore.addPendingMessage({
    conversationKey,
    target,
    msg: message,
    msgContent: msgContent ?? "",
    nonce,
    timestamp,
    debounceMs: (target.account.config as any)?.debounceMs
  });

  const { streamId, status } = result;

  target.runtime.log?.(
    `[webhook] 消息入队 (status=${status}, streamId=${streamId}, convKey=${conversationKey})`,
  );

  // 存储 response_url（对齐原版：同时保存 proxyUrl 用于后续出站请求的代理）
  if (message.response_url) {
    activeReplyStore.store(
      streamId,
      message.response_url,
      proxyUrl,
    );
  }

  if (!isGroupChat) {
    const dmPolicyResult = await checkWebhookDmPolicy({
      senderId: userid,
      isGroup: false,
      account: target.account,
      streamId,
      runtime: target.runtime,
    });
    if (!dmPolicyResult.allowed) {
      streamStore.markFinished(streamId);
      streamStore.onStreamFinished(streamId);
      const placeholder = resolveWecomStreamPlaceholderText(target.account.config);
      return buildStreamPlaceholderReply(streamId, placeholder);
    }
  }

  // 更新 stream 的元数据
  streamStore.updateStream(streamId, (s) => {
    s.userId = userid;
    s.chatType = chatType === "group" ? "group" : "direct";
    s.chatId = resolvedChatId;
    s.aibotid = target.account.botId;
  });

  // 根据 status 返回不同的占位符响应（对齐原版 status 分支处理）
  const defaultPlaceholder = resolveWecomStreamPlaceholderText(target.account.config);
  const templates = resolveWecomTemplates(target.account);
  const queuedPlaceholder = templates.queued;
  const mergedQueuedPlaceholder = templates.mergedQueued;

  if (status === "active_new") {
    // 第一条消息，返回默认占位符
    return buildStreamPlaceholderReply(streamId, defaultPlaceholder);
  }

  if (status === "queued_new") {
    // 进入排队批次，返回排队提示
    target.runtime.log?.(`[webhook] queue: 已进入下一批次 streamId=${streamId} msgid=${String(message.msgid ?? "")}`);
    return buildStreamPlaceholderReply(streamId, queuedPlaceholder);
  }

  // active_merged / queued_merged：合并进某个批次
  // 为本条 msgid 创建一个"回执 stream"，先显示"已合并排队"，并在批次结束时自动更新为"已合并处理完成"
  const ackStreamId = streamStore.createStream({ msgid: message.msgid ? String(message.msgid) : undefined });
  streamStore.updateStream(ackStreamId, (s) => {
    s.finished = false;
    s.started = true;
    s.content = mergedQueuedPlaceholder;
  });
  if (message.msgid) {
    streamStore.setStreamIdForMsgId(String(message.msgid), ackStreamId);
  }
  streamStore.addAckStreamForBatch({ batchStreamId: streamId, ackStreamId });
  target.runtime.log?.(
    `[webhook] queue: 已合并排队（回执流）ackStreamId=${ackStreamId} mergedIntoStreamId=${streamId} msgid=${String(message.msgid ?? "")}`,
  );
  return buildStreamTextPlaceholderReply(ackStreamId, mergedQueuedPlaceholder);
}

// ============================================================================
// stream_refresh 处理
// ============================================================================

/**
 * 处理 stream_refresh 长轮询：返回 StreamState 当前内容与 finish 标记。
 *
 * @param target - Webhook Target
 * @param message - 含 stream.id 的 refresh 消息
 * @returns stream 响应 JSON；缺少 id 时 null
 */
export async function handleStreamRefresh(
  target: WecomWebhookTarget,
  message: WebhookInboundMessage,
): Promise<Record<string, unknown> | null> {
  const state = getMonitorState();

  const streamId = String(message.stream?.id ?? "").trim();
  if (!streamId) {
    target.runtime.log?.("[webhook] stream_refresh 缺少 stream_id");
    return null;
  }

  const stream = state.streamStore.getStream(streamId);
  if (!stream) {
    target.runtime.log?.(`[webhook] stream_refresh: stream ${streamId} 不存在`);
    // 返回 finish=true 以通知客户端停止轮询
    return {
      msgtype: "stream",
      stream: { id: streamId, finish: true, content: "" },
    };
  }

  target.runtime.log?.(
    `[webhook] stream_refresh (streamId=${streamId}, started=${stream.started}, finished=${stream.finished}, len=${stream.content.length})`,
  );

  return buildStreamResponse(stream);
}

// ============================================================================
// enter_chat 处理
// ============================================================================

/**
 * 处理 enter_chat 事件，返回可配置欢迎消息。
 *
 * @param target - Webhook Target
 * @param message - enter_chat 事件消息
 * @returns 文本响应或 null
 */
export async function handleEnterChat(
  target: WecomWebhookTarget,
  message: WebhookInboundMessage,
): Promise<Record<string, unknown> | null> {
  const welcomeText = resolveWecomEnterChatWelcomeText(target.account.config);

  const userId = message.from?.userid ?? "unknown";
  target.runtime.log?.(
    `[webhook] enter_chat (userId=${userId}, account=${target.account.accountId})`,
  );

  if (welcomeText) {
    return {
      msgtype: "text",
      text: { content: welcomeText },
    };
  }

  // 无欢迎消息配置，返回空回复
  return null;
}

// ============================================================================
// template_card_event 处理
// ============================================================================

/**
 * 处理模板卡片交互事件（非阻塞：立即返回空加密体，异步启动 Agent）。
 *
 * @param target - Webhook Target
 * @param message - template_card_event 消息
 * @param timestamp - 回调 timestamp
 * @param nonce - 回调 nonce
 * @param proxyUrl - 可选出口代理
 * @returns 空对象（加密后返回）
 */
export async function handleTemplateCardEvent(
  target: WecomWebhookTarget,
  message: WebhookInboundMessage,
  timestamp: string,
  nonce: string,
  proxyUrl?: string,
): Promise<Record<string, unknown> | null> {
  const state = getMonitorState();
  const { streamStore, activeReplyStore } = state;

  const msgid = message.msgid ? String(message.msgid) : undefined;

  // 1. msgid 去重：跳过已处理的卡片事件
  if (msgid && streamStore.getStreamByMsgId(msgid)) {
    target.runtime.log?.(
      `[webhook] template_card_event: already processed msgid=${msgid}, skipping`,
    );
    return {};
  }

  // 2. 解析卡片交互数据
  const cardEvent = message.event?.template_card_event as Record<string, unknown> | undefined;
  let interactionDesc = `[卡片交互] 按钮: ${String(cardEvent?.event_key ?? "unknown")}`;

  // 解析选择项（selected_items.selected_item）
  const selectedItems = cardEvent?.selected_items as Record<string, unknown> | undefined;
  const selectedItemList = selectedItems?.selected_item as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(selectedItemList) && selectedItemList.length > 0) {
    const selects = selectedItemList.map((i) => {
      const questionKey = String(i.question_key ?? "");
      const optionIds = (i.option_ids as Record<string, unknown> | undefined)?.option_id;
      const optionStr = Array.isArray(optionIds) ? optionIds.join(",") : String(optionIds ?? "");
      return `${questionKey}=${optionStr}`;
    });
    interactionDesc += ` 选择: ${selects.join("; ")}`;
  }

  // 解析任务 ID
  if (cardEvent?.task_id) {
    interactionDesc += ` (任务ID: ${String(cardEvent.task_id)})`;
  }

  target.runtime.log?.(
    `[webhook] template_card_event (event_key=${String(cardEvent?.event_key ?? "N/A")}, msgid=${msgid ?? "N/A"})`,
  );

  // 3. 创建 stream 并标记开始
  const streamId = streamStore.createStream({ msgid });
  streamStore.markStarted(streamId);

  // 4. 存储 response_url（用于后续 Agent 输出推送）
  if (message.response_url) {
    activeReplyStore.store(streamId, message.response_url, proxyUrl);
  }

  // 5. 构造交互描述作为文本消息，异步启动 Agent 处理
  const syntheticMessage: WebhookInboundMessage = {
    ...message,
    msgtype: "text",
    text: { content: interactionDesc },
  };

  // 异步启动 Agent（不阻塞 HTTP 响应）
  startAgentForStream({
    target,
    accountId: target.account.accountId,
    msg: syntheticMessage,
    streamId,
    mergedContents: undefined,
    mergedMsgids: undefined,
  }).catch((err) => {
    target.runtime.error?.(`[webhook] template_card_event Agent failed: ${String(err)}`);
  });

  // 6. 立即返回空回复（非阻塞，原版返回 {} 加密后的）
  return {};
}

// ============================================================================
// Agent 调度（startAgentForStream）
// ============================================================================

/**
 * 启动 Agent 处理流程（防抖 flush 或 template_card 触发）。
 *
 * WHY：Webhook 交付约束 — 图片走 Bot stream 帧，非图片走 Agent 私信；
 * 必须 `tools.deny message` 防止 Agent 绕过 Bot 链路。
 *
 * @param params.target - Webhook Target（含 core）
 * @param params.accountId - 账号 ID
 * @param params.msg - 入站消息（或合成消息）
 * @param params.streamId - stream ID
 * @param params.mergedContents - 防抖合并后的正文（可选）
 * @param params.mergedMsgids - 合并的 msgid 列表（可选）
 * @returns Promise
 */
export async function startAgentForStream(params: {
  target: WecomWebhookTarget;
  accountId: string;
  msg: WebhookInboundMessage;
  streamId: string;
  mergedContents?: string; // Combined content from debounced messages
  mergedMsgids?: string[];
}): Promise<void> {
  const { target, msg, streamId } = params;

  const state = getMonitorState();
  const { streamStore } = state;
  const stream = streamStore.getStream(streamId);
  if (!stream) {
    target.runtime.log?.(`[webhook] stream ${streamId} 不存在，跳过 Agent 调度`);
    return;
  }

  const core = target.core;
  const config = target.config;
  const account = target.account;
  const streamingConfig = resolveWecomStreamingConfig(account);
  const templates = resolveWecomTemplates(account);
  const chatType = msg.chattype === "group" ? "group" : "direct";
  const userid = resolveWecomSenderUserId(msg) ?? "unknown";
  const chatId = msg.chattype === "group" ? (msg.chatid?.trim() || "unknown") : userid;
  const taskKey = computeTaskKey(target, msg);
  const aibotid = String(msg.aibotid ?? "").trim() || undefined;

  // 更新 Stream 状态：记录上下文信息（用户ID、ChatType等）
  streamStore.updateStream(streamId, (s) => {
    s.userId = userid;
    s.chatType = chatType === "group" ? "group" : "direct";
    s.chatId = chatId;
    s.taskKey = taskKey;
    s.aibotid = aibotid;
  });

  // ──────────────────────────────────────────────────────────────────
  // 1.5 访问控制（群策略 + DM 策略，与 WS 长连接对齐）
  // ──────────────────────────────────────────────────────────────────
  if (chatType === "group") {
    if (
      !checkWebhookGroupPolicy({
        chatId,
        senderId: userid,
        account,
        config,
        runtime: target.runtime,
      })
    ) {
      streamStore.markFinished(streamId);
      streamStore.onStreamFinished(streamId);
      return;
    }
  } else {
    const dmPolicyResult = await checkWebhookDmPolicy({
      senderId: userid,
      isGroup: false,
      account,
      streamId,
      runtime: target.runtime,
    });
    if (!dmPolicyResult.allowed) {
      target.runtime.log?.(
        `[webhook] dm policy blocked sender=${userid} pairingSent=${String(dmPolicyResult.pairingSent ?? false)}`,
      );
      streamStore.markFinished(streamId);
      streamStore.onStreamFinished(streamId);
      return;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // 1. 入站消息处理（媒体解密）—— 对齐原版 processInboundMessage
  // ──────────────────────────────────────────────────────────────────
  let { body: rawBody, media } = await processInboundMessage(target, msg);

  // 若存在从防抖逻辑聚合来的多条消息内容，则覆盖 rawBody
  if (params.mergedContents) {
    rawBody = params.mergedContents;
  }

  // ──────────────────────────────────────────────────────────────────
  // 2. P0: 本机路径文件发送
  // P0: 群聊/私聊里“让 Bot 发送本机图片/文件路径”的场景，优先走 Bot 原会话交付（图片），
  // 非图片文件则走 Agent 私信兜底，并确保 Bot 会话里有中文提示。
  //
  // 典型背景：Agent 主动发群 chatId（wr/wc...）在很多情况下会 86008，无论怎么“修复”都发不出去；
  // 这种请求如果能被动回复图片，就必须由 Bot 在群内交付。
  // ──────────────────────────────────────────────────────────────────
  const directLocalPaths = extractLocalFilePathsFromText(rawBody);
  if (directLocalPaths.length) {
    target.runtime.log?.(
      `local-path: 检测到用户消息包含本机路径 count=${directLocalPaths.length} intent=${looksLikeSendLocalFileIntent(rawBody)}`,
    );
  }
  if (directLocalPaths.length && looksLikeSendLocalFileIntent(rawBody)) {
    const pathModule = await import("node:path");
    const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

    const imagePaths: string[] = [];
    const otherPaths: string[] = [];
    for (const p of directLocalPaths) {
      const ext = pathModule.extname(p).slice(1).toLowerCase();
      if (imageExts.has(ext)) imagePaths.push(p);
      else otherPaths.push(p);
    }

    // 图片：通过 Bot 原会话交付（base64 msg_item）
    if (imagePaths.length > 0 && otherPaths.length === 0) {
      const mediaLocalRoots = await getExtendedMediaLocalRoots(account.config);
      const maxBytes = resolveWecomMediaMaxBytes(config);
      const loaded: Array<{ base64: string; md5: string; path: string }> = [];
      const readErrors: string[] = [];
      for (const p of imagePaths) {
        const readResult = await readGuardedLocalMediaFile({
          filePath: p,
          allowedRoots: mediaLocalRoots,
          maxBytes,
        });
        if (!readResult.ok) {
          target.runtime.error?.(`[webhook] local-path: 读取图片失败 path=${p}: ${readResult.error}`);
          readErrors.push(buildMediaErrorSummary(p, readResult, templates));
          continue;
        }
        const buf = readResult.buffer;
        const base64 = buf.toString("base64");
        const md5 = computeMd5(buf);
        loaded.push({ base64, md5, path: p });
      }

      if (loaded.length > 0) {
        streamStore.updateStream(streamId, (s) => {
          s.images = loaded.map(({ base64, md5 }) => ({ base64, md5 }));
          s.content = templates.mediaSent;
          s.finished = true;
        });

        // 通过 response_url 推送（对齐 lh 版：直接 POST JSON，不加密）
        const responseUrl = getActiveReplyUrl(streamId);
        if (responseUrl) {
          try {
            const finalReply = buildStreamReplyFromState(streamStore.getStream(streamId)!, STREAM_MAX_BYTES) as unknown as Record<string, unknown>;
            await useActiveReplyOnce(streamId, async ({ responseUrl, proxyUrl }) => {
              const res = await wecomFetch(
                responseUrl,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(finalReply),
                },
                { proxyUrl, timeoutMs: REQUEST_TIMEOUT_MS },
              );
              if (!res.ok) throw new Error(`local-path image push failed: ${res.status}`);
            });
            target.runtime.log?.(`[webhook] local-path: 已通过 Bot response_url 推送图片 frames=final images=${loaded.length}`);
          } catch (err) {
            target.runtime.error?.(`[webhook] local-path: Bot 主动推送图片失败（将依赖 stream_refresh 拉取）: ${String(err)}`);
          }
        } else {
          target.runtime.log?.(`[webhook] local-path: 无 response_url，等待 stream_refresh 拉取最终图片`);
        }
        // 该消息已完成，推进队列处理下一批
        streamStore.onStreamFinished(streamId);
        return;
      }

      // 图片路径都读取失败时的兜底处理（对齐 lh 版 Webhook 模式）
      const agentOk = isAgentConfigured(target);
      const fallbackName = imagePaths.length === 1
        ? (imagePaths[0]!.split("/").pop() || "image")
        : `${imagePaths.length} 张图片`;
      const prompt = readErrors.length > 0
        ? readErrors.join("\n\n")
        : buildFallbackPrompt({
          kind: "media",
          agentConfigured: agentOk,
          userId: userid,
          filename: fallbackName,
          chatType,
        });

      streamStore.updateStream(streamId, (s) => {
        s.fallbackMode = "error";
        s.finished = true;
        s.content = prompt;
        s.fallbackPromptSentAt = s.fallbackPromptSentAt ?? Date.now();
      });

      try {
        await sendBotFallbackPromptNow({ streamId, text: prompt });
        target.runtime.log?.(`[webhook] local-path: 图片读取失败后已推送兜底提示`);
      } catch (err) {
        target.runtime.error?.(`[webhook] local-path: 图片读取失败后的兜底提示推送失败: ${String(err)}`);
      }
      if (agentOk && userid && userid !== "unknown") {
        for (const p of imagePaths) {
          const guessedType = guessContentTypeFromPath(p);
          try {
            await agentDmMedia({
              target,
              userId: userid,
              mediaUrlOrPath: p,
              contentType: guessedType,
              filename: p.split("/").pop() || "image",
            });
            streamStore.updateStream(streamId, (s) => {
              s.agentMediaKeys = Array.from(new Set([...(s.agentMediaKeys ?? []), p]));
            });
            target.runtime.log?.(
              `[webhook] local-path: 图片已通过 Agent 私信发送 user=${userid} path=${p} contentType=${guessedType ?? "unknown"}`,
            );
          } catch (err) {
            target.runtime.error?.(`[webhook] local-path: 图片 Agent 私信兜底失败 path=${p}: ${String(err)}`);
          }
        }
      }
      streamStore.onStreamFinished(streamId);
      return;
    }

    // 非图片文件：Bot 提示 + Agent 私信兜底（对齐 lh 版 Webhook 模式）
    if (otherPaths.length > 0) {
      const agentOk = isAgentConfigured(target);

      const filename = otherPaths.length === 1 ? otherPaths[0]!.split("/").pop()! : `${otherPaths.length} 个文件`;
      const prompt = buildFallbackPrompt({
        kind: "media",
        agentConfigured: agentOk,
        userId: userid,
        filename,
        chatType,
      });

      streamStore.updateStream(streamId, (s) => {
        s.fallbackMode = "media";
        s.finished = true;
        s.content = prompt;
        s.fallbackPromptSentAt = s.fallbackPromptSentAt ?? Date.now();
      });

      try {
        await sendBotFallbackPromptNow({ streamId, text: prompt });
        target.runtime.log?.(`[webhook] local-path: 文件兜底提示已推送`);
      } catch (err) {
        target.runtime.error?.(`[webhook] local-path: 文件兜底提示推送失败: ${String(err)}`);
      }

      if (!agentOk) {
        streamStore.onStreamFinished(streamId);
        return;
      }
      if (!userid || userid === "unknown") {
        target.runtime.error?.(`[webhook] local-path: 无法识别触发者 userId，无法 Agent 私信发送文件`);
        streamStore.onStreamFinished(streamId);
        return;
      }

      for (const p of otherPaths) {
        const alreadySent = streamStore.getStream(streamId)?.agentMediaKeys?.includes(p);
        if (alreadySent) continue;
        const guessedType = guessContentTypeFromPath(p);
        try {
          await agentDmMedia({
            target,
            userId: userid,
            mediaUrlOrPath: p,
            contentType: guessedType,
            filename: p.split("/").pop() || "file",
          });
          streamStore.updateStream(streamId, (s) => {
            s.agentMediaKeys = Array.from(new Set([...(s.agentMediaKeys ?? []), p]));
          });
          target.runtime.log?.(
            `[webhook] local-path: 文件已通过 Agent 私信发送 user=${userid} path=${p} contentType=${guessedType ?? "unknown"}`,
          );
        } catch (err) {
          target.runtime.error?.(`[webhook] local-path: Agent 私信发送文件失败 path=${p}: ${String(err)}`);
        }
      }
      streamStore.onStreamFinished(streamId);
      return;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // 3. 保存媒体文件供 Agent 使用
  // ──────────────────────────────────────────────────────────────────
  let mediaPath: string | undefined;
  let mediaType: string | undefined;
  if (media) {
    try {
      const maxBytes = resolveWecomMediaMaxBytes(config);
      const saved = await core.channel.media.saveMediaBuffer(
        media.buffer,
        media.contentType,
        "inbound",
        maxBytes,
        media.filename,
      );
      mediaPath = saved.path;
      mediaType = saved.contentType;
      target.runtime.log?.(`[webhook] 入站媒体已保存: ${mediaPath} (${mediaType})`);
    } catch (err) {
      target.runtime.error?.(`[webhook] 入站媒体保存失败: ${String(err)}`);
    }
  }

  // 3.5 视频第一帧提取（ffmpeg）
  let videoFirstFramePath: string | undefined;
  if (mediaPath && mediaType?.startsWith("video/")) {
    try {
      const { extractVideoFirstFrame } = await import("./video-frame.js");
      videoFirstFramePath = await extractVideoFirstFrame(mediaPath);
      if (videoFirstFramePath) {
        target.runtime.log?.(`[webhook] video: 第一帧提取成功 ${videoFirstFramePath}`);
      }
    } catch (err) {
      target.runtime.log?.(`[webhook] video: 第一帧提取失败（ffmpeg 可能不可用）: ${String(err)}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // 4. 路由解析 + 动态路由处理
  // ──────────────────────────────────────────────────────────────────
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "wecom",
    accountId: account.accountId,
    peer: { kind: chatType === "group" ? "group" : "direct", id: chatId },
  });

  // ===== 动态 Agent 路由处理 =====
  const routingResult = processDynamicRouting({
    route,
    config,
    core,
    accountId: account.accountId,
    chatType: chatType === "group" ? "group" : "dm",
    chatId,
    senderId: userid,
    log: (msg) => target.runtime.log?.(msg.replace(/^\[dynamic-routing\]/, "[webhook]")),
    error: (msg) => target.runtime.error?.(msg.replace(/^\[dynamic-routing\]/, "[webhook]")),
  });

  // 应用动态路由结果
  if (routingResult.routeModified) {
    route.agentId = routingResult.finalAgentId;
    route.sessionKey = routingResult.finalSessionKey;
  }
  // ===== 动态 Agent 路由处理结束 =====
  // ──────────────────────────────────────────────────────────────────
  // 5. Agent Envelope 格式化（对齐原版）
  // ──────────────────────────────────────────────────────────────────
  const fromLabel = chatType === "group" ? `group:${chatId}` : `user:${userid}`;
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "WeCom",
    from: fromLabel,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  // ──────────────────────────────────────────────────────────────────
  // 5.5 命令授权检查（对齐 lh 版 command-auth 门禁）
  // ──────────────────────────────────────────────────────────────────
  const authz = await resolveWecomCommandAuthorization({
    core,
    cfg: config,
    accountConfig: account.config,
    rawBody,
    senderUserId: userid,
  });
  const commandAuthorized = authz.commandAuthorized;
  target.runtime.log?.(
    `[webhook] authz: dmPolicy=${authz.dmPolicy} shouldCompute=${authz.shouldComputeAuth} sender=${userid.toLowerCase()} senderAllowed=${authz.senderAllowed} authorizerConfigured=${authz.authorizerConfigured} commandAuthorized=${String(commandAuthorized)}`,
  );

  // 命令门禁：如果这是命令且未授权，必须给用户一个明确的中文回复（不能静默忽略）
  if (authz.shouldComputeAuth && authz.commandAuthorized !== true) {
    const prompt = buildWecomUnauthorizedCommandPrompt({
      senderUserId: userid,
      dmPolicy: authz.dmPolicy,
      scope: "bot",
    });
    streamStore.updateStream(streamId, (s) => {
      s.finished = true;
      s.content = prompt;
    });
    try {
      await sendBotFallbackPromptNow({ streamId, text: prompt });
      target.runtime.log?.(`[webhook] authz: 未授权命令已提示用户 streamId=${streamId}`);
    } catch (err) {
      target.runtime.error?.(`[webhook] authz: 未授权命令提示推送失败 streamId=${streamId}: ${String(err)}`);
    }
    streamStore.onStreamFinished(streamId);
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // 6. /new /reset 命令检测
  // ──────────────────────────────────────────────────────────────────
  const rawBodyNormalized = rawBody.trim();
  const isResetCommand = /^\/(new|reset)(?:\s|$)/i.test(rawBodyNormalized);
  const resetCommandKind = isResetCommand ? (rawBodyNormalized.match(/^\/(new|reset)/i)?.[1]?.toLowerCase() ?? "new") : null;

  // ──────────────────────────────────────────────────────────────────
  // 7. 构造附件
  // ──────────────────────────────────────────────────────────────────
  const attachments: Array<{ name: string; mimeType?: string; url: string }> | undefined =
    mediaPath ? [{ 
      name: media?.filename || "file",
      mimeType: mediaType,
      url: pathToFileURL(mediaPath).href
    }] : undefined;

  // 如果提取到了视频第一帧，追加为附件让 LLM 能看到视频画面
  if (videoFirstFramePath && attachments) {
    const pathModule = await import("node:path");
    attachments.push({
      name: pathModule.basename(videoFirstFramePath),
      mimeType: "image/jpeg",
      url: pathToFileURL(videoFirstFramePath).href
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // 8. 构造 inbound context
  // ──────────────────────────────────────────────────────────────────
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    Attachments: attachments,
    From: chatType === "group" ? `wecom:group:${chatId}` : `wecom:${userid}`,
    To: `wecom:${chatId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: chatType,
    ConversationLabel: fromLabel,
    SenderName: userid,
    SenderId: userid,
    Provider: "wecom",
    Surface: "wecom",
    MessageSid: msg.msgid,
    CommandAuthorized: commandAuthorized,
    OriginatingChannel: "wecom",
    OriginatingTo: `wecom:${chatId}`,
    MediaPath: mediaPath,
    MediaType: mediaType,
    MediaUrl: mediaPath,
  });

  // ──────────────────────────────────────────────────────────────────
  // 9. 会话记录
  // ──────────────────────────────────────────────────────────────────
  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err: unknown) => {
      target.runtime.error?.(`[webhook] session meta update failed: ${String(err)}`);
    },
  });

  // ──────────────────────────────────────────────────────────────────
  // 10. Markdown 表格模式解析
  // ──────────────────────────────────────────────────────────────────
  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg: config,
    channel: "wecom",
    accountId: account.accountId,
  });

  // 入站含媒体时展示 reading 状态栏（与 WS routeAndDispatch 对齐）
  if (mediaPath && streamingConfig.footerStatus) {
    if (shouldShowStreamStatusLine(streamingConfig)) {
      streamStore.updateStream(streamId, (s) => {
        s.statusLine = templates.reading;
        syncWecomStreamContent(s, streamingConfig, { includeAnswer: false, templates });
        s.content = truncateUtf8Bytes(s.content, STREAM_MAX_BYTES) || s.content;
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // 11. 构造 dispatch config（禁用 message 工具）
  // ──────────────────────────────────────────────────────────────────
  // WeCom Bot 会话交付约束：
  // - 图片应尽量由 Bot 在原会话交付（流式最终帧 msg_item）。
  // - 非图片文件走 Agent 私信兜底（本文件中实现），并由 Bot 给出提示。
  //
  // 重要：message 工具不是 sandbox 工具，必须通过 cfg.tools.deny 禁用。
  // 否则 Agent 可能直接通过 message 工具私信/发群，绕过 Bot 交付链路，导致群里“没有任何提示”。
  const cfgForDispatch = buildCfgForDispatch(config);

  const { dispatcherOptions, replyOptions } = createWecomReplyDispatcher({
    target,
    streamId,
    chatType,
    rawBody,
    tableMode,
    cfg: cfgForDispatch,
    agentId: route.agentId,
  });

  const agentReplyTimeoutMs = resolveWecomAgentReplyTimeoutMs(config);
  try {
    await withTimeout(
      core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx: ctxPayload,
        cfg: cfgForDispatch,
        replyOptions,
        dispatcherOptions,
      }),
      agentReplyTimeoutMs,
      `Agent reply timed out after ${agentReplyTimeoutMs}ms`,
    );
  } catch (err) {
    target.runtime.error?.(
      `[webhook] Agent reply failed (streamId=${streamId}): ${String(err)}`,
    );
    if (err instanceof TimeoutError) {
      const summary = buildAgentReplyTimeoutSummary(agentReplyTimeoutMs, templates);
      streamStore.updateStream(streamId, (s) => {
        if (!s.content?.trim()) {
          s.content = summary;
          s.answerText = summary;
        }
        s.dispatchErrorSummary = summary;
      });
      target.runtime.error?.(
        `[webhook] Agent reply timed out after ${agentReplyTimeoutMs}ms, finishing stream streamId=${streamId}`,
      );
    } else {
      const summary = buildDispatchErrorSummary("dispatch", err, templates);
      streamStore.updateStream(streamId, (s) => {
        if (!s.content?.trim()) s.content = summary;
        s.dispatchErrorSummary = summary;
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // 13. 后处理：/new /reset 中文回执
  // ──────────────────────────────────────────────────────────────────
  if (isResetCommand) {
    const current = streamStore.getStream(streamId);
    if (current && !current.content?.trim()) {
      const ackText = resetCommandKind === "reset" ? templates.sessionReset : templates.sessionNew;
      streamStore.updateStream(streamId, (s) => {
        s.answerText = ackText;
        syncWecomStreamContent(s, streamingConfig, {
          includeAnswer: true,
          includeFooter: true,
          includeStatus: false,
          templates,
        });
        s.content = truncateUtf8Bytes(s.content, STREAM_MAX_BYTES) || s.content;
        s.finished = true;
      });
    }
  }

  // 空内容兜底（按 streaming 配置合成气泡，与 WS finish-thinking 一致）
  streamStore.updateStream(streamId, (s) => {
    applyWecomWebhookEmptyContentFallback(s, streamingConfig, {
      hasMediaDelivered: (s.agentMediaKeys?.length ?? 0) > 0,
      hasFallback: Boolean(s.fallbackMode),
      finishedAt: Date.now(),
      templates,
    });
    s.content = truncateUtf8Bytes(s.content, STREAM_MAX_BYTES) || s.content;
  });

  streamStore.markFinished(streamId);

  // ──────────────────────────────────────────────────────────────────
  // 14. 超时模式下 Agent DM 最终投递（对齐 lh 版）
  // ──────────────────────────────────────────────────────────────────
  const finishedState = streamStore.getStream(streamId);
  if (finishedState?.fallbackMode === "timeout" && !finishedState.finalDeliveredAt) {
    if (!isAgentConfigured(target)) {
      // Agent not configured - group prompt already explains the situation.
      streamStore.updateStream(streamId, (s) => { s.finalDeliveredAt = Date.now(); });
    } else if (finishedState.userId) {
      const dmText = (finishedState.dmContent ?? "").trim();
      if (dmText) {
        try {
          target.runtime.log?.(`[webhook] fallback(timeout): 开始通过 Agent 私信发送剩余内容 user=${finishedState.userId} len=${dmText.length}`);
          await agentDmText({ target, userId: finishedState.userId, text: dmText });
          target.runtime.log?.(`[webhook] fallback(timeout): Agent 私信发送完成 user=${finishedState.userId}`);
        } catch (err) {
          target.runtime.error?.(`[webhook] fallback(timeout): Agent 私信发送失败: ${String(err)}`);
        }
      }
      streamStore.updateStream(streamId, (s) => { s.finalDeliveredAt = Date.now(); });
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // 15. 统一终结：主动推送最终流帧（对齐 lh 版：直接 POST JSON 不加密）
  // ──────────────────────────────────────────────────────────────────
  const stateAfterFinish = streamStore.getStream(streamId);
  const responseUrl = getActiveReplyUrl(streamId);
  if (stateAfterFinish && responseUrl) {
    try {
      await pushFinalStreamReplyNow(streamId);
      target.runtime.log?.(
        `[webhook] final stream pushed via response_url streamId=${streamId}, chatType=${chatType}, images=${stateAfterFinish.images?.length ?? 0}`,
      );
    } catch (err) {
      target.runtime.error?.(`[webhook] final stream push via response_url failed streamId=${streamId}: ${String(err)}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // 16. 更新回执流 + 推进队列
  // ──────────────────────────────────────────────────────────────────
  target.runtime.log?.(`[webhook] queue: 当前批次结束，尝试推进下一批 streamId=${streamId}`);

  const ackStreamIds = streamStore.drainAckStreamsForBatch(streamId);
  if (ackStreamIds.length > 0) {
    const mergedDoneHint = templates.mergedDone;
    for (const ackId of ackStreamIds) {
      streamStore.updateStream(ackId, (s) => { s.content = mergedDoneHint; s.finished = true; });
    }
    target.runtime.log?.(`[webhook] queue: 已更新回执流 count=${ackStreamIds.length} batchStreamId=${streamId}`);
  }

  streamStore.onStreamFinished(streamId);
}
