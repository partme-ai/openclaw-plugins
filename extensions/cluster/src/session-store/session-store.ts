/**
 * @fileoverview **会话粘性索引工厂**：在 `memory`/`redis`/`postgresql` 后端间选择 `ISessionStoreService`。
 *
 * @description Gateway 业务把 `sessionKey→nodeId` 的权威来源委托给此模块，从而在多副本扩缩时仍可寻址。
 */


import type { SessionStoreConfig, ISessionStoreService } from "../shared/types.js";
import { RedisSessionStore } from "./redis-session-store.js";
import { PostgresSessionStore } from "./pg-session-store.js";

/**
 * @description 工厂：`SessionStoreConfig.type` → store 实现。
 *
 * @param config - `cluster.sessionStore`。
 * @param nodeId - 当前副本 ID，用于 **registerSession** 的值域。
 * @returns 未调用 `start()` 的具体后端适配实例。
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
 * @description 进程内 `Map` 会话注册表；**不参与跨主机一致性**。
 *
 * @remarks `nodeId` 字段目前固定为 `"local"`——若未来需要多 Tab 测试，可改为 ctor 注入。
 */
class MemorySessionStore implements ISessionStoreService {
  /** @description sessionKey → 持有该会话的 nodeId 映射表。 */
  private store = new Map<string, string>();

  /** @description 本进程逻辑节点 ID；内存模式下固定为 `"local"`。 */
  private nodeId = "local";

  /**
   * @description 启动内存会话存储（无外部连接，仅打印日志）。
   *
   * @returns 解析即完成的 Promise。
   */
  async start(): Promise<void> {
    console.log("[openclaw-cluster] Session store: memory (single-node only)");
  }

  /**
   * @description 清空内存映射并释放资源。
   *
   * @returns 解析即完成的 Promise。
   */
  async stop(): Promise<void> {
    this.store.clear();
  }

  /**
   * @description 查询会话当前绑定的节点 ID。
   *
   * @param sessionKey - 会话唯一标识。
   * @returns 节点 ID；未注册时返回 `null`。
   */
  async getSessionNode(sessionKey: string): Promise<string | null> {
    return this.store.get(sessionKey) ?? null;
  }

  /**
   * @description 将会话注册到本节点（覆盖已有映射）。
   *
   * @param sessionKey - 会话唯一标识。
   * @returns 解析即完成的 Promise。
   */
  async registerSession(sessionKey: string): Promise<void> {
    this.store.set(sessionKey, this.nodeId);
  }

  /**
   * @description 从内存表移除会话映射。
   *
   * @param sessionKey - 会话唯一标识。
   * @returns 解析即完成的 Promise。
   */
  async removeSession(sessionKey: string): Promise<void> {
    this.store.delete(sessionKey);
  }
}
