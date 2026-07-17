/**
 * @module wechat/auth/pairing
 *
 * 微信配对 allowFrom 与框架路径解析。
 */

import fs from "node:fs";
import path from "node:path";

import { withFileLock } from "openclaw/plugin-sdk/infra-runtime";

import { resolveStateDir } from "../storage/state-dir.js";
import { writePrivateJsonAtomic } from "../storage/atomic-json.js";
import { logger } from "../util/logger.js";

const MAX_ALLOW_FROM_ENTRIES = 10_000;
const MAX_USER_ID_LENGTH = 256;

function normalizeUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id.length <= MAX_USER_ID_LENGTH))]
    .slice(0, MAX_ALLOW_FROM_ENTRIES);
}

/**
 * Resolve the framework credentials directory (mirrors core resolveOAuthDir).
 * Path: $OPENCLAW_OAUTH_DIR || $OPENCLAW_STATE_DIR/credentials || ~/.openclaw/credentials
 */
function resolveCredentialsDir(): string {
  const override = process.env.OPENCLAW_OAUTH_DIR?.trim();
  if (override) return override;
  return path.join(resolveStateDir(), "credentials");
}

/**
 * Sanitize a channel/account key for safe use in filenames (mirrors core safeChannelKey).
 */
function safeKey(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) throw new Error("invalid key for allowFrom path");
  const safe = trimmed.replace(/[\\/:*?"<>|]/g, "_").replace(/\.\./g, "_");
  if (!safe || safe === "_") throw new Error("invalid key for allowFrom path");
  return safe;
}

/**
 * Resolve the framework allowFrom file path for a given account.
 * Mirrors: `resolveAllowFromPath(channel, env, accountId)` from core.
 * Path: `<credDir>/openclaw-weixin-<accountId>-allowFrom.json`
 */
export function resolveFrameworkAllowFromPath(accountId: string): string {
  const base = safeKey("openclaw-weixin");
  const safeAccount = safeKey(accountId);
  return path.join(resolveCredentialsDir(), `${base}-${safeAccount}-allowFrom.json`);
}

type AllowFromFileContent = {
  version: number;
  allowFrom: string[];
};

/**
 * Read the framework allowFrom list for an account (user IDs authorized via pairing).
 * Returns an empty array when the file is missing or unreadable.
 */
export function readFrameworkAllowFromList(accountId: string): string[] {
  const filePath = resolveFrameworkAllowFromPath(accountId);
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as AllowFromFileContent;
    return normalizeUserIds(parsed.allowFrom);
  } catch {
    // best-effort
  }
  return [];
}

/** File lock options matching the framework's pairing store lock settings. */
const LOCK_OPTIONS = {
  retries: { retries: 3, factor: 2, minTimeout: 100, maxTimeout: 2000 },
  stale: 10_000,
};

/**
 * Register a user ID in the framework's channel allowFrom store.
 * This writes directly to the same JSON file that `readChannelAllowFromStore` reads,
 * making the user visible to the framework authorization pipeline.
 *
 * Uses file locking to avoid races with concurrent readers/writers.
 */
export async function registerUserInFrameworkStore(params: {
  accountId: string;
  userId: string;
}): Promise<{ changed: boolean }> {
  const { accountId, userId } = params;
  const trimmedUserId = userId.trim();
  if (!trimmedUserId) return { changed: false };
  if (trimmedUserId.length > MAX_USER_ID_LENGTH) {
    throw new Error(`weixin userId exceeds ${MAX_USER_ID_LENGTH} characters`);
  }

  const filePath = resolveFrameworkAllowFromPath(accountId);

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  // Ensure the file exists before locking
  if (!fs.existsSync(filePath)) {
    const initial: AllowFromFileContent = { version: 1, allowFrom: [] };
    writePrivateJsonAtomic(filePath, initial);
  }

  return await withFileLock(filePath, LOCK_OPTIONS, async () => {
    let content: AllowFromFileContent = { version: 1, allowFrom: [] };
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as AllowFromFileContent;
      content = { version: 1, allowFrom: normalizeUserIds(parsed.allowFrom) };
    } catch {
      // If read/parse fails, start fresh
    }

    if (content.allowFrom.includes(trimmedUserId)) {
      return { changed: false };
    }

    if (content.allowFrom.length >= MAX_ALLOW_FROM_ENTRIES) {
      throw new Error(`weixin allowFrom store reached ${MAX_ALLOW_FROM_ENTRIES} entries`);
    }

    content.allowFrom.push(trimmedUserId);
    writePrivateJsonAtomic(filePath, content);
    logger.info("registerUserInFrameworkStore: authorized user added");
    return { changed: true };
  });
}
