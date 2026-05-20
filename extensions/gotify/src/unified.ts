/**
 * Gotify ↔ UnifiedMessage 转换层
 *
 * 确保 Gotify 插件通过消息队列与其他渠道互通时，
 * 所有消息都使用 @partme.ai/openclaw-message-sdk 的统一格式。
 */

import type {
  UnifiedMessage,
  MediaReference,
  MediaKind,
} from "@partme.ai/openclaw-message-sdk";
import {
  generateMessageId,
  generateTraceId,
  detectMediaKind,
} from "@partme.ai/openclaw-message-sdk";

import type { GotifyMessagePayload } from "./types.js";
import type { ResolvedGotifyAccount } from "./types.js";

// ============================================================================
// Gotify → Unified
// ============================================================================

export interface GotifyToUnifiedParams {
  payload: GotifyMessagePayload;
  account: ResolvedGotifyAccount;
  userId?: string;
}

export function gotifyToUnifiedMessage(params: GotifyToUnifiedParams): UnifiedMessage {
  const text = [params.payload.title, params.payload.message]
    .filter(Boolean)
    .join("\n");

  // 从消息文本中解析媒体引用
  const media: MediaReference[] = [];
  const urlRe = /https?:\/\/\S+\.(png|jpg|jpeg|gif|webp|svg|mp4|mov|mp3|wav|pdf|docx?|xlsx?|pptx?|zip)(\?\S*)?/gi;
  const seen = new Set<string>();
  for (const m of text.matchAll(urlRe)) {
    const url = m[0];
    if (!seen.has(url)) {
      seen.add(url);
      const ext = m[1].toLowerCase();
      let kind: MediaKind = "other";
      if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) kind = "image";
      else if (["mp4", "mov"].includes(ext)) kind = "video";
      else if (["mp3", "wav"].includes(ext)) kind = "audio";
      else if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) kind = "document";
      media.push({ url, kind, mimeType: "application/octet-stream", fileName: url.split("/").pop() });
    }
  }

  return {
    messageId: generateMessageId("gotify"),
    traceId: generateTraceId(),
    timestamp: Date.now(),
    source: {
      channel: "gotify",
      accountId: params.account.accountId,
      userId: params.userId ?? "gotify-user",
      chatType: "direct",
    },
    contentType: media.length > 0 ? "mixed" : "text",
    text,
    media,
    metadata: {
      priority: params.payload.priority,
      extras: params.payload.extras,
    },
    direction: "inbound",
  };
}

// ============================================================================
// Unified → Gotify
// ============================================================================

export function unifiedToGotifyPayload(msg: UnifiedMessage): GotifyMessagePayload {
  let body = msg.text;

  // Markdown → 纯文本降级（Gotify 不支持 Markdown）
  if (msg.markdown) {
    body += "\n\n" + msg.markdown
      .replace(/[#*>_`[\]()]/g, "")
      .replace(/!\[.*?\]\(.*?\)/g, "[图片]");
  }

  // 媒体文件 → 链接
  if (msg.media.length > 0) {
    body += "\n\n--- 附件 ---";
    for (const m of msg.media) {
      const label = m.kind === "image" ? "📷" : m.kind === "video" ? "🎬" : m.kind === "audio" ? "🎵" : "📄";
      body += `\n${label} ${m.fileName ?? m.url}: ${m.url}`;
    }
  }

  const firstLine = body.split("\n")[0]?.slice(0, 120) ?? "";

  return {
    title: firstLine || "新消息",
    message: body,
    priority: (msg.metadata?.priority as number) ?? 5,
    extras: msg.metadata?.extras as Record<string, unknown> | undefined,
  };
}
