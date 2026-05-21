/**
 * next_cursor 持久化存储
 * 企微文档明确要求「强烈建议对 next_cursor 字段入库保存」
 *
 * V1 实现：文件系统存储（与 OpenClaw 会话数据同级）
 * V2 可切换为 Redis/数据库
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

/** 游标存储目录（默认在 OpenClaw 数据目录下） */
const DEFAULT_CURSOR_DIR = join(
  process.env.HOME ?? "~",
  ".openclaw",
  "wecom-kf-cursors"
);

/**
 * 游标存储管理器
 * 每个客服账号一个独立的游标文件
 */
class CursorStore {
  /** 存储目录 */
  private readonly storeDir: string;
  /** 内存缓存（避免频繁磁盘读取） */
  private readonly cache = new Map<string, string>();

  constructor(storeDir?: string) {
    this.storeDir = storeDir ?? DEFAULT_CURSOR_DIR;
  }

  /**
   * 获取指定客服账号的游标
   *
   * @param openKfId - 客服账号 ID
   * @returns 游标字符串，无记录时返回空字符串
   */
  async getCursor(openKfId: string): Promise<string> {
    // 优先从缓存读取
    const cached = this.cache.get(openKfId);
    if (cached !== undefined) {
      return cached;
    }

    // 从文件读取
    try {
      const filePath = this.getCursorFilePath(openKfId);
      const content = await readFile(filePath, "utf-8");
      const cursor = content.trim();
      this.cache.set(openKfId, cursor);
      return cursor;
    } catch {
      // 文件不存在，返回空字符串（首次拉取）
      return "";
    }
  }

  /**
   * 保存游标
   * 同时更新内存缓存和磁盘文件
   *
   * @param openKfId - 客服账号 ID
   * @param cursor - 新的游标值
   */
  async saveCursor(openKfId: string, cursor: string): Promise<void> {
    this.cache.set(openKfId, cursor);

    const filePath = this.getCursorFilePath(openKfId);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, cursor, "utf-8");
  }

  /**
   * 获取游标文件路径
   * openKfId 中非法文件名字符替换为下划线
   *
   * @param openKfId - 客服账号 ID
   * @returns 游标文件绝对路径
   */
  private getCursorFilePath(openKfId: string): string {
    // 用 openKfId 作为文件名（替换特殊字符）
    const safeId = openKfId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.storeDir, `${safeId}.cursor`);
  }
}

/** 全局单例 */
let _store: CursorStore | null = null;

/**
 * 获取游标存储单例
 * 未初始化时使用默认目录创建实例
 *
 * @returns CursorStore 单例
 */
export function getCursorStore(): CursorStore {
  if (!_store) {
    _store = new CursorStore();
  }
  return _store;
}

/**
 * 初始化游标存储（可指定目录，用于测试或自定义数据目录）
 *
 * @param storeDir - 自定义存储目录，不传则后续 getCursorStore 使用默认目录
 */
export function initCursorStore(storeDir?: string): void {
  _store = new CursorStore(storeDir);
}
