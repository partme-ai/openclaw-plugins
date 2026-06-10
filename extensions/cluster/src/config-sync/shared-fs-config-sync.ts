/**
 * @fileoverview **共享文件系统配置同步**：通过 NFS/EFS 等挂载目录在多副本间传播 Gateway JSON 配置。
 *
 * @description 集群插件 **config-sync 层** 的无中心后端；`index.ts` 在变更回调中触发 Gateway 热重载。
 * 写入路径使用文件锁 + 版本号文件（`.version`）检测变更；`fs.watch` 与轮询双保险以兼容 NFS。
 *
 * **关键依赖**
 * - `node:fs` / `node:fs/promises` — 监听、读写、原子锁。
 * - `../shared/types.js` — `IConfigSyncService` 契约。
 */

import { readFile, writeFile, stat, unlink } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { ConfigSyncConfig, IConfigSyncService } from "../shared/types.js";

/** @description 版本轮询默认间隔（毫秒），NFS 上 `fs.watch` 不可靠时的兜底。 */
const DEFAULT_SYNC_INTERVAL = 5000;

/** @description 写锁文件视为过期并可强制删除的阈值（毫秒）。 */
const LOCK_TIMEOUT = 10_000;

/**
 * @description 基于共享目录的配置传播服务；适用于多 Pod 挂载同一 PVC 的 K8s 场景。
 *
 * @implements {IConfigSyncService}
 */
export class SharedFsConfigSync implements IConfigSyncService {
  /** 共享目录路径 */
  private readonly sharedPath: string;

  /** 配置文件名 */
  private readonly configFileName = "openclaw.json";

  /** 版本文件名 */
  private readonly versionFileName = ".version";

  /** 同步间隔 */
  private readonly syncInterval: number;

  /** 文件监听器 */
  private watcher: FSWatcher | null = null;

  /** 配置变更回调 */
  private changeCallbacks: Array<(config: Record<string, unknown>) => void> = [];

  /** 上次已知版本 */
  private lastKnownVersion = "";

  /** 定时检查器（备用方案，防 fs.watch 在 NFS 上不稳定） */
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** 防抖定时器 */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: ConfigSyncConfig) {
    this.sharedPath = config.sharedPath ?? "/mnt/openclaw-shared";
    this.syncInterval = config.syncInterval ?? DEFAULT_SYNC_INTERVAL;
  }

  /**
   * @description 校验共享目录、读取初始版本、启动 `fs.watch` 与轮询。
   *
   * @returns 监听就绪后 resolve。
   */
  async start(): Promise<void> {
    const configPath = this.getConfigPath();

    // 检查共享目录
    try {
      await stat(this.sharedPath);
    } catch {
      console.warn(
        `[openclaw-cluster] Shared path not accessible: ${this.sharedPath}. ` +
        "Creating it if possible."
      );
      const { mkdir } = await import("node:fs/promises");
      try {
        await mkdir(this.sharedPath, { recursive: true });
      } catch (mkdirErr) {
        console.error("[openclaw-cluster] Cannot create shared path:", mkdirErr);
      }
    }

    // 读取初始版本
    try {
      this.lastKnownVersion = await this.readVersion();
    } catch {
      this.lastKnownVersion = "";
    }

    // 启动 fs.watch（可能在 NFS 上不工作）
    try {
      this.watcher = watch(this.sharedPath, { persistent: false }, (eventType, filename) => {
        if (filename === this.configFileName || filename === this.versionFileName) {
          this.handleFileChange();
        }
      });

      this.watcher.on("error", (err) => {
        console.warn("[openclaw-cluster] fs.watch error (expected on NFS):", err.message);
      });
    } catch {
      console.warn("[openclaw-cluster] fs.watch not available, using polling only");
    }

    // 启动备用轮询
    this.pollTimer = setInterval(() => {
      this.pollForChanges().catch((err) => {
        console.error("[openclaw-cluster] Config poll error:", err);
      });
    }, this.syncInterval);

    console.log(
      `[openclaw-cluster] Shared FS config sync started: ${this.sharedPath}`
    );
  }

  /**
   * @description 关闭 watcher、轮询与防抖定时器。
   *
   * @returns 资源释放后 resolve。
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    console.log("[openclaw-cluster] Shared FS config sync stopped");
  }

  /**
   * @description 在文件锁保护下写入 `openclaw.json` 并 bump 版本号。
   *
   * @param config - 要扩散的完整 Gateway 配置对象。
   * @returns 写入成功后 resolve。
   * @throws {Error} 无法在超时内获取写锁。
   */
  async pushConfig(config: Record<string, unknown>): Promise<void> {
    const lockPath = this.getLockPath();

    // 获取写锁
    const locked = await this.acquireLock(lockPath);
    if (!locked) {
      throw new Error("[openclaw-cluster] Failed to acquire config write lock");
    }

    try {
      // 写入配置
      const configPath = this.getConfigPath();
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");

      // 更新版本号
      const version = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await writeFile(this.getVersionPath(), version, "utf-8");
      this.lastKnownVersion = version;

      console.log(`[openclaw-cluster] Config pushed to shared FS, version: ${version}`);
    } finally {
      // 释放锁
      await this.releaseLock(lockPath);
    }
  }

  /**
   * @description 注册配置变更回调（版本号变化且 JSON 解析成功时触发）。
   *
   * @param callback - 接收新配置对象的观察者。
   */
  onConfigChange(callback: (config: Record<string, unknown>) => void): void {
    this.changeCallbacks.push(callback);
  }

  /**
   * 处理文件变更事件（fs.watch 触发）
   * 使用防抖避免多次触发
   */
  private handleFileChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.pollForChanges().catch((err) => {
        console.error("[openclaw-cluster] File change handling error:", err);
      });
    }, 500);
  }

  /**
   * 轮询检查配置是否变更
   * 通过比对版本号判断是否需要重新加载
   */
  private async pollForChanges(): Promise<void> {
    try {
      const currentVersion = await this.readVersion();
      if (currentVersion && currentVersion !== this.lastKnownVersion) {
        this.lastKnownVersion = currentVersion;

        // 读取新配置
        const configPath = this.getConfigPath();
        const content = await readFile(configPath, "utf-8");
        const config = JSON.parse(content) as Record<string, unknown>;

        console.log(`[openclaw-cluster] Config change detected, version: ${currentVersion}`);

        // 通知回调
        for (const callback of this.changeCallbacks) {
          try {
            callback(config);
          } catch (err) {
            console.error("[openclaw-cluster] Config change callback error:", err);
          }
        }
      }
    } catch {
      // 文件不存在或读取失败，静默忽略
    }
  }

  /**
   * 读取版本文件
   */
  private async readVersion(): Promise<string> {
    try {
      return await readFile(this.getVersionPath(), "utf-8");
    } catch {
      return "";
    }
  }

  /**
   * 获取写锁（简单文件锁）
   */
  private async acquireLock(lockPath: string): Promise<boolean> {
    const maxRetries = 10;
    for (let i = 0; i < maxRetries; i++) {
      try {
        // 检查锁文件是否存在
        const lockStat = await stat(lockPath).catch(() => null);
        if (lockStat) {
          // 锁文件存在，检查是否已过期
          const age = Date.now() - lockStat.mtimeMs;
          if (age > LOCK_TIMEOUT) {
            // 强制删除过期锁
            await unlink(lockPath).catch(() => {});
          } else {
            // 等待后重试
            await new Promise((resolve) => setTimeout(resolve, 200));
            continue;
          }
        }

        // 创建锁文件
        await writeFile(lockPath, `${process.pid}-${Date.now()}`, { flag: "wx" });
        return true;
      } catch {
        // 创建失败（并发竞争），等待重试
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    return false;
  }

  /**
   * 释放写锁
   */
  private async releaseLock(lockPath: string): Promise<void> {
    try {
      await unlink(lockPath);
    } catch {
      // 静默处理
    }
  }

  /** 获取配置文件完整路径 */
  private getConfigPath(): string {
    return join(this.sharedPath, this.configFileName);
  }

  /** 获取版本文件完整路径 */
  private getVersionPath(): string {
    return join(this.sharedPath, this.versionFileName);
  }

  /** 获取锁文件完整路径 */
  private getLockPath(): string {
    return join(this.sharedPath, `${this.configFileName}.lock`);
  }
}
