/**
 * 共享会话存储服务工厂
 *
 * 根据配置类型创建对应的会话存储实现：
 * - memory     -- 内存存储（单节点，开发/测试）
 * - redis      -- Redis 共享存储（推荐生产环境）
 * - postgresql -- PostgreSQL 存储（需要持久化时使用）
 */

import type { SessionStoreConfig, ISessionStoreService } from "../types.js";
import { RedisSessionStore } from "./redis-session-store.js";
import { PostgresSessionStore } from "./pg-session-store.js";

/**
 * 创建共享会话存储服务实例
 * 工厂方法，根据配置类型返回对应实现
 *
 * @param config - 存储配置
 * @param nodeId - 当前节点 ID
 * @returns 会话存储服务实例
 */
export function createSessionStoreService(
  config: SessionStoreConfig,
  nodeId?: string
): ISessionStoreService {
  switch (config.type) {
    case "memory":
      return new MemorySessionStore();
    case "redis":
      return new RedisSessionStore(config, nodeId ?? "local");
    case "postgresql":
      return new PostgresSessionStore(config, nodeId ?? "local");
    default:
      throw new Error(`Unknown session store type: ${config.type}`);
  }
}

/**
 * 内存会话存储（单节点）
 * 仅用于开发/测试，不支持跨节点共享
 */
class MemorySessionStore implements ISessionStoreService {
  /** sessionKey -> nodeId */
  private store = new Map<string, string>();

  /** 当前节点 ID */
  private nodeId = "local";

  async start(): Promise<void> {
    console.log("[openclaw_cluster] Session store: memory (single-node only)");
  }

  async stop(): Promise<void> {
    this.store.clear();
  }

  async getSessionNode(sessionKey: string): Promise<string | null> {
    return this.store.get(sessionKey) ?? null;
  }

  async registerSession(sessionKey: string): Promise<void> {
    this.store.set(sessionKey, this.nodeId);
  }

  async removeSession(sessionKey: string): Promise<void> {
    this.store.delete(sessionKey);
  }
}
