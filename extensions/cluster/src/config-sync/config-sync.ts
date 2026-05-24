/**
 * 配置同步服务工厂
 *
 * 根据配置类型创建对应的配置同步实现：
 * - none      -- 无同步（单节点模式）
 * - etcd-kv   -- etcd 键值存储同步
 * - shared-fs -- 共享文件系统同步（NFS / EFS）
 */

import type { ConfigSyncConfig, IConfigSyncService } from "../shared/types.js";
import { EtcdConfigSync } from "./etcd-config-sync.js";
import { SharedFsConfigSync } from "./shared-fs-config-sync.js";

/**
 * 创建配置同步服务实例
 * 工厂方法，根据配置类型返回对应实现
 *
 * @param config - 同步配置
 * @returns 配置同步服务实例
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
 * 空操作配置同步（无同步）
 * 单节点模式或不需要配置同步时使用
 */
class NoopConfigSync implements IConfigSyncService {
  async start(): Promise<void> {
    console.log("[openclaw-cluster] Config sync: none (single-node mode)");
  }

  async stop(): Promise<void> {
    // 无操作
  }

  async pushConfig(_config: Record<string, unknown>): Promise<void> {
    // 无操作
  }

  onConfigChange(_callback: (config: Record<string, unknown>) => void): void {
    // 无操作
  }
}
