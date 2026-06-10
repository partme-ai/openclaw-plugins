/**
 * @fileoverview **配置同步总线工厂**：返回 `none`/`etcd-kv`/`shared-fs` 对应的 `IConfigSyncService`。
 *
 * @description
 * - `none`：在单副本或外部 GitOps 接管配置时关闭集群内一致性协议；
 * - `etcd-kv`：中心化键值存储 + revision 比对；
 * - `shared-fs`：借助 POSIX `watch`/`poll` + 原子写锁兼容 NFS。
 */

import type { ConfigSyncConfig, IConfigSyncService } from "../shared/types.js";
import { EtcdConfigSync } from "./etcd-config-sync.js";
import { SharedFsConfigSync } from "./shared-fs-config-sync.js";

/**
 * @description 运行时工厂：`ConfigSyncConfig.type` → 具体适配器实例。
 *
 * @param config - `cluster.configSync`。
 * @returns 已实现生命周期的服务对象（仍未 `start()`）。
 * @throws {Error} type 字面量漂移。
 */
export function createConfigSyncService(
  config: ConfigSyncConfig
): IConfigSyncService {
  switch (config.type) {
    case "none":
      return new NoopConfigSync();
    case "etcd-kv":
      return new EtcdConfigSync(config);
    case "shared-fs":
      return new SharedFsConfigSync(config);
    default:
      throw new Error(`Unknown config sync type: ${config.type}`);
  }
}

/**
 * @description **No-op / Pass-through**：既不写入外部媒介，也不会触发回调，
 * 保证编排代码路径在单节点场景仍可统一 `await svc.start()`。
 *
 * @remarks `pushConfig` 亦为 stub——控制面 `/cluster/config` POST 仍会成功调用但因无 watcher，
 * **不会扩散**。
 */
class NoopConfigSync implements IConfigSyncService {
  /** @inheritdoc */
  async start(): Promise<void> {
    console.log("[openclaw-cluster] Config sync: none (single-node mode)");
  }

  /** @inheritdoc */
  async stop(): Promise<void> {
    // 无操作
  }

  /** @inheritdoc */
  async pushConfig(_config: Record<string, unknown>): Promise<void> {
    // 无操作
  }

  /** @inheritdoc */
  onConfigChange(_callback: (config: Record<string, unknown>) => void): void {
    // 无操作
  }
}
