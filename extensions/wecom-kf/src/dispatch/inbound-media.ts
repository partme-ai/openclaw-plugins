/**
 * @module dispatch/inbound-media
 *
 * KF 入站媒体：downloadMedia → saveMediaBuffer → 可选 ASR（voice）→ Agent 上下文。
 */

import { pathToFileURL } from "node:url";
import path from "node:path";
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";

import { downloadMedia } from "../agent/api-client.js";
import { isKfVoiceAsrEnabled, transcribeKfVoice } from "../agent/asr.js";
import { resolveWecomMediaMaxBytes } from "../config/index.js";
import { resolveKfAgentAccount } from "../kf/call-context.js";
import type { KfMessage } from "../types/index.js";
import { extractInboundMediaId, isInboundMediaMessage } from "../bot.js";

export type KfInboundMediaContext = {
  finalContent: string;
  attachments: Array<{ name: string; mimeType: string; url: string }>;
  mediaPath?: string;
  mediaType?: string;
};

function looksLikeTextFile(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 4096);
  if (sampleSize === 0) return true;
  let bad = 0;
  for (let i = 0; i < sampleSize; i++) {
    const b = buffer[i]!;
    const isWhitespace = b === 0x09 || b === 0x0a || b === 0x0d;
    const isPrintable = b >= 0x20 && b !== 0x7f;
    if (!isWhitespace && !isPrintable) bad++;
  }
  return bad / sampleSize <= 0.02;
}

function buildTextFilePreview(buffer: Buffer, maxChars: number): string | undefined {
  if (!looksLikeTextFile(buffer)) return undefined;
  const text = buffer.toString("utf8");
  if (!text.trim()) return undefined;
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(已截断)` : text;
}

/**
 * 下载并归档 KF 入站媒体，构建 Agent 可消费的文本与附件元数据。
 */
export async function buildKfInboundMediaContext(params: {
  cfg: OpenClawConfig;
  msg: KfMessage;
  openKfId: string;
  baseContent: string;
  core: PluginRuntime;
  log?: (message: string) => void;
  error?: (message: string) => void;
}): Promise<KfInboundMediaContext> {
  const { msg, openKfId, baseContent, core } = params;
  const logger = {
    info: (message: string) => params.log?.(`[wecom-kf] ${message}`),
    error: (message: string) => params.error?.(`[wecom-kf] [ERROR] ${message}`),
  };

  if (!isInboundMediaMessage(msg)) {
    return { finalContent: baseContent, attachments: [] };
  }

  const mediaId = extractInboundMediaId(msg);
  if (!mediaId) {
    return { finalContent: baseContent, attachments: [] };
  }

  const agent = resolveKfAgentAccount(params.cfg, openKfId);
  if (!agent) {
    return {
      finalContent: `${baseContent}\n\n媒体处理失败：缺少 corp 凭证 open_kfid=${openKfId}`,
      attachments: [],
    };
  }

  const msgtype = String(msg.msgtype);
  const mediaMaxBytes = resolveWecomMediaMaxBytes(params.cfg);

  try {
    const { buffer, contentType, filename: headerFileName } = await downloadMedia({
      agent,
      mediaId,
      maxBytes: mediaMaxBytes,
    });

    const fileBucket = (msg as Record<string, unknown>)[msgtype] as { filename?: string } | undefined;
    const originalFileName = (fileBucket?.filename || headerFileName || `${mediaId}.bin`).trim();

    const extMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "audio/amr": "amr",
      "audio/speex": "speex",
      "video/mp4": "mp4",
    };
    const textPreview = msgtype === "file" ? buildTextFilePreview(buffer, 12_000) : undefined;
    const looksText = Boolean(textPreview);
    const originalExt = path.extname(originalFileName).toLowerCase();
    const normalizedContentType =
      looksText && originalExt === ".md"
        ? "text/markdown"
        : looksText && (!contentType || contentType === "application/octet-stream")
          ? "text/plain; charset=utf-8"
          : contentType;

    const saved = await core.channel.media.saveMediaBuffer(
      buffer,
      normalizedContentType,
      "inbound",
      mediaMaxBytes,
      originalFileName,
    );

    const attachments = [
      {
        name: originalFileName,
        mimeType: normalizedContentType,
        url: pathToFileURL(saved.path).href,
      },
    ];

    let finalContent = baseContent;

    if (msgtype === "voice" && isKfVoiceAsrEnabled(agent)) {
      try {
        const transcript = await transcribeKfVoice(agent, buffer);
        if (transcript.trim()) {
          finalContent = [baseContent, "", "语音转写：", transcript.trim()].join("\n");
        }
      } catch (err) {
        logger.error(`voice ASR failed: ${String(err)}`);
      }
    } else if (textPreview) {
      finalContent = [
        baseContent,
        "",
        "文件内容预览：",
        "```",
        textPreview,
        "```",
        `(已下载 ${buffer.length} 字节)`,
      ].join("\n");
    } else if (msgtype === "file") {
      finalContent = [
        baseContent,
        "",
        `已收到文件：${originalFileName}`,
        `文件类型：${normalizedContentType || contentType || "未知"}`,
        `(已下载 ${buffer.length} 字节)`,
      ].join("\n");
    } else {
      finalContent = `${baseContent} (已下载 ${buffer.length} 字节，类型=${extMap[normalizedContentType] ?? msgtype})`;
    }

    logger.info(`inbound media saved msgtype=${msgtype} mediaId=${mediaId} path=${saved.path}`);

    return {
      finalContent,
      attachments,
      mediaPath: saved.path,
      mediaType: normalizedContentType,
    };
  } catch (err) {
    logger.error(`inbound media failed msgtype=${msgtype} mediaId=${mediaId}: ${String(err)}`);
    return {
      finalContent: [
        baseContent,
        "",
        `媒体处理失败：${String(err)}`,
        `提示：可在配置中提高 channels.wecom-kf.media.maxBytes（当前=${mediaMaxBytes}）`,
      ].join("\n"),
      attachments: [],
    };
  }
}
