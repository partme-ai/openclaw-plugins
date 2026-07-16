/**
 * 企微客服入站 msgid 持久化去重（跨进程/重启）。
 *
 * namespace: wecom-kf-inbound:{openKfId}
 */

import * as path from "node:path";
import {
  createClaimableDedupe,
  createPersistentDedupe,
  resolveOpenClawStateDir,
  type ClaimableDedupe,
  type ClaimableDedupeClaim,
  type PersistentDedupe,
} from "@partme.ai/openclaw-message-sdk";

const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;
const MEMORY_MAX_SIZE = 1_000;
const FILE_MAX_ENTRIES = 10_000;
const DEDUP_PREFIX = "wecom-kf-inbound";

let sharedDedupe: PersistentDedupe | null = null;
let sharedDedupePromise: Promise<PersistentDedupe> | null = null;
let sharedClaimableDedupe: ClaimableDedupe | null = null;

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

async function getKfInboundClaimableDedupe(): Promise<ClaimableDedupe> {
  if (sharedClaimableDedupe) return sharedClaimableDedupe;
  const persistent = await getKfInboundDedupe();
  sharedClaimableDedupe = createClaimableDedupe({
    ttlMs: DEDUP_TTL_MS,
    memoryMaxSize: MEMORY_MAX_SIZE,
    persistent,
    onPersistentError: (err) => {
      if (process.env.VITEST || process.env.NODE_ENV === "test") return;
      console.warn(`[wecom-kf-dedup] persistent error: ${String(err)}`);
    },
  });
  return sharedClaimableDedupe;
}

/**
 * 客户消息 msgid 去重；`true` 表示首次 claim 成功（应继续处理）。
 */
export async function claimWecomKfInboundMsgid(
  openKfId: string,
  msgid: string,
): Promise<ClaimableDedupeClaim> {
  const trimmed = msgid?.trim();
  if (!trimmed) return { kind: "invalid", key: "" };
  const dedupe = await getKfInboundClaimableDedupe();
  return dedupe.claim(trimmed, {
    namespace: resolveKfInboundDedupeNamespace(openKfId),
  });
}

/** 处理成功后提交 msgid，只有此时才写入持久化去重层。 */
export async function commitWecomKfInboundMsgid(openKfId: string, msgid: string): Promise<void> {
  const dedupe = await getKfInboundClaimableDedupe();
  await dedupe.commit(msgid, { namespace: resolveKfInboundDedupeNamespace(openKfId) });
}

/** 处理失败时释放占用，使同一 msgid 可由后续 sync_msg 重试。 */
export async function releaseWecomKfInboundMsgid(
  openKfId: string,
  msgid: string,
  error?: unknown,
): Promise<void> {
  const dedupe = await getKfInboundClaimableDedupe();
  dedupe.release(msgid, { namespace: resolveKfInboundDedupeNamespace(openKfId), error });
}

/** 测试专用：重置单例 dedupe 实例。 */
export function resetWecomKfInboundDedupeForTests(): void {
  sharedDedupe = null;
  sharedDedupePromise = null;
  sharedClaimableDedupe = null;
}
