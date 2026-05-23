/**
 * @module outbound/reply-deliver
 *
 * 企微 **Webhook Bot** 出站回复投递（stream 增量 + 媒体 + 模板卡片）。
 *
 * **职责**：
 * - 预处理 Markdown/表格（`preprocessOutboundReply`）
 * - 检测 template_card JSON 并经 response_url 发送
 * - 将文本/图片写入 streamStore，同步 streaming 配置与 footer
 * - 非图片媒体委托 `media-deliver`（Agent DM fallback）
 *
 * **上下游**：
 * - 上游：`webhook/reply-pipeline` dispatch deliver 回调
 * - 下游：`streaming-config`、`template-card`、`media-deliver`
 */

import type { PluginRuntime, ReplyPayload } from "../runtime/runtime-api.js";
import {
  extractLocalImagePathsFromText,
  formatReasoningMessage,
  isImageContentType,
  preprocessOutboundReply,
  resolveOutboundMedia,
} from "../runtime/runtime-api.js";
import { getWeComRuntime } from "../runtime.js";
import type { WecomWebhookTarget } from "../webhook/types.js";
import { STREAM_MAX_BYTES } from "../webhook/types.js";
import { getMonitorState } from "../webhook/gateway.js";
import {
  appendDmContent,
  computeMd5,
  MIME_BY_EXT,
  truncateUtf8Bytes,
} from "../webhook/inbound-helpers.js";
import { deliverTemplateCardIfPresent } from "./template-card.js";
import { handleBotWindowNearTimeout } from "./bot-window.js";
import { deliverMediaLoadError, deliverNonImageMedia } from "./media-deliver.js";
import {
  resolveWecomStreamingConfig,
  syncWecomStreamContent,
} from "../config/streaming-config.js";
import { resolveWecomTemplates } from "../config/templates.js";

export type DeliverWecomReplyContext = {
  payload: ReplyPayload;
  info: { kind?: string };
  target: WecomWebhookTarget;
  streamId: string;
  chatType: string;
  rawBody: string;
  tableMode: Parameters<PluginRuntime["channel"]["text"]["convertMarkdownTables"]>[1];
};

/**
 * 将 Agent 回复写入 stream 并触发企微侧 refresh 投递。
 */
export async function deliverWecomReply(ctx: DeliverWecomReplyContext): Promise<void> {
  const core = getWeComRuntime();
  const { payload, info, target, streamId, chatType, rawBody, tableMode } = ctx;
  const { streamStore } = getMonitorState();
  const streamingConfig = resolveWecomStreamingConfig(target.account);
  const templates = resolveWecomTemplates(target.account);

  const pre = await preprocessOutboundReply({
    payload,
    formatReasoning: formatReasoningMessage,
    convertMarkdownTables: (t: string) => core.channel.text.convertMarkdownTables(t, tableMode),
    tableMode,
  });
  let text = pre.text;

  const card = await deliverTemplateCardIfPresent({
    target,
    streamId,
    chatType,
    trimmedText: text.trim(),
    streamStore,
  });
  if (card.handled) return;
  if (card.fallbackText) text = card.fallbackText;

  const current = streamStore.getStream(streamId);
  if (!current) return;
  if (!current.images) current.images = [];
  if (!current.agentMediaKeys) current.agentMediaKeys = [];

  if (!pre.hasMedia && text.includes("/")) {
    for (const p of extractLocalImagePathsFromText({ text, mustAlsoAppearIn: rawBody })) {
      try {
        const loaded = await resolveOutboundMedia({
          pathOrUrl: p,
          mimeByExt: MIME_BY_EXT,
          fetchRemoteMedia: core.channel.media.fetchRemoteMedia,
        });
        if (!isImageContentType(loaded.contentType)) continue;
        current.images.push({
          base64: loaded.buffer.toString("base64"),
          md5: computeMd5(loaded.buffer),
        });
      } catch (err) {
        target.runtime.error?.(`[webhook] media: 读取本机图片失败 path=${p}: ${String(err)}`);
      }
    }
  }

  if (text.trim()) {
    streamStore.updateStream(streamId, (s) => appendDmContent(s, text));
  }
  if (await handleBotWindowNearTimeout({ target, streamId, current, streamStore })) return;

  for (const mPath of pre.mediaUrls) {
    try {
      const loaded = await resolveOutboundMedia({
        pathOrUrl: mPath,
        mimeByExt: MIME_BY_EXT,
        fetchRemoteMedia: core.channel.media.fetchRemoteMedia,
      });
      if (isImageContentType(loaded.contentType)) {
        current.images.push({
          base64: loaded.buffer.toString("base64"),
          md5: computeMd5(loaded.buffer),
        });
        continue;
      }
      await deliverNonImageMedia({
        target,
        streamId,
        current,
        mPath,
        contentType: loaded.contentType,
        filename: loaded.filename,
      });
      return;
    } catch (err) {
      await deliverMediaLoadError({ target, streamId, current, mPath, err });
      return;
    }
  }

  if (streamStore.getStream(streamId)?.fallbackMode) return;

  const isFinal = info?.kind === "final";
  const pushAnswerIncrementally =
    streamingConfig.streaming && streamingConfig.streamingContent && !isFinal;

  streamStore.updateStream(streamId, (s) => {
    if (text.trim()) {
      const nextAnswer = s.answerText ? `${s.answerText}\n\n${text}`.trim() : text.trim();
      s.answerText = nextAnswer;
    }
    syncWecomStreamContent(s, streamingConfig, {
      includeAnswer: isFinal || pushAnswerIncrementally,
      includeFooter: isFinal,
      includeStatus: true,
      templates,
    });
    s.content = truncateUtf8Bytes(s.content, STREAM_MAX_BYTES) || s.content;
    if (current.images?.length) s.images = current.images;
  });

  target.statusSink?.({ lastOutboundAt: Date.now() });
  if (isFinal) {
    target.runtime.log?.(
      `[webhook] deliver final streamId=${streamId} len=${text.length} answerLen=${current.answerText?.length ?? 0}`,
    );
  }
}
