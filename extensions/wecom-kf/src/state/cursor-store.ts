/**
 * next_cursor 持久化存储（委托 message-sdk state 目录）
 * 企微文档明确要求「强烈建议对 next_cursor 字段入库保存」
 */

import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rename, rm, chmod } from "node:fs/promises";
import { join, dirname } from "node:path";
import { resolveOpenClawStateDir } from "@partme.ai/openclaw-message-sdk/openclaw";

function resolveCursorStoreDir(): string {
  return join(resolveOpenClawStateDir(), "wecom-kf", "cursors");
}

class CursorStore {
  private readonly storeDir: string;
  private readonly cache = new Map<string, string>();
  private operation: Promise<void> = Promise.resolve();

  constructor(storeDir?: string) {
    this.storeDir = storeDir ?? resolveCursorStoreDir();
  }

  async getCursor(key: string): Promise<string> {
    const normalizedKey = this.normalizeKey(key);
    const cached = this.cache.get(normalizedKey);
    if (cached !== undefined) return cached;

    try {
      const filePath = this.getCursorFilePath(normalizedKey);
      const content = await readFile(filePath, "utf-8");
      const cursor = content.trim();
      if (!cursor) throw new Error(`wecom-kf cursor file is empty: ${filePath}`);
      this.cache.set(normalizedKey, cursor);
      return cursor;
    } catch (error) {
      if (!this.isNotFound(error)) throw error;
    }

    // 2026.7.1 之前使用纯字符替换文件名，保留一次只读兼容以便平滑升级。
    try {
      const legacyPath = this.getLegacyCursorFilePath(normalizedKey);
      const content = await readFile(legacyPath, "utf-8");
      const cursor = content.trim();
      if (!cursor) throw new Error(`wecom-kf legacy cursor file is empty: ${legacyPath}`);
      this.cache.set(normalizedKey, cursor);
      return cursor;
    } catch (error) {
      if (this.isNotFound(error)) return "";
      throw error;
    }
  }

  async saveCursor(key: string, cursor: string): Promise<void> {
    const normalizedKey = this.normalizeKey(key);
    const normalized = cursor.trim();
    if (!normalized) throw new Error("wecom-kf cursor must not be empty");
    const save = async (): Promise<void> => {
      const filePath = this.getCursorFilePath(normalizedKey);
      const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      try {
        await writeFile(temporaryPath, `${normalized}\n`, { encoding: "utf-8", mode: 0o600 });
        await rename(temporaryPath, filePath);
        await chmod(filePath, 0o600);
        this.cache.set(normalizedKey, normalized);
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }
    };
    const next = this.operation.then(save, save);
    this.operation = next.then(() => undefined, () => undefined);
    await next;
  }

  private getCursorFilePath(key: string): string {
    const safeId = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    const digest = createHash("sha256").update(key).digest("hex").slice(0, 16);
    return join(this.storeDir, `${safeId.slice(0, 96)}-${digest}.cursor`);
  }

  private getLegacyCursorFilePath(key: string): string {
    const safeId = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.storeDir, `${safeId}.cursor`);
  }

  private normalizeKey(key: string): string {
    const normalized = key.trim();
    if (!normalized) throw new Error("wecom-kf cursor key must not be empty");
    if (Buffer.byteLength(normalized, "utf8") > 512) {
      throw new Error("wecom-kf cursor key exceeds 512 bytes");
    }
    return normalized;
  }

  private isNotFound(error: unknown): boolean {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT";
  }
}

let _store: CursorStore | null = null;

export function getCursorStore(): CursorStore {
  if (!_store) {
    _store = new CursorStore();
  }
  return _store;
}

/** 测试或自定义数据目录时初始化游标存储 */
export function initCursorStore(storeDir?: string): void {
  _store = new CursorStore(storeDir);
}

/** 测试专用：重置游标存储单例 */
export function resetCursorStoreForTests(): void {
  _store = null;
}
