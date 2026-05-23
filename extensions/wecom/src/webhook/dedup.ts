/**
 * Webhook 入站消息持久化去重（message-sdk createPersistentDedupe）。
 */

import * as path from "node:path";
import { createPersistentDedupe, type PersistentDedupe } from "../runtime-api.js";
import { resolveStateDir } from "../openclaw-compat.js";

const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;
const MEMORY_MAX_SIZE = 1_000;
const FILE_MAX_ENTRIES = 10_000;

let sharedDedupe: PersistentDedupe | null = null;
let sharedDedupePromise: Promise<PersistentDedupe> | null = null;

function resolveNamespaceFilePath(namespace: string): string {
  const safe = namespace.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(resolveStateDir(), "wecom", "dedup", `${safe}.json`);
}

async function getWecomWebhookDedupe(): Promise<PersistentDedupe> {
  if (sharedDedupe) return sharedDedupe;
  if (!sharedDedupePromise) {
    sharedDedupePromise = createPersistentDedupe({
      ttlMs: DEDUP_TTL_MS,
      memoryMaxSize: MEMORY_MAX_SIZE,
      fileMaxEntries: FILE_MAX_ENTRIES,
      resolveFilePath: resolveNamespaceFilePath,
      onDiskError: (err) => {
        if (process.env.VITEST || process.env.NODE_ENV === "test") return;
        console.warn(`[wecom-dedup] disk error: ${String(err)}`);
      },
    }).then((dedupe) => {
      sharedDedupe = dedupe;
      return dedupe;
    });
  }
  return sharedDedupePromise;
}

/** 尝试登记入站 msgid；true 表示首次处理 */
export async function claimWecomInboundMsgid(
  accountId: string,
  msgid: string,
): Promise<boolean> {
  const trimmed = msgid?.trim();
  if (!trimmed) return true;
  const dedupe = await getWecomWebhookDedupe();
  return dedupe.checkAndRecord(trimmed, { namespace: accountId || "default" });
}

export async function warmupWecomWebhookDedupe(
  accountId: string,
  log?: (...args: unknown[]) => void,
): Promise<number> {
  const dedupe = await getWecomWebhookDedupe();
  const count = await dedupe.warmup(accountId || "default", (err) => {
    log?.(`[wecom-dedup] warmup error: ${String(err)}`);
  });
  log?.(`[wecom-dedup] warmup account=${accountId} entries=${count}`);
  return count;
}

export function resetWecomWebhookDedupeForTests(): void {
  sharedDedupe = null;
  sharedDedupePromise = null;
}
