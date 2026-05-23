/**
 * @module ws-media
 *
 * WS 流式回复中的原生图片项构建（base64 内联）。
 *
 * **职责**：读取本地图片文件，校验扩展名/大小，生成 SDK `ReplyMsgItem`（image.base64 + md5），
 * 供 `replyStream` 多模态气泡附带图片（单条 stream 最多 {@link WECOM_REPLY_MSG_ITEM_LIMIT} 项）。
 *
 * **适用场景**：`ws-reply-pipeline` 在 WS 模式下将 Agent 输出的本地图片路径转为企微原生图片消息项。
 *
 * **限制**：
 * - 仅支持 `.jpg` / `.jpeg` / `.png`，最大 {@link WECOM_NATIVE_IMAGE_MAX_BYTES}（10MB）
 * - 不支持 http(s) URL（返回 `null`，由其他通路处理）
 *
 * **关键导出**：`buildWecomNativeReplyImageItem`、`WECOM_REPLY_MSG_ITEM_LIMIT`
 */

import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

import type { ReplyMsgItem } from "@wecom/aibot-node-sdk";

/** 企微 WS 原生图片单文件大小上限（10MB） */
const WECOM_NATIVE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** 允许的图片扩展名 */
const WECOM_NATIVE_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
/** 允许的 MIME（预留，当前未做 file-type 探测） */
const WECOM_NATIVE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

/** 单条 stream 回复可携带的 msg_item 数量上限 */
export const WECOM_REPLY_MSG_ITEM_LIMIT = 10;

/** SDK ReplyMsgItem 别名 */
export type WecomReplyMsgItem = ReplyMsgItem;

/** 本地文件读取结果 */
interface MediaReadResult {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
}

/**
 * 从本地路径读取媒体文件（含大小校验）。
 *
 * @param filePath - 本地文件路径
 * @param options.maxSize - 可选大小上限（字节）
 * @returns buffer、文件名、MIME（未探测时为 undefined）
 * @throws 非文件或超限
 */
async function readMediaFromLocal(filePath: string, options: { maxSize?: number } = {}): Promise<MediaReadResult> {
  const resolvedPath = path.resolve(filePath);
  const stat = await fs.stat(resolvedPath);

  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${resolvedPath}`);
  }

  if (options.maxSize && stat.size > options.maxSize) {
    throw new Error(`File size ${stat.size} exceeds maximum ${options.maxSize}`);
  }

  const buffer = await fs.readFile(resolvedPath);
  const fileName = path.basename(resolvedPath);

  return {
    buffer,
    fileName,
    mimeType: undefined, // Could be detected by file-type library if needed
  };
}

/**
 * 构建企微 WS 原生图片 ReplyMsgItem。
 *
 * @param params.source - 本地文件路径（http URL 直接返回 null）
 * @param params.log - 可选 debug 日志
 * @returns SDK 图片项；不支持/失败时返回 `null`（不抛错）
 */
export async function buildWecomNativeReplyImageItem(params: {
  source: string;
  log?: { debug?: (message: string) => void };
}): Promise<WecomReplyMsgItem | null> {
  const source = String(params.source ?? "").trim();
  if (!source || /^https?:\/\//i.test(source)) return null;

  try {
    const media = await readMediaFromLocal(source, {
      maxSize: WECOM_NATIVE_IMAGE_MAX_BYTES,
    });
    const ext = path.extname(media.fileName ?? source).toLowerCase();
    if (!WECOM_NATIVE_IMAGE_EXTENSIONS.has(ext)) return null;

    // Skip MIME type check since we're not detecting it
    // The original code checked media.mimeType but we're not populating it

    return {
      msgtype: "image",
      image: {
        base64: media.buffer.toString("base64"),
        md5: crypto.createHash("md5").update(media.buffer).digest("hex"),
      },
    };
  } catch (err) {
    params.log?.debug?.(`[wecom] native ws image unavailable for ${source}: ${String(err)}`);
    return null;
  }
}
