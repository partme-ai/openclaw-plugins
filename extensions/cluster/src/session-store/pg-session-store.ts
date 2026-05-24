/**
 * @fileoverview **PostgreSQL 共享会话存储**：实现 `ISessionStoreService`，持久化 `sessionKey→nodeId` 映射。
 *
 * @description 集群插件 **session-store 层** 的关系型后端；表 `openclaw_sessions` 存储会话归属，
 * 配合进程内短 TTL 缓存减少查询压力。可选动态加载 `pg` 模块；不可用时降级为仅内存缓存模式。
 *
 * **关键依赖**
 * - 可选 `pg` npm 包 — 通过 `createRequire` 动态加载。
 * - `../shared/types.js` — 服务接口与配置类型。
 *
 * **表结构**
 * ```sql
 * CREATE TABLE IF NOT EXISTS openclaw_sessions (
 *   session_key TEXT PRIMARY KEY,
 *   node_id     TEXT NOT NULL,
 *   updated_at  TIMESTAMP DEFAULT NOW()
 * );
 * ```
 */

import type { SessionStoreConfig, ISessionStoreService } from "../shared/types.js";

/** @description 默认会话 TTL（秒），与 Redis 后端语义对齐。 */
const DEFAULT_SESSION_TTL = 3600;

/** @description 后台 TTL 清理任务间隔（毫秒）。 */
const CLEANUP_INTERVAL = 60_000;

/**
 * @description 基于 PostgreSQL 的跨节点会话索引；`pg` 不可用时自动切换 cache-only 模式。
 *
 * @implements {ISessionStoreService}
 */
export class PostgresSessionStore implements ISessionStoreService {
  /** @description PostgreSQL 连接串（`postgresql://...`）。 */
  private readonly postgresUrl: string;

  /** @description 当前 Gateway 副本逻辑节点 ID。 */
  private readonly nodeId: string;

  /** @description 会话记录在 DB/缓存中的有效时长（秒）。 */
  private readonly sessionTtl: number;

  /** @description 进程内 L1 缓存：sessionKey → { nodeId, updatedAt }。 */
  private readonly cache = new Map<string, { nodeId: string; updatedAt: number }>();

  /** @description L1 缓存条目最大存活时间（毫秒）。 */
  private readonly cacheTtl = 10_000;

  /** @description 周期性 TTL 清理的 `setInterval` 句柄。 */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * @description `true` 表示无法连接 PG，读写仅走内存缓存（开发/降级场景）。
   */
  private simpleMode = true;

  /**
   * @description 绑定连接 URL、节点 ID 与会话 TTL。
   *
   * @param config - `cluster.sessionStore` 配置。
   * @param nodeId - 当前副本 ID。
   */
  constructor(config: SessionStoreConfig, nodeId: string) {
    this.postgresUrl = config.postgresUrl ?? "postgresql://localhost:5432/openclaw";
    this.nodeId = nodeId;
    this.sessionTtl = config.sessionTtl ?? DEFAULT_SESSION_TTL;
  }

  /**
   * @description 建表（若不存在）并启动 TTL 清理定时器。
   *
   * @returns 初始化完成后 resolve；建表失败时进入 cache-only 模式仍 resolve。
   */
  async start(): Promise<void> {
    console.log(
      `[openclaw-cluster] PostgreSQL session store starting: ${this.postgresUrl}`
    );

    // 尝试初始化表
    try {
      await this.executeQuery(
        `CREATE TABLE IF NOT EXISTS openclaw_sessions (
          session_key TEXT PRIMARY KEY,
          node_id TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT NOW()
        )`
      );
      console.log("[openclaw-cluster] PostgreSQL session store: table ready");
    } catch (error) {
      console.warn(
        "[openclaw-cluster] PostgreSQL init failed, using cache-only mode:",
        (error as Error).message
      );
      this.simpleMode = true;
    }

    // 启动 TTL 清理
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch((err) => {
        console.error("[openclaw-cluster] Session cleanup error:", err);
      });
    }, CLEANUP_INTERVAL);
  }

  /**
   * @description 停止清理定时器并清空 L1 缓存。
   *
   * @returns 解析即完成的 Promise。
   */
  async stop(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
    console.log("[openclaw-cluster] PostgreSQL session store stopped");
  }

  /**
   * @description 先查 L1 缓存，未命中且非 simpleMode 时查 PostgreSQL。
   *
   * @param sessionKey - 会话唯一标识。
   * @returns 节点 ID；不存在时返回 `null`。
   */
  async getSessionNode(sessionKey: string): Promise<string | null> {
    // 查缓存
    const cached = this.cache.get(sessionKey);
    if (cached && Date.now() - cached.updatedAt < this.cacheTtl) {
      return cached.nodeId;
    }

    if (this.simpleMode) {
      return cached?.nodeId ?? null;
    }

    // 查数据库
    try {
      const result = await this.executeQuery(
        `SELECT node_id FROM openclaw_sessions WHERE session_key = '${this.escapeString(sessionKey)}'`
      );
      if (result && result.length > 0) {
        const nodeId = result[0].node_id as string;
        this.cache.set(sessionKey, { nodeId, updatedAt: Date.now() });
        return nodeId;
      }
    } catch (error) {
      console.error("[openclaw-cluster] PG getSessionNode error:", error);
    }

    return null;
  }

  /**
   * @description UPSERT 会话映射到本节点（幂等）；同步更新 L1 缓存。
   *
   * @param sessionKey - 会话唯一标识。
   * @returns 写入完成后 resolve（DB 错误时仅打日志，缓存仍生效）。
   */
  async registerSession(sessionKey: string): Promise<void> {
    // 更新缓存
    this.cache.set(sessionKey, { nodeId: this.nodeId, updatedAt: Date.now() });

    if (this.simpleMode) return;

    try {
      await this.executeQuery(
        `INSERT INTO openclaw_sessions (session_key, node_id, updated_at)
         VALUES ('${this.escapeString(sessionKey)}', '${this.escapeString(this.nodeId)}', NOW())
         ON CONFLICT (session_key) DO UPDATE SET
           node_id = '${this.escapeString(this.nodeId)}',
           updated_at = NOW()`
      );
    } catch (error) {
      console.error("[openclaw-cluster] PG registerSession error:", error);
    }
  }

  /**
   * @description 从缓存与数据库删除会话映射。
   *
   * @param sessionKey - 会话唯一标识。
   * @returns 删除完成后 resolve。
   */
  async removeSession(sessionKey: string): Promise<void> {
    this.cache.delete(sessionKey);

    if (this.simpleMode) return;

    try {
      await this.executeQuery(
        `DELETE FROM openclaw_sessions WHERE session_key = '${this.escapeString(sessionKey)}'`
      );
    } catch (error) {
      console.error("[openclaw-cluster] PG removeSession error:", error);
    }
  }

  /**
   * @description 清理 L1 缓存与 DB 中超过 `sessionTtl` 的过期行。
   *
   * @returns 清理完成后 resolve。
   */
  private async cleanup(): Promise<void> {
    // 清理内存缓存
    const now = Date.now();
    const ttlMs = this.sessionTtl * 1000;
    for (const [key, value] of this.cache.entries()) {
      if (now - value.updatedAt > ttlMs) {
        this.cache.delete(key);
      }
    }

    if (this.simpleMode) return;

    // 清理数据库
    try {
      await this.executeQuery(
        `DELETE FROM openclaw_sessions WHERE updated_at < NOW() - INTERVAL '${this.sessionTtl} seconds'`
      );
    } catch (error) {
      console.error("[openclaw-cluster] PG cleanup error:", error);
    }
  }

  /**
   * @description 动态加载 `pg` 并执行单次查询（每次新建 Client，无连接池）。
   *
   * @param sql - 待执行的 SQL 语句。
   * @returns 结果行数组。
   * @throws {Error} `pg` 模块不可用或查询失败；失败时设置 `simpleMode = true`。
   */
  private async executeQuery(sql: string): Promise<Record<string, unknown>[]> {
    try {
      // 尝试动态加载可选 pg 模块；未安装时切换到内存缓存降级模式。
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      const pg = require("pg") as {
        Client: new (params: { connectionString: string }) => {
          connect(): Promise<void>;
          query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
          end(): Promise<void>;
        };
      };
      const client = new pg.Client({ connectionString: this.postgresUrl });
      await client.connect();
      try {
        const result = await client.query(sql);
        return result.rows as Record<string, unknown>[];
      } finally {
        await client.end();
      }
    } catch {
      // pg 模块不可用，切换到简化模式
      this.simpleMode = true;
      throw new Error("pg module not available, using cache-only mode");
    }
  }

  /**
   * @description SQL 字符串字面量转义（单引号加倍），非参数化查询的最低限度防护。
   *
   * @param str - 原始字符串。
   * @returns 可嵌入 SQL 字面量的转义结果。
   */
  private escapeString(str: string): string {
    return str.replace(/'/g, "''");
  }
}
