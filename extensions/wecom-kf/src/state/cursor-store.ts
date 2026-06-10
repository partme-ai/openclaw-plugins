/**
 * next_cursor 持久化存储（委托 message-sdk state 目录）
 * 企微文档明确要求「强烈建议对 next_cursor 字段入库保存」
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { resolveOpenClawStateDir } from "@partme.ai/openclaw-message-sdk/openclaw";

function resolveCursorStoreDir(): string {
  return join(resolveOpenClawStateDir(), "wecom-kf", "cursors");
}

class CursorStore {
  private readonly storeDir: string;
  private readonly cache = new Map<string, string>();

  constructor(storeDir?: string) {
    this.storeDir = storeDir ?? resolveCursorStoreDir();
  }

  async getCursor(key: string): Promise<string> {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    try {
      const filePath = this.getCursorFilePath(key);
      const content = await readFile(filePath, "utf-8");
      const cursor = content.trim();
      this.cache.set(key, cursor);
      return cursor;
    } catch {
      return "";
    }
  }

  async saveCursor(key: string, cursor: string): Promise<void> {
    this.cache.set(key, cursor);
    const filePath = this.getCursorFilePath(key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, cursor, "utf-8");
  }

  private getCursorFilePath(key: string): string {
    const safeId = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.storeDir, `${safeId}.cursor`);
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
