/**
 * @fileoverview **Redis 共享会话存储**：实现 `ISessionStoreService`，为多节点会话粘性提供 `sessionKey→nodeId` 映射。
 *
 * @description 集群插件 **session-store 层** 的生产后端之一；Gateway 通过工厂 `createSessionStoreService` 选用。
 * 每个 Session 以 `SET openclaw:cluster:session:{key} {nodeId} EX ttl` 写入 Redis，支持 TTL 自动过期与跨节点迁移。
 *
 * **关键依赖**
 * - Node.js `node:net` — 原生 TCP 连接，自实现 RESP 协议（无 ioredis/redis 依赖）。
 * - `../shared/types.js` — `ISessionStoreService`、`SessionStoreConfig` 契约。
 *
 * @remarks 生产环境建议使用 ioredis 替换此简化 RESP 客户端以获得连接池与集群支持。
 */

import { createConnection, type Socket } from "node:net";
import type { ISessionStoreService, SessionStoreConfig } from "../shared/types.js";

/** @description Redis 键命名空间前缀，避免与其他应用键冲突。 */
const KEY_PREFIX = "openclaw:cluster:session:";

/**
 * @description 基于 Redis 的跨节点会话索引服务。
 *
 * @implements {ISessionStoreService}
 */
export class RedisSessionStore implements ISessionStoreService {
  /** @description `redis://` 连接 URL（含可选密码）。 */
  private readonly redisUrl: string;

  /** @description 会话映射 TTL（秒），到期后 Redis 自动删除键。 */
  private readonly sessionTtl: number;

  /** @description 当前 Gateway 副本的逻辑节点 ID，写入 `registerSession` 的值域。 */
  private readonly nodeId: string;

  /** @description 与 Redis 的 TCP 连接句柄。 */
  private socket: Socket | null = null;

  /**
   * @description FIFO 响应队列：Redis 单连接下请求与响应严格一一对应。
   */
  private responseQueue: Array<{
    resolve: (value: string) => void;
    reject: (err: Error) => void;
  }> = [];

  /** @description 未完整解析的 RESP 字节缓冲。 */
  private buffer = "";

  /** @description TCP 连接是否已建立且可用。 */
  private connected = false;

  /**
   * @description 绑定 Redis URL、TTL 与本节点 ID。
   *
   * @param config - `cluster.sessionStore` 配置。
   * @param nodeId - 当前副本 ID。
   */
  constructor(config: SessionStoreConfig, nodeId: string) {
    this.redisUrl = config.redisUrl ?? "redis://localhost:6379";
    this.sessionTtl = config.sessionTtl ?? 3600;
    this.nodeId = nodeId;
  }

  /**
   * @description 建立 Redis TCP 连接；若 URL 含密码则先执行 `AUTH`。
   *
   * @returns 连接就绪后 resolve。
   * @throws {Error} 连接失败或认证失败时 reject。
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.redisUrl);
      const host = url.hostname || "127.0.0.1";
      const port = parseInt(url.port || "6379", 10);
      const password = url.password;

      this.socket = createConnection({ host, port }, () => {
        this.connected = true;
        console.log(`[openclaw-cluster] Redis session store connected to ${host}:${port}`);

        // 如果有密码则认证
        if (password) {
          void this.sendCommand("AUTH", password)
            .then(() => resolve())
            .catch(reject);
        } else {
          resolve();
        }
      });

      this.socket.setEncoding("utf-8");

      this.socket.on("data", (data: string) => {
        this.buffer += data;
        this.processBuffer();
      });

      this.socket.on("error", (err) => {
        console.error("[openclaw-cluster] Redis connection error:", err.message);
        this.connected = false;
        if (this.responseQueue.length === 0) {
          reject(err);
        }
      });

      this.socket.on("close", () => {
        this.connected = false;
        console.log("[openclaw-cluster] Redis connection closed");
      });
    });
  }

  /**
   * @description 发送 `QUIT` 并销毁 socket，清空响应队列。
   *
   * @returns 关闭完成后 resolve（忽略 QUIT 异常）。
   */
  async stop(): Promise<void> {
    if (this.socket) {
      try {
        await this.sendCommand("QUIT");
      } catch {
        // 忽略关闭异常
      }
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.responseQueue = [];
    console.log("[openclaw-cluster] Redis session store stopped");
  }

  /**
   * @description 查询 Session 当前绑定的节点 ID。
   *
   * @param sessionKey - 会话唯一标识。
   * @returns 节点 ID；键不存在时返回 `null`。
   * @throws {Error} Redis 未连接或命令失败。
   */
  async getSessionNode(sessionKey: string): Promise<string | null> {
    const result = await this.sendCommand("GET", `${KEY_PREFIX}${sessionKey}`);
    return result === "$-1" || result.startsWith("$-1") ? null : this.parseSimpleString(result);
  }

  /**
   * @description 将会话绑定到本节点并设置 TTL（支持迁移：覆盖旧 nodeId）。
   *
   * @param sessionKey - 会话唯一标识。
   * @returns 命令成功后 resolve。
   * @throws {Error} Redis 未连接或 SET 失败。
   */
  async registerSession(sessionKey: string): Promise<void> {
    await this.sendCommand("SET", `${KEY_PREFIX}${sessionKey}`, this.nodeId, "EX", String(this.sessionTtl));
  }

  /**
   * @description 从 Redis 删除会话映射。
   *
   * @param sessionKey - 会话唯一标识。
   * @returns 命令成功后 resolve。
   * @throws {Error} Redis 未连接或 DEL 失败。
   */
  async removeSession(sessionKey: string): Promise<void> {
    await this.sendCommand("DEL", `${KEY_PREFIX}${sessionKey}`);
  }

  // ======================== Redis 协议处理 ========================

  /**
   * @description 编码并发送 RESP 命令，等待对应响应入队 resolve。
   *
   * @param args - Redis 命令及参数（如 `"SET"`, `"key"`, `"value"`）。
   * @returns 原始 RESP 响应行或 bulk string 内容。
   * @throws {Error} 未连接或收到 `-ERR` 错误行。
   */
  private sendCommand(...args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new Error("Redis not connected"));
        return;
      }

      // 构建 RESP 协议消息
      const resp = this.encodeResp(args);
      this.responseQueue.push({ resolve, reject });
      this.socket.write(resp);
    });
  }

  /**
   * 编码 RESP 协议
   *
   * @param args - 命令参数
   * @returns RESP 格式字符串
   */
  private encodeResp(args: string[]): string {
    let msg = `*${args.length}\r\n`;
    for (const arg of args) {
      msg += `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`;
    }
    return msg;
  }

  /**
   * @description 从接收缓冲中解析完整 RESP 响应并唤醒队首 Promise。
   *
   * @remarks 支持 `+`/`-`/`:`/`$` 类型；数组类型做最小跳过处理。
   */
  private processBuffer(): void {
    while (this.buffer.length > 0 && this.responseQueue.length > 0) {
      const nlIdx = this.buffer.indexOf("\r\n");
      if (nlIdx === -1) break;

      const firstChar = this.buffer[0];

      if (firstChar === "+" || firstChar === "-" || firstChar === ":") {
        // 简单字符串、错误、整数
        const line = this.buffer.slice(0, nlIdx);
        this.buffer = this.buffer.slice(nlIdx + 2);

        const pending = this.responseQueue.shift();
        if (pending) {
          if (firstChar === "-") {
            pending.reject(new Error(`Redis error: ${line.slice(1)}`));
          } else {
            pending.resolve(line);
          }
        }
      } else if (firstChar === "$") {
        // Bulk string
        const lenStr = this.buffer.slice(1, nlIdx);
        const len = parseInt(lenStr, 10);

        if (len === -1) {
          // Null bulk string
          this.buffer = this.buffer.slice(nlIdx + 2);
          const pending = this.responseQueue.shift();
          if (pending) pending.resolve("$-1");
        } else {
          // 检查数据是否完整
          const dataStart = nlIdx + 2;
          const dataEnd = dataStart + len + 2; // +2 for trailing \r\n
          if (this.buffer.length < dataEnd) break; // 数据不完整

          const data = this.buffer.slice(dataStart, dataStart + len);
          this.buffer = this.buffer.slice(dataEnd);

          const pending = this.responseQueue.shift();
          if (pending) pending.resolve(data);
        }
      } else {
        // 未知类型或数组，简单跳过一行
        this.buffer = this.buffer.slice(nlIdx + 2);
        const pending = this.responseQueue.shift();
        if (pending) pending.resolve("");
      }
    }
  }

  /**
   * 解析简单字符串响应
   *
   * @param raw - 原始 RESP 响应
   * @returns 解析后的值
   */
  private parseSimpleString(raw: string): string {
    if (raw.startsWith("+")) return raw.slice(1);
    return raw;
  }
}
