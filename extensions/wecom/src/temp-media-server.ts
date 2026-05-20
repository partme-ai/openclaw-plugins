/**
 * Temporary Media Server
 *
 * Handles temporary media serving for WeCom outbound messages.
 * Implements token-based authentication and 15-minute TTL.
 *
 * Source: openclaw-china/wecom/src/outbound-reply.ts (partial)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";

type TempMediaEntry = {
  id: string;
  token: string;
  filePath: string;
  fileName: string;
  createdAt: number;
  expiresAt: number;
};

const TEMP_MEDIA_TTL_MS = 15 * 60 * 1000;
const TEMP_MEDIA_PREFIX = "/wecom-media";

const tempMedia = new Map<string, TempMediaEntry>();

function now(): number {
  return Date.now();
}

function guessContentType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".json":
      return "application/json";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
}

function pruneExpiredTempMedia(): void {
  const ts = now();
  for (const [id, item] of tempMedia.entries()) {
    if (item.expiresAt <= ts) {
      tempMedia.delete(id);
    }
  }
}

export async function registerTempLocalMedia(params: {
  filePath: string;
  fileName?: string;
}): Promise<{ id: string; token: string; fileName: string }> {
  pruneExpiredTempMedia();
  const absPath = path.resolve(params.filePath);
  const stat = await fs.stat(absPath);
  if (!stat.isFile()) {
    throw new Error(`Local media path is not a file: ${absPath}`);
  }
  const id = randomBytes(12).toString("hex");
  const token = randomBytes(16).toString("hex");
  const fileName = (params.fileName?.trim() || path.basename(absPath) || "file.bin").replace(/[^\w.\-]/g, "_");
  tempMedia.set(id, {
    id,
    token,
    filePath: absPath,
    fileName,
    createdAt: now(),
    expiresAt: now() + TEMP_MEDIA_TTL_MS,
  });
  return { id, token, fileName };
}

export function buildTempMediaUrl(params: {
  baseUrl: string;
  id: string;
  token: string;
  fileName: string;
}): string {
  const base = params.baseUrl.replace(/\/+$/, "");
  const safeName = encodeURIComponent(params.fileName);
  return `${base}${TEMP_MEDIA_PREFIX}/${params.id}/${safeName}?token=${encodeURIComponent(params.token)}`;
}

export async function handleTempMediaRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  pruneExpiredTempMedia();
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith(`${TEMP_MEDIA_PREFIX}/`)) return false;

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method Not Allowed");
    return true;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  // /wecom-media/:id/:filename
  if (parts.length < 2) {
    res.statusCode = 404;
    res.end("Not Found");
    return true;
  }
  const id = parts[1] ?? "";
  const token = String(url.searchParams.get("token") ?? "").trim();
  const entry = tempMedia.get(id);
  if (!entry || !token || token !== entry.token) {
    res.statusCode = 404;
    res.end("Not Found");
    return true;
  }

  try {
    const data = await fs.readFile(entry.filePath);
    res.statusCode = 200;
    res.setHeader("Content-Type", guessContentType(entry.fileName));
    res.setHeader("Content-Disposition", `inline; filename="${entry.fileName}"`);
    res.end(data);
    return true;
  } catch {
    tempMedia.delete(id);
    res.statusCode = 404;
    res.end("Not Found");
    return true;
  }
}

// Only for tests
export function clearTempMediaState(): void {
  tempMedia.clear();
}
