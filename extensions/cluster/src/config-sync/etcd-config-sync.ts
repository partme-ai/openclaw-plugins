/**
 * @fileoverview **etcd KV 配置同步**：将 Gateway 配置存于 etcd 固定键，通过 revision 检测变更并回调本节点。
 *
 * @description 集群插件 **config-sync 层** 的中心化后端；`index.ts` 收到变更后会写回本地 JSON 并触发 reload。
 *
 * **关键依赖**
 * - etcd v3 HTTP API（`fetch`）— 无 gRPC 客户端依赖。
 * - 键：`/openclaw/cluster/config/current`，值为 JSON 字符串的 base64。
 *
 * @see https://etcd.io/docs/v3.5/dev-guide/api_grpc_gateway/
 */

import type { ConfigSyncConfig, IConfigSyncService } from "../shared/types.js";

/** @description etcd 中存放当前集群配置的键路径。 */
const CONFIG_KEY = "/openclaw/cluster/config/current";

/**
 * @description 基于 etcd KV 的配置传播；以 `mod_revision` 去重避免重复 reload。
 *
 * @implements {IConfigSyncService}
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
   * @description 拉取初始配置并启动 revision 轮询。
   *
   * @returns 首次 poll 完成后 resolve。
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
   * @description 停止轮询并清空变更回调列表。
   *
   * @returns 解析即完成的 Promise。
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
   * @description 将配置 JSON PUT 到 etcd 固定键（base64 编码键值）。
   *
   * @param config - 要写入的完整配置对象。
   * @returns etcd 确认写入后 resolve。
   * @throws {AggregateError} 所有 etcd 端点均失败。
   */
  async pushConfig(config: Record<string, unknown>): Promise<void> {
    const key = btoa(CONFIG_KEY);
    const value = btoa(JSON.stringify(config));

    await this.etcdRequest("/v3/kv/put", { key, value });

    console.log("[openclaw-cluster] Configuration pushed to etcd");
  }

  /**
   * @description 注册配置 revision 前进时的观察者。
   *
   * @param callback - 接收解析后的配置 JSON。
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
