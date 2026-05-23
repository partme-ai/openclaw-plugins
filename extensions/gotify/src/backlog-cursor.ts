import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveStateDir } from "./state-dir.js";

type BacklogCursorFile = {
  allowedAppId: number;
  lastSeenMessageId: number;
  updatedAt: string;
};

function normalizeAccountId(accountId: string): string {
  return accountId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

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
 * 如果账号当前绑定的 allowedAppId 与磁盘记录不一致，则返回 0，避免跨应用复用旧游标。
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
