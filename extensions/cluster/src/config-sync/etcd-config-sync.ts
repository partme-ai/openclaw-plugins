/**
 * etcd KV 配置同步实现
 *
 * 通过 etcd 键值存储实现跨节点配置同步：
 * - 配置变更写入 etcd 的固定键
 * - 节点定期轮询配置变更（或通过 watch 实时监听）
 * - 支持版本号检测，避免重复加载
 *
 * 键格式：/openclaw/cluster/config/current
 * 值：JSON 编码的完整配置
 */

import type { ConfigSyncConfig, IConfigSyncService } from "../types.js";

/** etcd 中配置键 */
const CONFIG_KEY = "/openclaw/cluster/config/current";

/**
 * etcd KV 配置同步服务
 *
 * 通过 etcd v3 HTTP API 实现配置变更的跨节点同步。
 */
export class EtcdConfigSync implements IConfigSyncService {
  /** etcd 端点列表 */
  private readonly endpoints: string[];

  /** 轮询间隔（毫秒） */
  private readonly syncInterval: number;

  /** 配置变更回调列表 */
  private changeCallbacks: Array<(config: Record<string, unknown>) => void> = [];

  /** 轮询定时器 */
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** 已知配置版本（etcd mod_revision） */
  private knownRevision = 0;

  /** 是否已停止 */
  private stopped = false;

  constructor(config: ConfigSyncConfig) {
    this.endpoints = config.etcdEndpoints ?? ["http://localhost:2379"];
    this.syncInterval = config.syncInterval ?? 10_000;
  }

  /**
   * 启动配置同步
   *
   * 加载初始配置并启动轮询
   */
  async start(): Promise<void> {
    // 加载初始配置
    await this.pollConfig();

    // 启动定期轮询
    this.pollTimer = setInterval(() => {
      void this.pollConfig();
    }, this.syncInterval);

    console.log(
      `[openclaw-cluster] etcd config sync started (interval: ${this.syncInterval}ms, ` +
      `endpoints: ${this.endpoints.join(", ")})`
    );
  }

  /**
   * 停止配置同步
   */
  async stop(): Promise<void> {
    this.stopped = true;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.changeCallbacks = [];
    console.log("[openclaw-cluster] etcd config sync stopped");
  }

  /**
   * 推送配置变更到 etcd
   *
   * @param config - 新配置
   */
  async pushConfig(config: Record<string, unknown>): Promise<void> {
    const key = btoa(CONFIG_KEY);
    const value = btoa(JSON.stringify(config));

    await this.etcdRequest("/v3/kv/put", { key, value });

    console.log("[openclaw-cluster] Configuration pushed to etcd");
  }

  /**
   * 注册配置变更监听
   */
  onConfigChange(callback: (config: Record<string, unknown>) => void): void {
    this.changeCallbacks.push(callback);
  }

  // ======================== 内部方法 ========================

  /**
   * 轮询 etcd 获取最新配置
   */
  private async pollConfig(): Promise<void> {
    if (this.stopped) return;

    try {
      const key = btoa(CONFIG_KEY);

      const result = (await this.etcdRequest("/v3/kv/range", { key })) as {
        kvs?: Array<{ key: string; value: string; mod_revision: string }>;
      };

      if (!result.kvs || result.kvs.length === 0) return;

      const kv = result.kvs[0];
      const revision = parseInt(kv.mod_revision, 10);

      // 仅在版本变更时通知
      if (revision > this.knownRevision) {
        this.knownRevision = revision;

        try {
          const config = JSON.parse(atob(kv.value)) as Record<string, unknown>;

          for (const cb of this.changeCallbacks) {
            try {
              cb(config);
            } catch {
              // 忽略回调异常
            }
          }

          console.log(`[openclaw-cluster] Config updated from etcd (revision: ${revision})`);
        } catch {
          console.warn("[openclaw-cluster] Failed to parse config from etcd");
        }
      }
    } catch (err) {
      console.warn("[openclaw-cluster] etcd config poll failed:", (err as Error).message);
    }
  }

  /**
   * 向 etcd 发送 HTTP 请求
   *
   * @param path - API 路径
   * @param body - 请求体
   */
  private async etcdRequest(path: string, body: Record<string, unknown>): Promise<unknown> {
    const errors: Error[] = [];

    for (const endpoint of this.endpoints) {
      try {
        const url = `${endpoint}${path}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5_000),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`etcd ${response.status}: ${text}`);
        }

        return await response.json();
      } catch (err) {
        errors.push(err as Error);
      }
    }

    throw new AggregateError(errors, `All etcd endpoints failed`);
  }
}
