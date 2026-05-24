/**
 * @fileoverview **Redis 节点发现**：通过 SET + SMEMBERS 实现轻量级 membership 注册与轮询。
 *
 * @description 集群插件 **discovery 层** 后端；本节点 SADD 集合并 SET 带 TTL 的 `address:port`，
 * 其他副本轮询 SMEMBERS + GET 构建 `ClusterNodeInfo[]`，变更时通知 `proxy.updateNodes`。
 *
 * **关键依赖**
 * - `node:net` — 内嵌 `MinimalRedisClient`（RESP，支持数组响应）。
 * - 环境变量 `OPENCLAW_CLUSTER_ADDRESS` / `OPENCLAW_CLUSTER_PORT` — 自注册地址。
 */

import { createConnection, type Socket } from "node:net";
import type { ClusterNodeInfo, DiscoveryConfig, IDiscoveryService } from "../shared/types.js";

/** @description 默认 Redis 键前缀（集合 + per-node KV）。 */
const DEFAULT_PREFIX = "openclaw:cluster:nodes";

/** @description 节点 KV 的 TTL（秒）；心跳需在此间隔内续期。 */
const NODE_TTL_SEC = 30;

/** @description 拉取成员列表的轮询间隔（毫秒）。 */
const REFRESH_MS = 8_000;

/** @description 本节点 TTL 续期（心跳）间隔（毫秒）。 */
const HEARTBEAT_MS = 10_000;

/**
 * @description 最小 RESP 客户端：单连接 FIFO 队列，支持 bulk string 与数组类型。
 *
 * @remarks 与 `redis-session-store` 类似但 `readOne` 支持 `*` 数组，供 SMEMBERS 使用。
 */
class MinimalRedisClient {
  private socket: Socket | null = null;
  private queue: Array<{ resolve: (v: string | string[] | null) => void; reject: (e: Error) => void }> = [];
  private buffer = "";
  private connected = false;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly password: string | null
  ) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = createConnection({ host: this.host, port: this.port }, () => {
        this.connected = true;
        if (this.password) {
          void this.rawSend(["AUTH", this.password])
            .then(() => resolve())
            .catch(reject);
        } else {
          resolve();
        }
      });
      this.socket.setEncoding("utf-8");
      this.socket.on("data", (d: string) => {
        this.buffer += d;
        this.drain();
      });
      this.socket.on("error", (e) => {
        if (this.queue.length) this.queue.shift()?.reject(e);
      });
      this.socket.on("close", () => {
        this.connected = false;
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      try {
        await this.rawSend(["QUIT"]);
      } catch {
        // ignore
      }
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.queue = [];
  }

  /** 发送命令并返回单条或数组；null 表示 nil */
  async cmd(...args: string[]): Promise<string | string[] | null> {
    return this.rawSend(args);
  }

  private encode(args: string[]): string {
    let s = `*${args.length}\r\n`;
    for (const a of args) s += `$${Buffer.byteLength(a)}\r\n${a}\r\n`;
    return s;
  }

  private rawSend(args: string[]): Promise<string | string[] | null> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new Error("Redis not connected"));
        return;
      }
      this.queue.push({ resolve, reject });
      this.socket.write(this.encode(args));
    });
  }

  private drain(): void {
    while (this.queue.length > 0) {
      const reply = this.readOne();
      if (reply === undefined) break;
      const pending = this.queue.shift();
      if (pending) pending.resolve(reply);
    }
  }

  /** 从 buffer 解析一个完整 RESP 响应，消费 buffer；不完整则返回 undefined */
  private readOne(): string | string[] | null | undefined {
    if (this.buffer.length === 0) return undefined;
    const c = this.buffer[0];
    const nl = this.buffer.indexOf("\r\n");
    if (nl === -1) return undefined;

    if (c === "*") {
      const n = parseInt(this.buffer.slice(1, nl), 10);
      const saved = this.buffer;
      this.buffer = this.buffer.slice(nl + 2);
      if (n === -1) return null;
      const arr: string[] = [];
      for (let i = 0; i < n; i++) {
        const el = this.readOne();
        if (el === undefined) {
          this.buffer = saved;
          return undefined;
        }
        arr.push(typeof el === "string" ? el : el === null ? "" : (el as string[])[0] ?? "");
      }
      return arr;
    }

    if (c === "+" || c === "-" || c === ":") {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 2);
      if (c === "-") throw new Error("Redis: " + line.slice(1));
      return c === ":" ? line.slice(1) : line.slice(1);
    }

    if (c === "$") {
      const len = parseInt(this.buffer.slice(1, nl), 10);
      this.buffer = this.buffer.slice(nl + 2);
      if (len === -1) return null;
      if (this.buffer.length < len + 2) {
        this.buffer = "$" + String(len) + "\r\n" + this.buffer;
        return undefined;
      }
      const data = this.buffer.slice(0, len);
      this.buffer = this.buffer.slice(len + 2);
      return data;
    }

    this.buffer = this.buffer.slice(nl + 2);
    return "";
  }
}

export class RedisDiscovery implements IDiscoveryService {
  /** @description Redis 连接 URL。 */
  private readonly redisUrl: string;

  /** @description 键前缀，隔离不同集群或环境。 */
  private readonly keyPrefix: string;

  /** @description 本副本逻辑节点 ID。 */
  private readonly nodeId: string;

  /** @description 注册到 Redis 的可达 IP/主机名。 */
  private readonly selfAddress: string;

  /** @description 注册到 Redis 的 proxy 平面端口。 */
  private readonly selfPort: number;

  /** @description RESP 客户端实例。 */
  private client: MinimalRedisClient | null = null;

  /** @description 最近一次 refresh 得到的成员快照。 */
  private nodes: ClusterNodeInfo[] = [];

  /** @description 拓扑变更订阅者。 */
  private changeCallbacks: Array<(nodes: ClusterNodeInfo[]) => void> = [];

  /** @description 成员列表轮询定时器。 */
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  /** @description TTL 续约定时器。 */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** @description 停止标志，防止定时器在 teardown 后继续执行。 */
  private stopped = false;

  /**
   * @description 解析 Redis URL 与自注册地址环境变量。
   *
   * @param config - `cluster.discovery` 配置。
   * @param nodeId - 当前副本 ID。
   */
  constructor(config: DiscoveryConfig, nodeId: string) {
    this.redisUrl = config.redisUrl ?? "redis://localhost:6379";
    this.keyPrefix = config.redisKeyPrefix ?? DEFAULT_PREFIX;
    this.nodeId = nodeId;
    this.selfAddress = process.env.OPENCLAW_CLUSTER_ADDRESS ?? "127.0.0.1";
    this.selfPort = parseInt(process.env.OPENCLAW_CLUSTER_PORT ?? "18790", 10);
  }

  private setKey(): string {
    return `${this.keyPrefix}:nodes`;
  }

  private nodeKey(id: string): string {
    return `${this.keyPrefix}:node:${id}`;
  }

  /**
   * @description 连接 Redis、自注册、启动心跳与成员轮询。
   *
   * @returns 首次 `refreshNodes` 完成后 resolve。
   */
  async start(): Promise<void> {
    const u = new URL(this.redisUrl);
    const host = u.hostname || "127.0.0.1";
    const port = parseInt(u.port || "6379", 10);
    const password = u.password ? decodeURIComponent(u.password) : null;
    this.client = new MinimalRedisClient(host, port, password);
    await this.client.connect();
    console.log(
      `[openclaw-cluster] Redis discovery started: ${host}:${port}, prefix=${this.keyPrefix}, nodeId=${this.nodeId}`
    );
    await this.registerSelf();
    await this.refreshNodes();
    this.heartbeatTimer = setInterval(() => this.heartbeat().catch(() => {}), HEARTBEAT_MS);
    this.refreshTimer = setInterval(
      () => this.refreshNodes().catch((e) => console.warn("[openclaw-cluster] Redis discovery refresh:", (e as Error).message)),
      REFRESH_MS
    );
  }

  /**
   * @description 注销本节点、断开 Redis、清空回调与快照。
   *
   * @returns teardown 完成后 resolve。
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    try {
      await this.deregisterSelf();
    } catch {
      // ignore
    }
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
    this.changeCallbacks = [];
    this.nodes = [];
    console.log("[openclaw-cluster] Redis discovery stopped");
  }

  /**
   * @description 返回当前成员列表浅拷贝。
   *
   * @returns `ClusterNodeInfo[]` 快照。
   */
  getNodes(): ClusterNodeInfo[] {
    return [...this.nodes];
  }

  /**
   * @description 注册成员集合变更回调。
   *
   * @param callback - 节点列表更新时触发。
   */
  onNodeChange(callback: (nodes: ClusterNodeInfo[]) => void): void {
    this.changeCallbacks.push(callback);
  }

  /** @description SADD 集合成员并 SET 带 TTL 的 address:port KV。 */
  private async registerSelf(): Promise<void> {
    const c = this.client!;
    const val = `${this.selfAddress}:${this.selfPort}`;
    await c.cmd("SADD", this.setKey(), this.nodeId);
    await c.cmd("SET", this.nodeKey(this.nodeId), val, "EX", String(NODE_TTL_SEC));
  }

  private async deregisterSelf(): Promise<void> {
    const c = this.client;
    if (!c) return;
    await c.cmd("SREM", this.setKey(), this.nodeId);
    await c.cmd("DEL", this.nodeKey(this.nodeId));
  }

  private async heartbeat(): Promise<void> {
    if (this.stopped || !this.client) return;
    const val = `${this.selfAddress}:${this.selfPort}`;
    await this.client.cmd("SET", this.nodeKey(this.nodeId), val, "EX", String(NODE_TTL_SEC));
  }

  private async refreshNodes(): Promise<void> {
    if (this.stopped || !this.client) return;
    const memberRes = await this.client.cmd("SMEMBERS", this.setKey());
    const ids = Array.isArray(memberRes) ? memberRes : memberRes ? [memberRes] : [];
    const newNodes: ClusterNodeInfo[] = [];
    for (const id of ids) {
      if (!id) continue;
      const raw = await this.client.cmd("GET", this.nodeKey(id));
      const addrPort = typeof raw === "string" ? raw : null;
      if (!addrPort) continue;
      const [address, portStr] = addrPort.split(":");
      const port = parseInt(portStr ?? "18790", 10);
      newNodes.push({
        nodeId: id,
        address: address ?? "0.0.0.0",
        port,
        status: "online",
        lastHeartbeat: new Date().toISOString(),
        activeSessions: 0,
        activeConnections: 0,
        joinedAt: new Date().toISOString(),
      });
    }
    const changed =
      newNodes.length !== this.nodes.length ||
      newNodes.some((n) => !this.nodes.find((e) => e.nodeId === n.nodeId));
    this.nodes = newNodes;
    if (changed) {
      for (const cb of this.changeCallbacks) try { cb(this.nodes); } catch { /* ignore */ }
    }
  }
}
