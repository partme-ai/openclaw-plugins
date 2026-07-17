/**
 * @fileoverview 抖音 Webhook 入站消息的可认领持久化去重器。
 *
 * 每个账号拥有独立命名空间，消息先 `claim`，处理成功后 `commit`，失败则 `release` 以允许
 * 安全重试。内存索引用于快速判断，JSON 持久层用于 Gateway 重启后的 24 小时防重放；磁盘
 * 异常只降级并告警，不应让整个消息入口崩溃。
 */
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  createClaimableDedupe,
  createPersistentDedupe,
  resolveOpenClawStateDir,
  type ClaimableDedupe,
  type ClaimableDedupeClaim,
  type PersistentDedupe,
} from "@partme.ai/openclaw-message-sdk";

const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const MEMORY_MAX_SIZE = 1_000;
const FILE_MAX_ENTRIES = 10_000;
const DEDUPE_PREFIX = "douyin-webhook";

let persistentDedupe: PersistentDedupe | null = null;
let persistentDedupePromise: Promise<PersistentDedupe> | null = null;
let claimableDedupe: ClaimableDedupe | null = null;

function resolveNamespace(accountId: string): string {
  return `${DEDUPE_PREFIX}:${accountId.trim() || "default"}`;
}

function resolveFilePath(namespace: string): string {
  const readablePrefix = namespace.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const suffix = createHash("sha256").update(namespace).digest("hex").slice(0, 12);
  return path.join(resolveOpenClawStateDir(), "douyin", "dedup", `${readablePrefix}-${suffix}.json`);
}

async function getPersistentDedupe(): Promise<PersistentDedupe> {
  if (persistentDedupe) return persistentDedupe;
  if (!persistentDedupePromise) {
    persistentDedupePromise = createPersistentDedupe({
      ttlMs: DEDUPE_TTL_MS,
      memoryMaxSize: MEMORY_MAX_SIZE,
      fileMaxEntries: FILE_MAX_ENTRIES,
      resolveFilePath,
      onDiskError: (error) => {
        if (process.env.VITEST || process.env.NODE_ENV === "test") return;
        console.warn(`[douyin-dedupe] disk error: ${String(error)}`);
      },
    }).then((dedupe) => {
      persistentDedupe = dedupe;
      return dedupe;
    });
  }
  return persistentDedupePromise;
}

async function getClaimableDedupe(): Promise<ClaimableDedupe> {
  if (claimableDedupe) return claimableDedupe;
  claimableDedupe = createClaimableDedupe({
    ttlMs: DEDUPE_TTL_MS,
    memoryMaxSize: MEMORY_MAX_SIZE,
    persistent: await getPersistentDedupe(),
    onPersistentError: (error) => {
      if (process.env.VITEST || process.env.NODE_ENV === "test") return;
      console.warn(`[douyin-dedupe] persistent error: ${String(error)}`);
    },
  });
  return claimableDedupe;
}

/**
 * 原子认领账号范围内的平台消息号。
 * `claimed` 才能继续进入 Agent；已提交或处理中消息会被视为重复，避免平台重放并发执行。
 */
export async function claimDouyinWebhookMessage(
  accountId: string,
  messageId: string,
): Promise<ClaimableDedupeClaim> {
  const key = messageId.trim();
  if (!key) return { kind: "invalid", key: "" };
  return (await getClaimableDedupe()).claim(key, { namespace: resolveNamespace(accountId) });
}

/** Agent 流程成功完成后提交认领，使该消息在 24 小时窗口内持续防重放。 */
export async function commitDouyinWebhookMessage(
  accountId: string,
  messageId: string,
): Promise<void> {
  await (await getClaimableDedupe()).commit(messageId, { namespace: resolveNamespace(accountId) });
}

/**
 * Agent 失败或超时时释放认领，允许平台或运维重试同一消息。
 * 释放不会把失败消息写成“已成功”，从而避免瞬时故障造成永久丢信。
 */
export async function releaseDouyinWebhookMessage(
  accountId: string,
  messageId: string,
  error?: unknown,
): Promise<void> {
  (await getClaimableDedupe()).release(messageId, {
    namespace: resolveNamespace(accountId),
    error,
  });
}

/** 清空模块级去重实例，仅供隔离单元测试和热重载测试使用。 */
export function resetDouyinWebhookDedupeForTests(): void {
  persistentDedupe = null;
  persistentDedupePromise = null;
  claimableDedupe = null;
}
