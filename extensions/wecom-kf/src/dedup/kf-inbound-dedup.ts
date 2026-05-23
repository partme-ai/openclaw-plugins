/**
 * 企微客服入站 msgid 持久化去重（跨进程/重启）。
 *
 * namespace: wecom-kf-inbound:{openKfId}
 */

import * as path from "node:path";
import {
  createPersistentDedupe,
  resolveOpenClawStateDir,
  type PersistentDedupe,
} from "@partme.ai/openclaw-message-sdk";

const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;
const MEMORY_MAX_SIZE = 1_000;
const FILE_MAX_ENTRIES = 10_000;
const DEDUP_PREFIX = "wecom-kf-inbound";

let sharedDedupe: PersistentDedupe | null = null;
let sharedDedupePromise: Promise<PersistentDedupe> | null = null;

/**
 * 按 openKfId 生成去重 namespace。
 */
export function resolveKfInboundDedupeNamespace(openKfId: string): string {
  const normalized = openKfId?.trim() || "default";
  return `${DEDUP_PREFIX}:${normalized}`;
}

function resolveNamespaceFilePath(namespace: string): string {
  const safe = namespace.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(resolveOpenClawStateDir(), "wecom-kf", "dedup", `${safe}.json`);
}

async function getKfInboundDedupe(): Promise<PersistentDedupe> {
  if (sharedDedupe) return sharedDedupe;
  if (!sharedDedupePromise) {
    sharedDedupePromise = createPersistentDedupe({
      ttlMs: DEDUP_TTL_MS,
      memoryMaxSize: MEMORY_MAX_SIZE,
      fileMaxEntries: FILE_MAX_ENTRIES,
      resolveFilePath: resolveNamespaceFilePath,
      onDiskError: (err) => {
        if (process.env.VITEST || process.env.NODE_ENV === "test") return;
        console.warn(`[wecom-kf-dedup] disk error: ${String(err)}`);
      },
    }).then((dedupe) => {
      sharedDedupe = dedupe;
      return dedupe;
    });
  }
  return sharedDedupePromise;
}

/**
 * 客户消息 msgid 去重；`true` 表示首次 claim 成功（应继续处理）。
 */
export async function claimWecomKfInboundMsgid(
  openKfId: string,
  msgid: string,
): Promise<boolean> {
  const trimmed = msgid?.trim();
  if (!trimmed) return true;
  const dedupe = await getKfInboundDedupe();
  return dedupe.checkAndRecord(trimmed, {
    namespace: resolveKfInboundDedupeNamespace(openKfId),
  });
}

/** 测试专用：重置单例 dedupe 实例。 */
export function resetWecomKfInboundDedupeForTests(): void {
  sharedDedupe = null;
  sharedDedupePromise = null;
}
