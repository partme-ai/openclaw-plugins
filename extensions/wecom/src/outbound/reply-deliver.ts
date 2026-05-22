/**
 * WeCom Webhook 出站回复投递（stream 更新、媒体、模板卡片）。
 */

import type { PluginRuntime, ReplyPayload } from "../runtime-api.js";
import {
  extractLocalImagePathsFromText,
  formatReasoningMessage,
  isImageContentType,
  preprocessOutboundReply,
  resolveOutboundMedia,
} from "../runtime-api.js";
import { getWeComRuntime } from "../runtime.js";
import type { WecomWebhookTarget } from "../webhook/types.js";
import { STREAM_MAX_BYTES } from "../webhook/types.js";
import { getMonitorState } from "../webhook/gateway.js";
import {
  appendDmContent,
  computeMd5,
  MIME_BY_EXT,
  truncateUtf8Bytes,
} from "../webhook/helpers.js";
import { deliverTemplateCardIfPresent } from "./template-card.js";
import { handleBotWindowNearTimeout } from "./bot-window.js";
import { deliverMediaLoadError, deliverNonImageMedia } from "./media-deliver.js";
export type DeliverWecomReplyContext = {
  payload: ReplyPayload;
  info: { kind?: string };
  target: WecomWebhookTarget;
  streamId: string;
  chatType: string;
  rawBody: string;
  tableMode: Parameters<PluginRuntime["channel"]["text"]["convertMarkdownTables"]>[1];
};

/** 将 Agent 回复写入 stream 并触发企微侧投递。 */
export async function deliverWecomReply(ctx: DeliverWecomReplyContext): Promise<void> {
  const core = getWeComRuntime();
  const { payload, info, target, streamId, chatType, rawBody, tableMode } = ctx;
  const { streamStore } = getMonitorState();

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
  const nextText = current.content ? `${current.content}\n\n${text}`.trim() : text.trim();
  streamStore.updateStream(streamId, (s) => {
    s.content = truncateUtf8Bytes(nextText, STREAM_MAX_BYTES);
    if (current.images?.length) s.images = current.images;
  });
  target.statusSink?.({ lastOutboundAt: Date.now() });
  if (info?.kind === "final") {
    target.runtime.log?.(`[webhook] deliver final streamId=${streamId} len=${text.length}`);
  }
}
