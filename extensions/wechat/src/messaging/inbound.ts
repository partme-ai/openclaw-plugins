/**
 * @module wechat/messaging/inbound
 *
 * 入站消息 **上下文转换** 与 **contextToken 持久化**。
 *
 * **职责**：
 * - `contextToken` 内存 Map + 磁盘 JSON（Gateway 重启后恢复 outbound 能力）
 * - `weixinMessageToMsgContext`：WeixinMessage → OpenClaw MsgContext（含媒体路径）
 * - 多账号 contextToken 反查（outbound 无显式 accountId 时）
 *
 * **关键导出**：`weixinMessageToMsgContext`、`setContextToken`、`restoreContextTokens`
 */

import fs from "node:fs";
import path from "node:path";

import { logger } from "../util/logger.js";
import { generateId } from "../util/random.js";
import type { WeixinMessage, MessageItem } from "../api/types.js";
import { MessageItemType } from "../api/types.js";
import { resolveStateDir } from "../storage/state-dir.js";
import { writePrivateJsonAtomic } from "../storage/atomic-json.js";

// ---------------------------------------------------------------------------
// Context token store (in-process cache + disk persistence)
// ---------------------------------------------------------------------------

/**
 * contextToken is issued per-message by the Weixin getupdates API and must
 * be echoed verbatim in every outbound send. The in-memory map is the primary
 * lookup; a disk-backed file per account ensures tokens survive gateway restarts.
 */
const contextTokenStore = new Map<string, string>();
const MAX_CONTEXT_TOKENS_PER_ACCOUNT = 10_000;
const MAX_CONTEXT_TOKEN_FILE_BYTES = 4 * 1024 * 1024;
const MAX_CONTEXT_TOKEN_LENGTH = 16 * 1024;
const MAX_CONTEXT_USER_ID_LENGTH = 256;

function contextTokenKey(accountId: string, userId: string): string {
  return `${accountId}:${userId}`;
}

// ---------------------------------------------------------------------------
// Disk persistence helpers
// ---------------------------------------------------------------------------

function resolveContextTokenFilePath(accountId: string): string {
  return path.join(
    resolveStateDir(),
    "openclaw-weixin",
    "accounts",
    `${accountId}.context-tokens.json`,
  );
}

/** Persist all context tokens for a given account to disk. */
function persistContextTokens(accountId: string): void {
  const prefix = `${accountId}:`;
  const tokens: Record<string, string> = {};
  for (const [k, v] of contextTokenStore) {
    if (k.startsWith(prefix)) {
      tokens[k.slice(prefix.length)] = v;
    }
  }
  const filePath = resolveContextTokenFilePath(accountId);
  try {
    writePrivateJsonAtomic(filePath, tokens);
  } catch (err) {
    logger.warn(`persistContextTokens: private state write failed: ${err instanceof Error ? err.name : "unknown error"}`);
  }
}

/**
 * Restore persisted context tokens for an account into the in-memory map.
 * Called once during gateway startAccount to survive restarts.
 */
export function restoreContextTokens(accountId: string): void {
  const filePath = resolveContextTokenFilePath(accountId);
  try {
    if (!fs.existsSync(filePath)) return;
    if (fs.statSync(filePath).size > MAX_CONTEXT_TOKEN_FILE_BYTES) {
      throw new Error("context token file exceeds safe size limit");
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("context token file must contain an object");
    }
    const tokens = parsed as Record<string, unknown>;
    let count = 0;
    for (const [userId, token] of Object.entries(tokens)) {
      if (count >= MAX_CONTEXT_TOKENS_PER_ACCOUNT) break;
      if (
        userId.length > 0 &&
        userId.length <= MAX_CONTEXT_USER_ID_LENGTH &&
        typeof token === "string" &&
        token.length > 0 &&
        token.length <= MAX_CONTEXT_TOKEN_LENGTH
      ) {
        contextTokenStore.set(contextTokenKey(accountId, userId), token);
        count++;
      }
    }
    logger.info(`restoreContextTokens: restored ${count} tokens`);
  } catch (err) {
    logger.warn(`restoreContextTokens: private state read failed: ${err instanceof Error ? err.name : "unknown error"}`);
  }
}

/** Remove all context tokens for a given account (memory + disk). */
export function clearContextTokensForAccount(accountId: string): void {
  const prefix = `${accountId}:`;
  for (const k of [...contextTokenStore.keys()]) {
    if (k.startsWith(prefix)) {
      contextTokenStore.delete(k);
    }
  }
  const filePath = resolveContextTokenFilePath(accountId);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    logger.warn(`clearContextTokensForAccount: private state removal failed: ${err instanceof Error ? err.name : "unknown error"}`);
  }
  logger.info("clearContextTokensForAccount: tokens cleared");
}

/** Store a context token for a given account+user pair (memory + disk). */
export function setContextToken(accountId: string, userId: string, token: string): void {
  const normalizedAccountId = accountId.trim();
  const normalizedUserId = userId.trim();
  if (!normalizedAccountId || !normalizedUserId || normalizedUserId.length > MAX_CONTEXT_USER_ID_LENGTH) {
    throw new Error("weixin context token requires a valid accountId and userId");
  }
  if (!token || token.length > MAX_CONTEXT_TOKEN_LENGTH) {
    throw new Error("weixin context token is empty or exceeds the safe size limit");
  }
  const k = contextTokenKey(normalizedAccountId, normalizedUserId);
  // 重新插入用于维持每账号的 LRU 顺序。
  contextTokenStore.delete(k);
  let accountEntryCount = 0;
  let oldestAccountKey: string | undefined;
  const prefix = `${normalizedAccountId}:`;
  for (const existingKey of contextTokenStore.keys()) {
    if (!existingKey.startsWith(prefix)) continue;
    oldestAccountKey ??= existingKey;
    accountEntryCount++;
  }
  if (accountEntryCount >= MAX_CONTEXT_TOKENS_PER_ACCOUNT && oldestAccountKey) {
    contextTokenStore.delete(oldestAccountKey);
  }
  contextTokenStore.set(k, token);
  logger.debug("setContextToken: token stored");
  persistContextTokens(normalizedAccountId);
}

/** Retrieve the cached context token for a given account+user pair. */
export function getContextToken(accountId: string, userId: string): string | undefined {
  const k = contextTokenKey(accountId, userId);
  const val = contextTokenStore.get(k);
  logger.debug(`getContextToken: found=${val !== undefined} storeSize=${contextTokenStore.size}`);
  return val;
}

/**
 * Find all accountIds that have an active contextToken for the given userId.
 * Used to infer the sending bot account from the recipient address when
 * accountId is not explicitly provided (e.g. cron delivery).
 *
 * Returns all matching accountIds (not just the first) so the caller can
 * detect ambiguity when multiple accounts have sessions with the same user.
 */
export function findAccountIdsByContextToken(
  accountIds: string[],
  userId: string,
): string[] {
  return accountIds.filter((id) => contextTokenStore.has(contextTokenKey(id, userId)));
}

// ---------------------------------------------------------------------------
// Message ID generation
// ---------------------------------------------------------------------------

function generateMessageSid(): string {
  return generateId("openclaw-weixin");
}

/** Inbound context passed to the OpenClaw core pipeline (matches MsgContext shape). */
export type WeixinMsgContext = {
  Body: string;
  From: string;
  To: string;
  AccountId: string;
  OriginatingChannel: "openclaw-weixin";
  OriginatingTo: string;
  MessageSid: string;
  Timestamp?: number;
  Provider: "openclaw-weixin";
  ChatType: "direct";
  /** Set by monitor after resolveAgentRoute so dispatchReplyFromConfig uses the correct session. */
  SessionKey?: string;
  context_token?: string;
  MediaUrl?: string;
  MediaPath?: string;
  MediaType?: string;
  /** Raw message body for framework command authorization. */
  CommandBody?: string;
  /** Whether the sender is authorized to execute slash commands. */
  CommandAuthorized?: boolean;
};

/** Returns true if the message item is a media type (image, video, file, or voice). */
export function isMediaItem(item: MessageItem): boolean {
  return (
    item.type === MessageItemType.IMAGE ||
    item.type === MessageItemType.VIDEO ||
    item.type === MessageItemType.FILE ||
    item.type === MessageItemType.VOICE
  );
}

function bodyFromItemList(itemList?: MessageItem[]): string {
  if (!itemList?.length) return "";
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      const text = String(item.text_item.text);
      const ref = item.ref_msg;
      if (!ref) return text;
      // Quoted media is passed as MediaPath; only include the current text as body.
      if (ref.message_item && isMediaItem(ref.message_item)) return text;
      // Build quoted context from both title and message_item content.
      const parts: string[] = [];
      if (ref.title) parts.push(ref.title);
      if (ref.message_item) {
        const refBody = bodyFromItemList([ref.message_item]);
        if (refBody) parts.push(refBody);
      }
      if (!parts.length) return text;
      return `[引用: ${parts.join(" | ")}]\n${text}`;
    }
    // 语音转文字：如果语音消息有 text 字段，直接使用文字内容
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

export type WeixinInboundMediaOpts = {
  /** Local path to decrypted image file. */
  decryptedPicPath?: string;
  /** Local path to transcoded/raw voice file (.wav or .silk). */
  decryptedVoicePath?: string;
  /** MIME type for the voice file (e.g. "audio/wav" or "audio/silk"). */
  voiceMediaType?: string;
  /** Local path to decrypted file attachment. */
  decryptedFilePath?: string;
  /** MIME type for the file attachment (guessed from file_name). */
  fileMediaType?: string;
  /** Local path to decrypted video file. */
  decryptedVideoPath?: string;
};

/**
 * Convert a WeixinMessage from getUpdates to the inbound MsgContext for the core pipeline.
 * Media: only pass MediaPath (local file, after CDN download + decrypt).
 * We never pass MediaUrl — the upstream CDN URL is encrypted/auth-only.
 * Priority when multiple media types present: image > video > file > voice.
 */
export function weixinMessageToMsgContext(
  msg: WeixinMessage,
  accountId: string,
  opts?: WeixinInboundMediaOpts,
): WeixinMsgContext {
  const from_user_id = msg.from_user_id ?? "";
  const ctx: WeixinMsgContext = {
    Body: bodyFromItemList(msg.item_list),
    From: from_user_id,
    To: from_user_id,
    AccountId: accountId,
    OriginatingChannel: "openclaw-weixin",
    OriginatingTo: from_user_id,
    MessageSid: generateMessageSid(),
    Timestamp: msg.create_time_ms,
    Provider: "openclaw-weixin",
    ChatType: "direct",
  };
  if (msg.context_token) {
    ctx.context_token = msg.context_token;
  }

  if (opts?.decryptedPicPath) {
    ctx.MediaPath = opts.decryptedPicPath;
    ctx.MediaType = "image/*";
  } else if (opts?.decryptedVideoPath) {
    ctx.MediaPath = opts.decryptedVideoPath;
    ctx.MediaType = "video/mp4";
  } else if (opts?.decryptedFilePath) {
    ctx.MediaPath = opts.decryptedFilePath;
    ctx.MediaType = opts.fileMediaType ?? "application/octet-stream";
  } else if (opts?.decryptedVoicePath) {
    ctx.MediaPath = opts.decryptedVoicePath;
    ctx.MediaType = opts.voiceMediaType ?? "audio/wav";
  }

  return ctx;
}

/** Extract the context_token from an inbound WeixinMsgContext. */
export function getContextTokenFromMsgContext(ctx: WeixinMsgContext): string | undefined {
  return ctx.context_token;
}
