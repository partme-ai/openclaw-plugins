/**
 * @module webhook/dedup
 *
 * Webhook 入站消息**持久化去重**（跨进程/重启）。
 *
 * **职责**：基于 msgid 的 claim 语义，防止企微重试导致重复 dispatch。
 *
 * **与 message-sdk 关系**：
 * - 封装 `createPersistentDedupe`（内存 LRU + 磁盘 JSON，TTL 24h）
 * - Bot 入站与 Agent 回调使用不同 namespace 隔离
 *
 * **关键流程**：`claimWecomInboundMsgid` → checkAndRecord → 重复则短路
 *
 * **关键导出**：`claimWecomInboundMsgid`、`claimWecomAgentInboundMsgid`、
 * `warmupWecomWebhookDedupe`
 */

import * as path from "node:path";
import { createPersistentDedupe, type PersistentDedupe } from "../runtime/runtime-api.js";
import { resolveStateDir } from "../shared/openclaw-compat.js";

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

const AGENT_INBOUND_DEDUP_PREFIX = "wecom-agent-inbound";

function resolveAgentInboundDedupeNamespace(accountId: string): string {
  return `${AGENT_INBOUND_DEDUP_PREFIX}:${accountId || "default"}`;
}

/** Webhook Bot 入站 msgid 去重；`true` 表示首次 claim 成功（应继续处理）。 */
export async function claimWecomInboundMsgid(
  accountId: string,
  msgid: string,
): Promise<boolean> {
  const trimmed = msgid?.trim();
  if (!trimmed) return true;
  const dedupe = await getWecomWebhookDedupe();
  return dedupe.checkAndRecord(trimmed, { namespace: accountId || "default" });
}

/** Agent 回调入站 msgid 去重；`true` 表示首次 claim 成功。 */
export async function claimWecomAgentInboundMsgid(
  accountId: string,
  msgid: string,
): Promise<boolean> {
  const trimmed = msgid?.trim();
  if (!trimmed) return true;
  const dedupe = await getWecomWebhookDedupe();
  return dedupe.checkAndRecord(trimmed, {
    namespace: resolveAgentInboundDedupeNamespace(accountId),
  });
}

/**
 * Gateway 启动时预热去重缓存（从磁盘加载 namespace 条目）。
 *
 * @param accountId - 账号 ID（namespace）
 * @param log - 可选日志回调
 * @returns 预热加载的条目数
 */
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

/** 测试专用：重置单例 dedupe 实例。 */
export function resetWecomWebhookDedupeForTests(): void {
  sharedDedupe = null;
  sharedDedupePromise = null;
}
