/**
 * Redis 共享会话存储实现
 *
 * 使用 Redis 作为跨节点共享会话状态的存储后端：
 * - 每个 Session 通过 SET key=sessionKey value=nodeId 记录所在节点
 * - 带 TTL 自动过期，避免僵尸会话
 * - 支持 Session 迁移（更新 nodeId）
 *
 * 注意：使用原生 TCP 连接实现 Redis 协议，避免引入 ioredis/redis 依赖。
 * 生产环境建议使用 ioredis 替换此简化实现。
 */

import { createConnection, type Socket } from "node:net";
import type { ISessionStoreService, SessionStoreConfig } from "../shared/types.js";

/** Redis 键前缀 */
const KEY_PREFIX = "openclaw:cluster:session:";

/**
 * Redis 会话存储服务
 *
 * 通过 Redis 实现跨节点共享会话状态。
 */
export class RedisSessionStore implements ISessionStoreService {
  /** Redis 连接 URL */
  private readonly redisUrl: string;

  /** Session TTL（秒） */
  private readonly sessionTtl: number;

  /** 当前节点 ID */
  private readonly nodeId: string;

  /** TCP Socket */
  private socket: Socket | null = null;

  /** 请求队列（Redis 是 FIFO 响应） */
  private responseQueue: Array<{
    resolve: (value: string) => void;
    reject: (err: Error) => void;
  }> = [];

  /** 接收数据缓冲区 */
  private buffer = "";

  /** 连接状态 */
  private connected = false;

  constructor(config: SessionStoreConfig, nodeId: string) {
    this.redisUrl = config.redisUrl ?? "redis://localhost:6379";
    this.sessionTtl = config.sessionTtl ?? 3600;
    this.nodeId = nodeId;
  }

  /**
   * 启动 Redis 连接
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
   * 关闭 Redis 连接
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
   * 获取 Session 所在节点
   *
   * @param sessionKey - 会话标识
   * @returns 节点 ID，不存在返回 null
   */
  async getSessionNode(sessionKey: string): Promise<string | null> {
    const result = await this.sendCommand("GET", `${KEY_PREFIX}${sessionKey}`);
    return result === "$-1" || result.startsWith("$-1") ? null : this.parseSimpleString(result);
  }

  /**
   * 注册 Session 到当前节点
   *
   * @param sessionKey - 会话标识
   */
  async registerSession(sessionKey: string): Promise<void> {
    await this.sendCommand("SET", `${KEY_PREFIX}${sessionKey}`, this.nodeId, "EX", String(this.sessionTtl));
  }

  /**
   * 移除 Session
   *
   * @param sessionKey - 会话标识
   */
  async removeSession(sessionKey: string): Promise<void> {
    await this.sendCommand("DEL", `${KEY_PREFIX}${sessionKey}`);
  }

  // ======================== Redis 协议处理 ========================

  /**
   * 发送 Redis RESP 命令
   *
   * @param args - 命令和参数列表
   * @returns Redis 响应字符串
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
   * 处理接收缓冲区中的数据
   *
   * 解析完整的 RESP 响应并回调等待队列
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
