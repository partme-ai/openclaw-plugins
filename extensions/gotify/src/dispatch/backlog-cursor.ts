/**
 * @file Gotify backlog cursor — REST 回补游标本地持久化模块。
 *
 * @description 每个 OpenClaw `accountId` 维护独立 JSON 文件，
 * 记录最近一次 **成功 replay / dispatch** 的 Gotify message ID（按 Application 隔离）。
 * **模块角色**：Channel Plugin · Inbound backlog continuity（避免跨进程 / 重启丢消息）。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveStateDir } from "../state/state-dir.js";

type BacklogCursorFile = {
  allowedAppId: number;
  lastSeenMessageId: number;
  updatedAt: string;
};

/**
 * 将账号 ID 中的危险文件系统字符替换为 `_`，避免路径穿越或非法文件名。
 *
 * @description FS 路径安全归一；**非加密**编码，仅为稳定可写目录名。
 * @param accountId - OpenClaw 侧 Gotify 账号键。
 * @returns 可作为单文件片段使用的安全目录/文件名片段。
 */
function normalizeAccountId(accountId: string): string {
  return accountId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * 计算当前账号 backlog cursor JSON 文件的绝对路径。
 *
 * @description 路径结构 `<state>/gotify/backlog-cursors/<account>.json`，
 * 与其他 OpenClaw 插件 sidecar 隔离。
 * @param accountId - OpenClaw 账号 ID。
 * @returns 绝对 FS 路径。
 */
function resolveCursorPath(accountId: string): string {
  return path.join(
    resolveStateDir(),
    "gotify",
    "backlog-cursors",
    `${normalizeAccountId(accountId)}.json`,
  );
}

/**
 * 读取账号 backlog cursor。
 *
 * @description 文件不存在或 JSON 解析失败时返回 0（表示从头回放）。
 * 若磁盘记录的 `allowedAppId` 与当前配置不一致则返回 0，避免跨 Application 错误续跑。
 *
 * @param accountId - OpenClaw Gotify 账号 ID。
 * @param allowedAppId - 当前入站配置的允许 Application ID。
 * @returns 上次成功处理的 Gotify message id；无记录或语义不兼容时为 0。
 */
export async function readBacklogCursor(
  accountId: string,
  allowedAppId: number,
): Promise<number> {
  try {
    const raw = await readFile(resolveCursorPath(accountId), "utf8");
    const parsed = JSON.parse(raw) as Partial<BacklogCursorFile>;
    const messageId = Math.trunc(Number(parsed.lastSeenMessageId ?? 0));
    const storedAllowedAppId = Math.trunc(Number(parsed.allowedAppId ?? 0));
    if (storedAllowedAppId !== allowedAppId) {
      return 0;
    }
    return Number.isFinite(messageId) && messageId > 0 ? messageId : 0;
  } catch {
    return 0;
  }
}

/**
 * 持久化账号 backlog cursor。
 *
 * @description 写入 JSON 包含 `allowedAppId` 与 UTC `updatedAt` 审计字段，
 * 目录递归创建，`fsync` 由 Node 默认行为处理（非强一致双写）。
 *
 * @param accountId - OpenClaw Gotify 账号 ID。
 * @param allowedAppId - 关联 Application。
 * @param lastSeenMessageId - 已成功派发并确认的最新 message id。
 * @returns `Promise<void>` —— IO 异常向上抛出。
 */
export async function writeBacklogCursor(
  accountId: string,
  allowedAppId: number,
  lastSeenMessageId: number,
): Promise<void> {
  const filePath = resolveCursorPath(accountId);
  await mkdir(path.dirname(filePath), { recursive: true });
  const next: BacklogCursorFile = {
    allowedAppId,
    lastSeenMessageId,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
}
