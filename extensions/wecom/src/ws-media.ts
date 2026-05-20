/**
 * WS Media Adapter
 *
 * Provides native WS image reply mode for WeCom streaming responses.
 * Creates base64-encoded image items for WS stream replies.
 *
 * Source: openclaw-china/wecom/src/ws-media.ts
 */

import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

import type { ReplyMsgItem } from "@wecom/aibot-node-sdk";

const WECOM_NATIVE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const WECOM_NATIVE_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
const WECOM_NATIVE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

export const WECOM_REPLY_MSG_ITEM_LIMIT = 10;

export type WecomReplyMsgItem = ReplyMsgItem;

interface MediaReadResult {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
}

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
