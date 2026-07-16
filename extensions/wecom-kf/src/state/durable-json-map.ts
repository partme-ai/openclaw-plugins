/**
 * @module state/durable-json-map
 *
 * 进程内 Map + state 目录 JSON 持久化，重启后恢复键值状态。
 * 用于 send-guard、session service_state、side-effect 等 KF 运行时状态。
 */

export { resolveOpenClawStateDir as resolveStateDir } from "@partme.ai/openclaw-message-sdk/openclaw";

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveOpenClawStateDir } from "@partme.ai/openclaw-message-sdk/openclaw";

/**
 * 带 JSON 文件落盘的键值存储。
 */
export class DurableJsonMapStore<T> {
  private readonly memory = new Map<string, T>();
  private loaded = false;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly relativePath: string,
    private readonly storeDir?: string,
  ) {}

  private resolveFilePath(): string {
    const base = this.storeDir ?? join(resolveOpenClawStateDir(), "wecom-kf");
    return join(base, this.relativePath);
  }

  /**
   * 从磁盘加载 JSON 对象到内存（幂等）。
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    const filePath = this.resolveFilePath();
    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, T>;
      if (parsed && typeof parsed === "object") {
        for (const [key, value] of Object.entries(parsed)) {
          this.memory.set(key, value);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.loaded = true;
  }

  /**
   * 读取键值；需先 {@link load}。
   */
  get(key: string): T | undefined {
    return this.memory.get(key);
  }

  /**
   * 写入并异步持久化。
   */
  async set(key: string, value: T): Promise<void> {
    await this.load();
    this.memory.set(key, value);
    await this.schedulePersist();
  }

  /**
   * 删除键并持久化。
   */
  async delete(key: string): Promise<void> {
    await this.load();
    this.memory.delete(key);
    await this.schedulePersist();
  }

  /**
   * 清空全部条目（测试用）。
   */
  async clear(): Promise<void> {
    this.memory.clear();
    this.loaded = true;
    await this.schedulePersist();
  }

  /**
   * 返回当前内存条目快照。
   */
  entries(): Array<[string, T]> {
    return [...this.memory.entries()];
  }

  private async schedulePersist(): Promise<void> {
    const persist = async (): Promise<void> => {
      const filePath = this.resolveFilePath();
      const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
      const payload = Object.fromEntries(this.memory.entries());
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      try {
        await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
          encoding: "utf-8",
          mode: 0o600,
        });
        await rename(temporaryPath, filePath);
        await chmod(filePath, 0o600);
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }
    };
    const next = this.persistChain.then(persist, persist);
    this.persistChain = next.catch(() => undefined);
    await next;
  }
}
