/**
 * @module monitor
 *
 * 企业微信 WebSocket 监控器主模块（Bot 长连接入站链路）。
 *
 * **职责**：
 * - 通过 `@wecom/aibot-node-sdk` 建立/维护 WS 连接（心跳、重连、认证）
 * - 编排入站消息流水线：解析 → 群/私聊策略 → 媒体下载 → 串行队列 → Agent dispatch → 流式回复
 * - 管理连接生命周期（abort、被踢下线、认证失败、重连耗尽）与账号级资源清理
 *
 * **适用场景**：OpenClaw 启动 `wecom` 渠道 WS 模式时，由框架调用 `monitorWeComProvider`。
 *
 * **上下游**：
 * - 上游：SDK `WSClient` 帧（message / event / enter_chat）
 * - 下游：`message-parser`、`dm-policy` / `group-policy`、`chat-queue`、`ws-reply-pipeline`
 *
 * **关键导出**：`monitorWeComProvider`、状态/ReqId 相关 re-export
 *
 * **子模块**：`message-parser`、`message-sender`、`media-handler`、`group-policy`、`dm-policy`、`state-manager`、`timeout`
 */

import {
  WSClient,
  generateReqId,
  WSAuthFailureError,
  WSReconnectExhaustedError,
} from "@wecom/aibot-node-sdk";
import type {
  EnterChatEvent,
  EventMessageWith,
  Logger,
  WsFrame,
} from "@wecom/aibot-node-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import {
  CHANNEL_ID,
  MEDIA_IMAGE_PLACEHOLDER,
  MEDIA_DOCUMENT_PLACEHOLDER,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_MAX_RECONNECT_ATTEMPTS,
  WS_MAX_AUTH_FAILURE_ATTEMPTS,
  EVENT_ENTER_CHECK_UPDATE,
  CMD_ENTER_EVENT_REPLY,
  SCENE_WECOM_OPENCLAW,
} from "../types/const.js";
import { checkDmPolicy } from "../config/dm-policy.js";
import { processDynamicRouting } from "../config/dynamic-routing.js";
import { checkGroupPolicy } from "../config/group-policy.js";
import { enqueueWeComChatTask, hasActiveTask, buildQueueKey } from "./chat-queue.js";
import {
  buildAgentReplyTimeoutSummary,
  buildDispatchErrorSummary,
  resolveWecomTemplates,
} from "../config/templates.js";
import type { WeComMonitorOptions, MessageState } from "../types/interface.js";
import {
  downloadAndSaveImages,
  downloadAndSaveFiles,
  MediaOversizeError,
} from "../media/media-handler.js";
import { parseMessageContent, type MessageBody } from "./message-parser.js";
import { sendWeComReply } from "./message-sender.js";
import { getWeComRuntime } from "../runtime.js";
import {
  setWeComWebSocket,
  setMessageState,
  deleteMessageState,
  setReqIdForChat,
  setSessionChatInfo,
  warmupReqIdStore,
  startMessageStateCleanup,
  stopMessageStateCleanup,
  cleanupAccount,
} from "../state/state-manager.js";
import { updateTemplateCardOnEvent } from "../outbound/template-card-manager.js";
import type { ResolvedWeComAccount } from "../config/wecom-config.js";
import { resolveWecomAgentReplyTimeoutMs } from "../config/wecom-config.js";
import { resolveWecomEnterChatWelcomeText, resolveWecomStreamingConfig } from "../config/streaming-config.js";
import { TimeoutError, withTimeout } from "../shared/timeout.js";
import { PLUGIN_VERSION } from "../types/version.js";
import {
  createWsWecomReplyDispatcher,
  finalizeWsWecomReply,
  sendThinkingReply,
} from "../webhook/ws-reply-pipeline.js";
import {
  createWsTimingContext,
  logWsTimingStage,
  type WsTimingContext,
} from "./ws-timing.js";

// ============================================================================
// 消息条目类型
// ============================================================================

/**
 * 消息条目：存储解析阶段（Step 1–4）的结果，传入串行队列后由处理阶段（Step 5–7）消费。
 *
 * @internal
 */
interface WeComMessageEntry {
  frame: WsFrame;
  account: ResolvedWeComAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  wsClient: WSClient;
  /** 解析后的文本内容 */
  text: string;
  /** 下载后的媒体文件列表 */
  mediaList: Array<{ path: string; contentType?: string }>;
  /** 引用消息内容 */
  quoteContent?: string;
  /** 消息 ID */
  messageId: string;
  /** chatId（群组 ID 或用户 ID） */
  chatId: string;
  /** 请求 ID */
  reqId: string;
  /** WS 首响耗时观测（可选） */
  timing?: WsTimingContext;
}

// ============================================================================
// 附件超限提示文案
// ============================================================================

/**
 * 构造「附件超过 OpenClaw 大小限制」的中文提示文案。
 *
 * @param err - 媒体超限错误（含 kind / sizeBytes / maxBytes）
 * @returns 可直接 replyStream 的用户可见提示
 */
function buildMediaOversizeHintText(err: MediaOversizeError): string {
  const maxMb = err.maxBytes / 1024 / 1024;
  return `当前文件超过 ${maxMb}MB 限制，请调整 channels.wecom.media.maxBytes 或 agents.defaults.mediaMaxMb。`;
}

// ============================================================================
// 媒体本地路径白名单扩展
// ============================================================================

// ============================================================================
// 重新导出（保持向后兼容）
// ============================================================================

export type { WeComMonitorOptions } from "../types/interface.js";
export { WeComCommand } from "../types/const.js";
export {
  getWeComWebSocket,
  setReqIdForChat,
  getReqIdForChatAsync,
  getReqIdForChat,
  deleteReqIdForChat,
  warmupReqIdStore,
  flushReqIdStore,
} from "../state/state-manager.js";
export { sendWeComReply } from "./message-sender.js";

// ============================================================================
// 消息上下文构建
// ============================================================================

/**
 * 构建 OpenClaw 入站消息上下文（含动态 Agent 路由与会话 storePath）。
 *
 * @param frame - SDK WebSocket 帧
 * @param account - 已解析的 WeCom 账号
 * @param config - OpenClaw 全局配置
 * @param text - 解析后的文本正文
 * @param mediaList - 已下载的本地媒体列表
 * @param quoteContent - 引用消息文本（可选）
 * @param runtime - 运行时日志（可选）
 * @returns ctxPayload、route、storePath、chatId、chatType
 */
function buildMessageContext(
  frame: WsFrame,
  account: ResolvedWeComAccount,
  config: OpenClawConfig,
  text: string,
  mediaList: Array<{ path: string; contentType?: string }>,
  quoteContent?: string,
  runtime?: RuntimeEnv,
) {
  const core = getWeComRuntime();
  const body = frame.body as MessageBody;
  const chatId = body.chatid || body.from.userid;
  const chatType = body.chattype === "group" ? "group" : "direct";

  // 解析路由信息
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: chatType,
      id: chatId,
    },
  });

  // ===== 动态 Agent 路由注入 =====
  const routingResult = processDynamicRouting({
    route,
    config,
    core,
    accountId: account.accountId,
    chatType: chatType === "group" ? "group" : "dm",
    chatId,
    senderId: body.from.userid,
    log: runtime?.log ? (...args: any[]) => runtime.log?.(...args) : undefined,
    error: runtime?.error ? (...args: any[]) => runtime.error?.(...args) : undefined,
  });

  // 应用动态路由结果
  if (routingResult.routeModified) {
    route.agentId = routingResult.finalAgentId;
    route.sessionKey = routingResult.finalSessionKey;
  }
  // ===== 动态 Agent 路由注入结束 =====

  // 构建会话标签
  const fromLabel = chatType === "group" ? `group:${chatId}` : `user:${body.from.userid}`;

  // 当只有媒体没有文本时，使用占位符标识媒体类型
  const hasImages = mediaList.some((m) => m.contentType?.startsWith("image/"));
  const messageBody =
    text ||
    (mediaList.length > 0
      ? hasImages
        ? MEDIA_IMAGE_PLACEHOLDER
        : MEDIA_DOCUMENT_PLACEHOLDER
      : "");

  // 构建多媒体数组
  const mediaPaths = mediaList.length > 0 ? mediaList.map((m) => m.path) : undefined;
  const mediaTypes =
    mediaList.length > 0
      ? (mediaList.map((m) => m.contentType).filter(Boolean) as string[])
      : undefined;

  // 使用 route.agentId 解析 storePath（多 agent 场景下 session 路径隔离）
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });

  // 构建标准消息上下文
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: messageBody,
    RawBody: messageBody,
    CommandBody: messageBody,

    MessageSid: body.msgid,

    From:
      chatType === "group" ? `${CHANNEL_ID}:group:${chatId}` : `${CHANNEL_ID}:${body.from.userid}`,
    To: `${CHANNEL_ID}:${chatId}`,
    SenderId: body.from.userid,

    SessionKey: route.sessionKey,
    AccountId: route.accountId,

    ChatType: chatType,
    ConversationLabel: fromLabel,

    Timestamp: Date.now(),

    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,

    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `${CHANNEL_ID}:${chatId}`,

    CommandAuthorized: true,

    ResponseUrl: body.response_url,
    ReqId: frame.headers.req_id,
    WeComFrame: frame,

    MediaPath: mediaList[0]?.path,
    MediaType: mediaList[0]?.contentType,
    MediaPaths: mediaPaths,
    MediaTypes: mediaTypes,
    MediaUrls: mediaPaths,

    ReplyToBody: quoteContent,
  });

  return { ctxPayload, route, storePath, chatId, chatType };
}

// ============================================================================
// 消息处理和回复
// ============================================================================

/**
 * 路由消息到 OpenClaw core 并驱动 WS 流式回复（含 Agent 超时与错误兜底）。
 *
 * **流程**：recordInboundSession → dispatchReplyWithBufferedBlockDispatcher → finalizeWsWecomReply
 *
 * @param params.ctxPayload - 入站上下文
 * @param params.route - Agent 路由结果
 * @param params.storePath - 会话存储路径
 * @param params.chatId - 会话 ID
 * @param params.chatType - `group` | `direct`
 * @param params.config - OpenClaw 配置
 * @param params.account - WeCom 账号
 * @param params.wsClient - 已认证的 WS 客户端
 * @param params.frame - 原始 WS 帧（replyStream 必需）
 * @param params.state - 流式消息状态（accumulatedText / streamId 等）
 * @param params.runtime - 运行时日志
 * @param params.onCleanup - 处理结束回调（幂等，仅调用一次）
 */
async function routeAndDispatchMessage(params: {
  ctxPayload: ReturnType<typeof buildMessageContext>["ctxPayload"];
  route: ReturnType<typeof buildMessageContext>["route"];
  storePath: string;
  chatId: string;
  chatType: string;
  config: OpenClawConfig;
  account: ResolvedWeComAccount;
  wsClient: WSClient;
  frame: WsFrame;
  state: MessageState;
  runtime: RuntimeEnv;
  onCleanup: () => void;
  timing?: WsTimingContext;
}): Promise<void> {
  const {
    ctxPayload,
    route,
    storePath,
    chatId,
    chatType,
    config,
    account,
    wsClient,
    frame,
    state,
    runtime,
    onCleanup,
    timing,
  } = params;
  const core = getWeComRuntime();
  const streamingConfig = resolveWecomStreamingConfig(account);
  const templates = resolveWecomTemplates(account);
  const agentReplyTimeoutMs = resolveWecomAgentReplyTimeoutMs(config);

  const { dispatcherOptions, replyOptions, deliverCtx } = createWsWecomReplyDispatcher({
    wsClient,
    frame,
    state,
    account,
    runtime,
    config,
    agentId: route.agentId,
  });

  // 防止 onCleanup 被多次调用（onError 回调与 catch 块可能重复触发）
  let cleanedUp = false;
  const safeCleanup = () => {
    if (!cleanedUp) {
      cleanedUp = true;
      onCleanup();
    }
  };

  state.replyStartedAt = state.replyStartedAt ?? Date.now();
  if (state.inboundHadMedia && streamingConfig.footerStatus) {
    state.statusLine = templates.reading;
  }

  try {
    await core.channel.session.recordInboundSession({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
      updateLastRoute:
        chatType !== "group"
          ? {
              sessionKey: route.mainSessionKey,
              channel: CHANNEL_ID,
              to: `${CHANNEL_ID}:${chatId}`,
              accountId: route.accountId,
            }
          : undefined,
      onRecordError: (err) => {
        runtime.error?.(`[wecom] failed updating session meta: ${String(err)}`);
      },
    });
    logWsTimingStage(timing ?? createWsTimingContext({ accountId: account.accountId, chatId, messageId: frame.body?.msgid ?? "" }), "session.recorded");

    await withTimeout(
      core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx: ctxPayload,
        cfg: config,
        replyOptions,
        dispatcherOptions,
      }),
      agentReplyTimeoutMs,
      `Agent reply timed out after ${agentReplyTimeoutMs}ms`,
    );

    await finalizeWsWecomReply(deliverCtx);
    safeCleanup();
  } catch (err) {
    runtime.error?.(`[wecom][plugin] Failed to process message: ${String(err)}`);
    if (err instanceof TimeoutError) {
      state.dispatchErrorSummary = buildAgentReplyTimeoutSummary(agentReplyTimeoutMs, templates);
      runtime.error?.(
        `[wecom] Agent reply timed out after ${agentReplyTimeoutMs}ms, sending fallback to user`,
      );
    } else if (!state.dispatchErrorSummary) {
      state.dispatchErrorSummary = buildDispatchErrorSummary("dispatch", err, templates);
    }
    try {
      await finalizeWsWecomReply(deliverCtx);
    } catch (finishErr) {
      runtime.error?.(
        `[wecom] Failed to finish thinking stream after dispatch error: ${String(finishErr)}`,
      );
    }
    safeCleanup();
  }
}

/**
 * 解析并校验企业微信消息（入队前阶段：Step 1–4）。
 *
 * **Step 1**：`parseMessageContent` 提取文本/图片/文件/引用
 * **Step 2**：群聊 `checkGroupPolicy`
 * **Step 3**：私聊 `checkDmPolicy`（含 pairing）
 * **Step 4**：`downloadAndSaveImages` / `downloadAndSaveFiles`
 *
 * @returns 可入队的 `WeComMessageEntry`；策略拒绝或空消息时返回 `null`
 */
async function prepareWeComMessage(params: {
  frame: WsFrame;
  account: ResolvedWeComAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  wsClient: WSClient;
}): Promise<WeComMessageEntry | null> {
  const { frame, account, config, runtime, wsClient } = params;
  const body = frame.body as MessageBody;
  const chatId = body.chatid || body.from.userid;
  const chatType = body.chattype === "group" ? "group" : "direct";
  const messageId = body.msgid;
  const reqId = frame.headers.req_id;
  const timing = createWsTimingContext({
    accountId: account.accountId,
    chatId,
    messageId,
  });
  logWsTimingStage(timing, "ws.received");

  // Step 1: 解析消息内容
  const { textParts, imageUrls, imageAesKeys, fileUrls, fileAesKeys, quoteContent } =
    parseMessageContent(body);
  let text = textParts.join("\n").trim();
  logWsTimingStage(timing, "parse.done", {
    hasText: Boolean(text),
    images: imageUrls.length,
    files: fileUrls.length,
  });

  // // 群聊中移除 @机器人 的提及标记
  // if (body.chattype === "group") {
  //   text = text.replace(/@\S+/g, "").trim();
  // }

  // 如果文本为空但存在引用消息，使用引用消息内容
  if (!text && quoteContent) {
    text = quoteContent;
    runtime.log?.("[wecom][plugin] Using quote content as message body (user only mentioned bot)");
  }

  // 如果既没有文本也没有图片也没有文件也没有引用内容，则跳过
  if (!text && imageUrls.length === 0 && fileUrls.length === 0) {
    runtime.log?.("[wecom][plugin] Skipping empty message (no text, image, file or quote)");
    return null;
  }

  // Step 2: 群组策略检查（仅群聊）
  if (chatType === "group") {
    const groupPolicyResult = checkGroupPolicy({
      chatId,
      senderId: body.from.userid,
      account,
      config,
      runtime,
    });

    if (!groupPolicyResult.allowed) {
      logWsTimingStage(timing, "policy.group.denied");
      return null;
    }
  }

  // Step 3: DM Policy 访问控制检查（仅私聊）
  const dmPolicyResult = await checkDmPolicy({
    senderId: body.from.userid,
    isGroup: chatType === "group",
    account,
    wsClient,
    frame,
    runtime,
  });
  logWsTimingStage(timing, "policy.dm.done", { allowed: dmPolicyResult.allowed });

  if (!dmPolicyResult.allowed) {
    return null;
  }

  // Step 4: 下载并保存图片和文件（纯文本消息跳过下载）
  let imageMediaList: Array<{ path: string; contentType?: string }> = [];
  let fileMediaList: Array<{ path: string; contentType?: string }> = [];
  if (imageUrls.length > 0 || fileUrls.length > 0) {
    try {
      [imageMediaList, fileMediaList] = await Promise.all([
        downloadAndSaveImages({
          imageUrls,
          imageAesKeys,
          account,
          config,
          runtime,
          wsClient,
        }),
        downloadAndSaveFiles({
          fileUrls,
          fileAesKeys,
          account,
          config,
          runtime,
          wsClient,
        }),
      ]);
    } catch (err) {
    if (err instanceof MediaOversizeError) {
      // 附件超过 OpenClaw 配置的大小上限：向用户发送明确的中文提示并终止本次消息处理。
      const hintText = buildMediaOversizeHintText(err);
      runtime.error?.(
        `[wecom] Media oversize: kind=${err.kind}, size=${err.sizeBytes}, max=${err.maxBytes}, filename=${err.filename ?? "(none)"}`,
      );
      try {
        await sendWeComReply({ wsClient, frame, text: hintText, runtime, finish: true });
      } catch (replyErr) {
        runtime.error?.(`[wecom] Failed to send oversize hint: ${String(replyErr)}`);
      }
      return null;
    }
    throw err;
    }
  }
  const mediaList = [...imageMediaList, ...fileMediaList];
  logWsTimingStage(timing, "media.done", { mediaCount: mediaList.length });

  return {
    frame,
    account,
    config,
    runtime,
    wsClient,
    text,
    mediaList,
    quoteContent,
    messageId,
    chatId,
    reqId,
    timing,
  };
}

/**
 * 处理企业微信消息（Step 5–7，由 `chat-queue` 串行调度）。
 *
 * **Step 5**：写入 ReqId / MessageState
 * **Step 6**：（可选）thinking 首帧
 * **Step 7**：`buildMessageContext` + `routeAndDispatchMessage`
 *
 * @param entry - `prepareWeComMessage` 产出的消息条目
 */
async function processWeComMessageNow(entry: WeComMessageEntry): Promise<void> {
  const {
    frame,
    account,
    config,
    runtime,
    wsClient,
    text,
    mediaList,
    quoteContent,
    messageId,
    chatId,
    reqId,
    timing,
  } = entry;

  logWsTimingStage(timing ?? createWsTimingContext({ accountId: account.accountId, chatId, messageId }), "queue.start");

  // Step 5: 初始化消息状态
  setReqIdForChat(chatId, reqId, account.accountId);

  const streamId = generateReqId("stream");
  const state: MessageState = {
    accumulatedText: "",
    streamId,
    inboundHadMedia: mediaList.length > 0,
  };
  setMessageState(messageId, state);

  const cleanupState = () => {
    deleteMessageState(messageId);
  };

  const timingCtx =
    timing ?? createWsTimingContext({ accountId: account.accountId, chatId, messageId });

  // Step 6: 尽早发送协议首帧 thinking，避免 Agent dispatch 启动前用户侧长时间空白
  const shouldSendThinking = account.sendThinkingMessage ?? true;
  if (shouldSendThinking) {
    const templates = resolveWecomTemplates(account);
    try {
      await sendThinkingReply({
        wsClient,
        frame,
        streamId,
        runtime,
        account,
        state,
        templates,
      });
      state.thinkingSentEarly = true;
      logWsTimingStage(timingCtx, "thinking.early.sent");
    } catch (err) {
      runtime.error?.(`[wecom] Early thinking reply failed: ${String(err)}`);
      logWsTimingStage(timingCtx, "thinking.early.failed");
    }
  }

  // Step 7: 构建上下文并路由到核心处理流程（带整体超时保护）
  const {
    ctxPayload,
    route,
    storePath,
    chatId: resolvedChatId,
    chatType,
  } = buildMessageContext(frame, account, config, text, mediaList, quoteContent, runtime);
  logWsTimingStage(timingCtx, "context.built");

  // 以 sessionKey 为键记录「原始大小写」的 chatId 与 chatType，
  // 供 MCP 工具工厂（index.ts:registerTool）在构造工具闭包时取回，
  // 进而传递给需要原始 chatId 的拦截器（如 doc-auth-error 发送 biz_msg）。
  //
  // 注意：不要使用 parseSessionKeyChat 反解 sessionKey —— OpenClaw core
  //       构建 sessionKey 时会将 peer.id 强制小写化，会导致企业微信
  //       aibot_send_biz_msg 报 errcode=93006 invalid chatid。
  setSessionChatInfo(route.sessionKey, {
    chatId: resolvedChatId,
    chatType: chatType === "group" ? "group" : "single",
  });
  // runtime.log?.(`[plugin -> openclaw] body=${text}, mediaPaths=${JSON.stringify(mediaList.map(m => m.path))}${quoteContent ? `, quote=${quoteContent}` : ''}`);

  try {
    logWsTimingStage(timingCtx, "dispatch.start");
    await routeAndDispatchMessage({
      ctxPayload,
      route,
      storePath,
      chatId: resolvedChatId,
      chatType,
      config,
      account,
      wsClient,
      frame,
      state,
      runtime,
      onCleanup: cleanupState,
      timing: timingCtx,
    });
    logWsTimingStage(timingCtx, "dispatch.end");
  } catch (err) {
    runtime.error?.(`[wecom][plugin] Message processing failed: ${String(err)}`);
    cleanupState();
  }
}

// ============================================================================
// 创建 SDK Logger 适配器
// ============================================================================

/**
 * 创建适配 OpenClaw `RuntimeEnv` 的 SDK Logger。
 *
 * @param runtime - OpenClaw 运行时（log / error）
 * @param accountId - 账号 ID（日志前缀）
 * @returns SDK 兼容 Logger 实例
 */
function createSdkLogger(runtime: RuntimeEnv, accountId: string): Logger {
  return {
    debug: (message: string, ...args: any[]) => {
      runtime.log?.(`[${accountId}] ${message}`, ...args);
    },
    info: (message: string, ...args: any[]) => {
      runtime.log?.(`[${accountId}] ${message}`, ...args);
    },
    warn: (message: string, ...args: any[]) => {
      runtime.log?.(`[${accountId}] WARN: ${message}`, ...args);
    },
    error: (message: string, ...args: any[]) => {
      runtime.error?.(`[${accountId}] ${message}`, ...args);
    },
  };
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * 监听企业微信 WebSocket 连接（渠道主入口）。
 *
 * **连接管理**：SDK `WSClient` 负责心跳、重连、认证；本模块注册事件监听并处理异常终态。
 *
 * **被踢 / 认证失败**：Promise 保持 pending，阻止框架 auto-restart 互踢循环。
 * **重连耗尽**：reject Promise，允许框架 auto-restart 恢复。
 *
 * @param options.account - 已解析账号（botId / secret / websocketUrl）
 * @param options.config - OpenClaw 配置
 * @param options.runtime - 运行时日志
 * @param options.abortSignal - 框架 stopChannel 中止信号
 * @param options.setStatus - 可选渠道状态回调
 * @returns 连接 Promise（abort / 重连耗尽时 settle）
 */
export async function monitorWeComProvider(options: WeComMonitorOptions): Promise<void> {
  const { account, config, runtime, abortSignal, setStatus } = options;

  runtime.log?.(`[${account.accountId}] [${PLUGIN_VERSION}] Initializing WSClient with SDK...`);

  // 启动消息状态定期清理
  startMessageStateCleanup();

  return new Promise((resolve, reject) => {
    const logger = createSdkLogger(runtime, account.accountId);

    const wsClient = new WSClient({
      botId: account.botId,
      secret: account.secret,
      wsUrl: account.websocketUrl,
      logger,
      heartbeatInterval: WS_HEARTBEAT_INTERVAL_MS,
      maxReconnectAttempts: WS_MAX_RECONNECT_ATTEMPTS,
      maxAuthFailureAttempts: WS_MAX_AUTH_FAILURE_ATTEMPTS,
      scene: SCENE_WECOM_OPENCLAW,
      plug_version: PLUGIN_VERSION,
    });

    // 防止 cleanup 被多次调用（abort handler、error handler、disconnected_event 可能竞态触发）
    let cleanedUp = false;

    // 清理函数：确保所有资源被释放（幂等）
    const cleanup = async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      stopMessageStateCleanup();
      await cleanupAccount(account.accountId);
    };

    // 处理中止信号（框架 stopChannel 会触发 abort）
    // resolve() 让 Promise settle → 框架清理 store.tasks/store.aborts
    if (abortSignal) {
      abortSignal.addEventListener("abort", async () => {
        runtime.log?.(`[${account.accountId}] Connection aborted`);
        wsClient.disconnect();
        await cleanup();
        resolve();
      });
    }

    // 监听连接事件
    wsClient.on("connected", () => {
      runtime.log?.(`[${account.accountId}] WebSocket connected`);
    });

    // 监听认证成功事件
    wsClient.on("authenticated", () => {
      runtime.log?.(`[${account.accountId}] Authentication successful`);
      setWeComWebSocket(account.accountId, wsClient);
    });

    // 监听断开事件
    wsClient.on("disconnected", (reason) => {
      runtime.log?.(`[${account.accountId}] WebSocket disconnected: ${reason}`);
    });

    // 监听被踢下线事件（服务端因新连接建立而主动断开旧连接）
    //
    // SDK 内部已设置 isManualClose=true 阻止 SDK 层自动重连，连接不会自行恢复。
    // **不 reject/resolve Promise**——保持 pending 以阻止框架层 auto-restart。
    //
    // 为什么不能 reject/resolve：
    //   - reject → 框架 auto-restart 介入 → 新连接建立 → 又被踢 → 两个实例互踢无限循环
    //   - resolve → 同上，框架 .then() 中的 auto-restart 也会触发
    //
    // Promise pending 的安全性：
    //   - store.tasks.has(id) = true → 阻止 Health Monitor 直接 startChannel（startChannel 检查 tasks.has）
    //   - 框架 stopChannel → abort() → abort handler 中 resolve() → tasks 正常清理
    //   - 用户修改配置 → config reload → stopChannel + startChannel → 正常恢复
    //
    // 显式调用 wsClient.disconnect() 确保 SDK 内部资源（定时器、队列等）完全释放。
    wsClient.on("event.disconnected_event", async () => {
      const errorMsg = `Kicked by server: a new connection was established elsewhere. Auto-restart is suppressed to avoid mutual kicking. Please check for duplicate instances.`;
      runtime.error?.(`[${account.accountId}] ${errorMsg}`);
      wsClient.disconnect();
      await cleanup();
      setStatus?.({
        accountId: account.accountId,
        running: false,
        lastError: errorMsg,
        lastStopAt: Date.now(),
      });
      // Promise 保持 pending，不触发 auto-restart
    });

    // 监听重连事件
    wsClient.on("reconnecting", (attempt) => {
      runtime.log?.(`[${account.accountId}] Reconnecting attempt ${attempt}...`);
    });

    // 监听错误事件
    wsClient.on("error", async (error) => {
      runtime.error?.(`[${account.accountId}] WebSocket error: ${error.message}`);

      if (error instanceof WSAuthFailureError) {
        // 认证失败重试次数用尽（SDK 层已重试 WS_MAX_AUTH_FAILURE_ATTEMPTS 次）。
        // 配置错误（如 botId/secret 无效），框架 auto-restart 也无法恢复。
        //
        // **不 reject/resolve Promise**——保持 pending 以阻止框架层 auto-restart。
        //
        // 为什么不能 reject/resolve：
        //   - reject/resolve → 框架 auto-restart（最多 10 次）× SDK 重试（5 次）= 60 次无意义尝试
        //   - 且 Health Monitor 每小时还会 resetRestartAttempts 再来一轮
        //
        // Promise pending 的安全性：同被踢下线场景
        //   - store.tasks.has(id) = true → 阻止 Health Monitor 直接 startChannel
        //   - 框架 stopChannel / config reload → abort handler 中 resolve() → 正常清理
        //   - 用户修改配置后框架通过 reload 机制重新启动
        const errorMsg = `Auth failure attempts exhausted (${WS_MAX_AUTH_FAILURE_ATTEMPTS} attempts). Please check botId/secret configuration.`;
        runtime.error?.(`[${account.accountId}] ${errorMsg}`);
        wsClient.disconnect();
        await cleanup();
        setStatus?.({
          accountId: account.accountId,
          running: false,
          lastError: errorMsg,
          lastStopAt: Date.now(),
        });
        return;
      }

      if (error instanceof WSReconnectExhaustedError) {
        // 网络断线重连次数用尽（SDK 层已重试 WS_MAX_RECONNECT_ATTEMPTS 次）。
        // 通常是网络/服务端问题，框架 auto-restart 可能恢复。
        //
        // reject Promise → 框架 auto-restart 介入（最多 MAX_RESTART_ATTEMPTS=10 次）
        // 总连接尝试次数 = (1 首次 + WS_MAX_RECONNECT_ATTEMPTS 重连) × (1 首轮 + 10 auto-restart)
        //                = 11 × 11 = 121 次
        //
        // 如果 Health Monitor 介入（每 5 分钟检查），会 resetRestartAttempts 重新计数，
        // 受限于 DEFAULT_MAX_RESTARTS_PER_HOUR=10，每小时最多额外 10 × 121 = 1210 次。
        // 但因网络断线通常是暂时性的，auto-restart + Health Monitor 的兜底机制是合理的。
        //
        // 显式调用 wsClient.disconnect() 确保 SDK 内部资源完全释放，
        // 避免旧实例的定时器/队列残留。
        wsClient.disconnect();
        cleanup().finally(() => reject(error));
        return;
      }
    });

    // 进入会话事件 → 欢迎语（对齐 wecom-kf replyWelcome）
    wsClient.on("event.enter_chat", async (frame: WsFrame<EventMessageWith<EnterChatEvent>>) => {
      const welcomeText = resolveWecomEnterChatWelcomeText(account.config);
      if (!welcomeText) {
        return;
      }
      try {
        await wsClient.replyWelcome(frame, {
          msgtype: "text",
          text: { content: welcomeText },
        });
        runtime.log?.(`[${account.accountId}] ws-event: sent enter_chat welcome`);
      } catch (err) {
        runtime.error?.(
          `[${account.accountId}] ws-event: replyWelcome failed: ${String(err)}`,
        );
      }
    });

    // 监听版本检查事件：收到 enter_check_update 时回复当前插件版本
    wsClient.on(EVENT_ENTER_CHECK_UPDATE as any, async (frame: WsFrame) => {
      try {
        // runtime.log?.(`[${account.accountId}] Received enter_check_update, replying with version=${PLUGIN_VERSION}`);
        await wsClient.reply(frame, { version: PLUGIN_VERSION }, CMD_ENTER_EVENT_REPLY);
      } catch (err) {
        // runtime.error?.(`[${account.accountId}] Failed to reply enter_check_update: ${String(err)}`);
      }
    });

    // 监听普通消息
    wsClient.on("message", async (frame: WsFrame) => {
      try {
        const entry = await prepareWeComMessage({
          frame,
          account,
          config,
          runtime,
          wsClient,
        });
        if (!entry) return;

        logWsTimingStage(
          entry.timing ??
            createWsTimingContext({
              accountId: entry.account.accountId,
              chatId: entry.chatId,
              messageId: entry.messageId,
            }),
          "prepare.done",
          { queueImmediate: !hasActiveTask(buildQueueKey(entry.account.accountId, entry.chatId)) },
        );

        const { status } = enqueueWeComChatTask({
          accountId: entry.account.accountId,
          chatId: entry.chatId,
          task: () => processWeComMessageNow(entry),
        });

        if (status === "queued") {
          logWsTimingStage(
            entry.timing ??
              createWsTimingContext({
                accountId: entry.account.accountId,
                chatId: entry.chatId,
                messageId: entry.messageId,
              }),
            "queue.enqueued",
          );
          runtime.log?.(
            `[wecom] Chat task queued for chat=${entry.chatId} (previous task still running)`,
          );
        } else {
          logWsTimingStage(
            entry.timing ??
              createWsTimingContext({
                accountId: entry.account.accountId,
                chatId: entry.chatId,
                messageId: entry.messageId,
              }),
            "queue.immediate",
          );
        }
      } catch (err) {
        runtime.error?.(`[${account.accountId}] Failed to process message: ${String(err)}`);
      }
    });

    // 监听所有事件回调（aibot_event_callback）。
    // 这里使用通用 event 监听，再按 eventtype 分发，兼容不同 SDK 版本在细分事件名上的差异。
    wsClient.on("event", async (frame: WsFrame) => {
      try {
        const eventBody = frame.body as MessageBody;
        const eventType = eventBody.event?.eventtype;
        runtime.log?.(
          `[${account.accountId}] Received event callback: eventtype=${eventType ?? ""}, msgid=${eventBody.msgid ?? ""}`,
        );

        if (eventType === "template_card_event") {
          const templateCardEvent = eventBody.event?.template_card_event;
          runtime.log?.(
            `[${account.accountId}] Received template_card_event: event_key=${templateCardEvent?.event_key ?? ""}, task_id=${templateCardEvent?.task_id ?? ""}`,
          );

          try {
            await updateTemplateCardOnEvent({
              frame,
              accountId: account.accountId,
              runtime,
              wsClient,
            });
          } catch (updateErr) {
            runtime.error?.(
              `[${account.accountId}] [template-card-update] Failed to update template card: ${String(updateErr)}`,
            );
          }
        } else if (eventType === "auth_change_event") {
          const authChangeEvent = eventBody.event?.auth_change_event;
          runtime.log?.(
            `[${account.accountId}] Received auth_change_event: auth_list=[${authChangeEvent?.auth_list?.join(", ") ?? ""}]`,
          );
        } else {
          // 其他未识别的事件类型，跳过
          return;
        }

        const entry = await prepareWeComMessage({
          frame,
          account,
          config,
          runtime,
          wsClient,
        });
        if (entry) {
          enqueueWeComChatTask({
            accountId: entry.account.accountId,
            chatId: entry.chatId,
            task: () => processWeComMessageNow(entry),
          });
        }
      } catch (err) {
        runtime.error?.(
          `[${account.accountId}] Failed to process event callback (${(frame.body as MessageBody)?.event?.eventtype ?? "unknown"}): ${String(err)}`,
        );
      }
    });

    runtime.log?.(
      `[${account.accountId}] Event listeners attached: message + event.enter_chat + event(template_card_event, auth_change_event)`,
    );

    // 启动前预热 reqId 缓存，确保完成后再建立连接，避免 getSync 在预热完成前返回 undefined
    warmupReqIdStore(account.accountId, (...args) => runtime.log?.(...args))
      .then((count) => {
        runtime.log?.(`[${account.accountId}] Warmed up ${count} reqId entries from disk`);
      })
      .catch((err) => {
        runtime.error?.(`[${account.accountId}] Failed to warmup reqId store: ${String(err)}`);
      })
      .finally(() => {
        // 无论预热成功或失败，都建立连接
        wsClient.connect();
      });
  });
}
