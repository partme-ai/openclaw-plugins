/**
 * @module agent/agent-reply-delivery
 *
 * Agent Webhook 出站回复：解析 MEDIA 指令、发送文本与媒体（upload + send）。
 */

import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  isHttpUrl,
  parseMediaDirectives,
  resolveOutboundMedia,
} from "@partme.ai/openclaw-message-sdk";

import { sendText, uploadMedia, sendMedia as sendAgentMedia } from "./api-client.js";
import { getWecomKfChannelBlock } from "../config/channel-block.js";
import { getExtendedMediaLocalRoots, readGuardedLocalMediaFile } from "../media/path-guard.js";
import type { ResolvedAgentAccount } from "../types/index.js";
import type { WecomConfig } from "../types/config.js";

/** 扩展名 → MIME（Agent 出站媒体推断） */
const AGENT_OUTBOUND_MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  amr: "audio/amr",
  mp4: "video/mp4",
  mov: "video/quicktime",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
};

/**
 * 解析企微 Agent API 媒体类型。
 */
function resolveWecomAgentMediaType(contentType: string): "image" | "voice" | "video" | "file" {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("audio/")) return "voice";
  if (contentType.startsWith("video/")) return "video";
  return "file";
}

/**
 * 加载 Agent 出站媒体字节（远程 URL 或本地路径，本地路径走 path guard）。
 */
export async function loadAgentOutboundMediaBuffer(params: {
  cfg: OpenClawConfig;
  mediaPath: string;
}): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const source = params.mediaPath.trim();
  if (isHttpUrl(source)) {
    const loaded = await resolveOutboundMedia({
      pathOrUrl: source,
      mimeByExt: AGENT_OUTBOUND_MIME_MAP,
      fetchRemoteMedia: async ({ url }) => {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`download failed: ${res.status}`);
        return {
          buffer: Buffer.from(await res.arrayBuffer()),
          contentType: res.headers.get("content-type") || "application/octet-stream",
          fileName: new URL(url).pathname.split("/").pop() || "media",
        };
      },
    });
    return {
      buffer: loaded.buffer,
      contentType: loaded.contentType ?? "application/octet-stream",
      filename: loaded.filename,
    };
  }

  const wecomConfig = getWecomKfChannelBlock(params.cfg) as WecomConfig | undefined;
  const allowedRoots = await getExtendedMediaLocalRoots(wecomConfig);
  const guarded = await readGuardedLocalMediaFile({ filePath: source, allowedRoots });
  if (!guarded.ok) {
    throw new Error(guarded.error);
  }

  const ext = path.extname(source).slice(1).toLowerCase();
  return {
    buffer: guarded.buffer,
    filename: path.basename(source),
    contentType: AGENT_OUTBOUND_MIME_MAP[ext] ?? "application/octet-stream",
  };
}

/**
 * 解析 Agent 回复 payload 并发送文本 + 媒体。
 */
export async function deliverAgentReplyPayload(params: {
  cfg: OpenClawConfig;
  agent: ResolvedAgentAccount;
  toUser: string;
  text: string;
  mediaUrls?: string[];
  mediaUrl?: string;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
  infoKind?: string;
}): Promise<void> {
  const parsed = parseMediaDirectives(String(params.text ?? ""));
  const text = parsed.text;
  const mediaPaths = Array.from(
    new Set([
      ...(params.mediaUrls ?? []),
      ...(params.mediaUrl ? [params.mediaUrl] : []),
      ...parsed.paths,
    ]),
  );

  if (text.trim()) {
    try {
      await sendText({ agent: params.agent, toUser: params.toUser, chatId: undefined, text });
      params.log?.(
        `[wecom-agent] reply delivered (${params.infoKind ?? "reply"}) to ${params.toUser} (textLen=${text.length})`,
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? `${err.message}${err.cause ? ` (cause: ${String(err.cause)})` : ""}`
          : String(err);
      params.error?.(`[wecom-agent] reply failed: ${message}`);
    }
  }

  for (const mediaPath of mediaPaths) {
    try {
      const { buffer: buf, contentType, filename } = await loadAgentOutboundMediaBuffer({
        cfg: params.cfg,
        mediaPath,
      });
      const mediaType = resolveWecomAgentMediaType(contentType);

      params.log?.(
        `[wecom-agent] uploading media: ${filename} (${mediaType}, ${contentType}, ${buf.length} bytes)`,
      );

      const mediaId = await uploadMedia({
        agent: params.agent,
        type: mediaType,
        buffer: buf,
        filename,
      });

      await sendAgentMedia({
        agent: params.agent,
        toUser: params.toUser,
        mediaId,
        mediaType,
        ...(mediaType === "video" ? { title: filename, description: "" } : {}),
      });

      params.log?.(
        `[wecom-agent] media sent (${params.infoKind ?? "reply"}) to ${params.toUser}: ${filename} (${mediaType})`,
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? `${err.message}${err.cause ? ` (cause: ${String(err.cause)})` : ""}`
          : String(err);
      params.error?.(`[wecom-agent] media send failed: ${mediaPath}: ${message}`);
      try {
        await sendText({
          agent: params.agent,
          toUser: params.toUser,
          chatId: undefined,
          text: `⚠️ 文件发送失败: ${mediaPath.split("/").pop() || mediaPath}\n${message}`,
        });
      } catch {
        // ignore secondary failure
      }
    }
  }
}
