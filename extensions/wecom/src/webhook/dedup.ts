/**
 * Webhook 入站消息持久化去重（OpenClaw persistent-dedupe）。
 */

import * as os from "node:os";
import * as path from "node:path";
import {
  createLocalPersistentDedupeSync,
  type PersistentDedupe,
} from "@partme.ai/openclaw-message-sdk";
import { resolveStateDir } from "../openclaw-compat.js";

const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;
const MEMORY_MAX_SIZE = 1_000;
const FILE_MAX_ENTRIES = 10_000;

let sharedDedupe: PersistentDedupe | null = null;

function resolveNamespaceFilePath(namespace: string): string {
  const safe = namespace.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(resolveStateDir(), "wecom", "dedup", `${safe}.json`);
}

function getWecomWebhookDedupe(): PersistentDedupe {
  if (!sharedDedupe) {
    sharedDedupe = createLocalPersistentDedupeSync({
      ttlMs: DEDUP_TTL_MS,
      memoryMaxSize: MEMORY_MAX_SIZE,
      fileMaxEntries: FILE_MAX_ENTRIES,
      resolveFilePath: resolveNamespaceFilePath,
      onDiskError: (err) => {
        if (process.env.VITEST || process.env.NODE_ENV === "test") return;
        console.warn(`[wecom-dedup] disk error: ${String(err)}`);
      },
    });
  }
  return sharedDedupe;
}

/** 尝试登记入站 msgid；true 表示首次处理 */
export async function claimWecomInboundMsgid(
  accountId: string,
  msgid: string,
): Promise<boolean> {
  const trimmed = msgid?.trim();
  if (!trimmed) return true;
  return getWecomWebhookDedupe().checkAndRecord(trimmed, { namespace: accountId || "default" });
}

export async function warmupWecomWebhookDedupe(
  accountId: string,
  log?: (...args: unknown[]) => void,
): Promise<number> {
  const count = await getWecomWebhookDedupe().warmup(accountId || "default", (err) => {
    log?.(`[wecom-dedup] warmup error: ${String(err)}`);
  });
  log?.(`[wecom-dedup] warmup account=${accountId} entries=${count}`);
  return count;
}

export function resetWecomWebhookDedupeForTests(): void {
  sharedDedupe = null;
}
