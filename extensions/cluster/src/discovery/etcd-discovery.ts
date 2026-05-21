/**
 * etcd 节点发现实现
 *
 * 通过 etcd 键值存储进行节点注册和发现：
 * - 每个节点在 etcd 中注册带 TTL 的 lease
 * - 节点定期续约 lease（心跳）
 * - 通过 watch 机制监听节点变更
 * - 节点离线时 lease 过期自动清理
 *
 * 注意：本实现使用 etcd v3 HTTP API（无需额外 gRPC 依赖），
 * 适用于轻量部署。生产环境建议使用 etcd3 npm 包。
 */

import type { ClusterNodeInfo, DiscoveryConfig, IDiscoveryService } from "../types.js";

/** etcd 中节点键的前缀 */
const ETCD_PREFIX = "/openclaw/cluster/nodes/";

/** 节点注册信息（存储在 etcd 中） */
interface EtcdNodeEntry {
  nodeId: string;
  address: string;
  port: number;
  joinedAt: string;
  activeSessions: number;
  activeConnections: number;
}

/**
 * etcd 节点发现服务
 *
 * 使用 etcd v3 HTTP API 实现节点注册、心跳和发现。
 */
export class EtcdDiscovery implements IDiscoveryService {
  /** etcd 端点列表 */
  private readonly endpoints: string[];

  /** 当前节点 ID */
  private readonly nodeId: string;

  /** 心跳间隔（毫秒） */
  private readonly heartbeatInterval: number;

  /** 节点超时时间（秒，用作 etcd lease TTL） */
  private readonly leaseTtlSeconds: number;

  /** 已知节点列表 */
  private nodes: ClusterNodeInfo[] = [];

  /** 节点变更回调列表 */
  private changeCallbacks: Array<(nodes: ClusterNodeInfo[]) => void> = [];

  /** 心跳定时器 */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** 节点刷新定时器 */
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  /** etcd lease ID（十六进制字符串） */
  private leaseId: string | null = null;

  /** 是否已停止 */
  private stopped = false;

  constructor(config: DiscoveryConfig, nodeId: string) {
    this.endpoints = config.etcdEndpoints ?? ["http://localhost:2379"];
    this.nodeId = nodeId;
    this.heartbeatInterval = config.heartbeatInterval ?? 5_000;
    this.leaseTtlSeconds = Math.ceil((config.nodeTimeout ?? 15_000) / 1000);
  }

  /**
   * 启动 etcd 发现服务
   *
   * 1. 创建 etcd lease
   * 2. 注册当前节点
   * 3. 启动心跳定时器
   * 4. 加载所有现有节点
   */
  async start(): Promise<void> {
    try {
      // 创建 Lease
      this.leaseId = await this.grantLease();
      console.log(`[openclaw-cluster] etcd lease created: ${this.leaseId} (TTL: ${this.leaseTtlSeconds}s)`);

      // 注册当前节点
      await this.registerSelf();

      // 加载已有节点
      await this.refreshNodes();

      // 启动心跳（续约 lease）
      this.heartbeatTimer = setInterval(() => {
        void this.keepAlive();
      }, this.heartbeatInterval);

      // 定期刷新节点列表
      this.refreshTimer = setInterval(() => {
        void this.refreshNodes();
      }, this.heartbeatInterval * 2);

      console.log(`[openclaw-cluster] etcd discovery started with ${this.endpoints.length} endpoint(s)`);
    } catch (err) {
      console.error("[openclaw-cluster] etcd discovery start failed:", err);
      throw err;
    }
  }

  /**
   * 停止 etcd 发现服务
   *
   * 清理定时器、撤销 lease（自动删除注册的键）
   */
  async stop(): Promise<void> {
    this.stopped = true;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    // 撤销 lease（自动删除该 lease 关联的所有键）
    if (this.leaseId) {
      try {
        await this.revokeLease();
        console.log("[openclaw-cluster] etcd lease revoked");
      } catch {
        console.warn("[openclaw-cluster] Failed to revoke etcd lease (node may already be removed)");
      }
    }

    this.nodes = [];
    this.changeCallbacks = [];
    console.log("[openclaw-cluster] etcd discovery stopped");
  }

  /** 获取当前已知节点 */
  getNodes(): ClusterNodeInfo[] {
    return [...this.nodes];
  }

  /** 注册节点变更监听 */
  onNodeChange(callback: (nodes: ClusterNodeInfo[]) => void): void {
    this.changeCallbacks.push(callback);
  }

  // ======================== etcd HTTP API 封装 ========================

  /**
   * 向当前活跃 etcd 端点发送请求
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

    throw new AggregateError(errors, `All etcd endpoints failed: ${this.endpoints.join(", ")}`);
  }

  /**
   * 创建 etcd lease
   *
   * @returns lease ID 的十六进制字符串
   */
  private async grantLease(): Promise<string> {
    const result = (await this.etcdRequest("/v3/lease/grant", {
      TTL: this.leaseTtlSeconds,
    })) as { ID: string };

    return result.ID;
  }

  /**
   * 续约 lease（保活）
   */
  private async keepAlive(): Promise<void> {
    if (this.stopped || !this.leaseId) return;

    try {
      await this.etcdRequest("/v3/lease/keepalive", {
        ID: this.leaseId,
      });
    } catch (err) {
      console.warn("[openclaw-cluster] etcd keepalive failed:", (err as Error).message);
    }
  }

  /**
   * 撤销 lease
   */
  private async revokeLease(): Promise<void> {
    if (!this.leaseId) return;
    await this.etcdRequest("/v3/lease/revoke", { ID: this.leaseId });
  }

  /**
   * 注册当前节点到 etcd
   *
   * 键格式：/openclaw/cluster/nodes/{nodeId}
   * 值：JSON 编码的节点信息
   */
  private async registerSelf(): Promise<void> {
    const entry: EtcdNodeEntry = {
      nodeId: this.nodeId,
      address: this.getLocalAddress(),
      port: this.getLocalPort(),
      joinedAt: new Date().toISOString(),
      activeSessions: 0,
      activeConnections: 0,
    };

    const key = btoa(`${ETCD_PREFIX}${this.nodeId}`);
    const value = btoa(JSON.stringify(entry));

    await this.etcdRequest("/v3/kv/put", {
      key,
      value,
      lease: this.leaseId,
    });

    console.log(`[openclaw-cluster] Node ${this.nodeId} registered in etcd`);
  }

  /**
   * 从 etcd 刷新节点列表
   *
   * 使用前缀查询获取所有注册的节点
   */
  private async refreshNodes(): Promise<void> {
    if (this.stopped) return;

    try {
      const rangeKey = btoa(ETCD_PREFIX);
      const rangeEnd = btoa(this.incrementLastByte(ETCD_PREFIX));

      const result = (await this.etcdRequest("/v3/kv/range", {
        key: rangeKey,
        range_end: rangeEnd,
      })) as { kvs?: Array<{ key: string; value: string }> };

      const newNodes: ClusterNodeInfo[] = [];

      for (const kv of result.kvs ?? []) {
        try {
          const entry = JSON.parse(atob(kv.value)) as EtcdNodeEntry;
          newNodes.push({
            nodeId: entry.nodeId,
            address: entry.address,
            port: entry.port,
            status: "online",
            lastHeartbeat: new Date().toISOString(),
            activeSessions: entry.activeSessions,
            activeConnections: entry.activeConnections,
            joinedAt: entry.joinedAt,
          });
        } catch {
          // 跳过格式错误的条目
        }
      }

      // 检测节点变更
      const changed =
        newNodes.length !== this.nodes.length ||
        newNodes.some(
          (n) => !this.nodes.find((existing) => existing.nodeId === n.nodeId)
        );

      this.nodes = newNodes;

      if (changed) {
        for (const cb of this.changeCallbacks) {
          try {
            cb(this.nodes);
          } catch {
            // 忽略回调异常
          }
        }
      }
    } catch (err) {
      console.warn("[openclaw-cluster] etcd refresh nodes failed:", (err as Error).message);
    }
  }

  /**
   * 获取本地监听地址
   * 生产环境应从配置或网卡获取
   */
  private getLocalAddress(): string {
    return process.env.OPENCLAW_CLUSTER_ADDRESS ?? "127.0.0.1";
  }

  /**
   * 获取本地代理端口
   */
  private getLocalPort(): number {
    return parseInt(process.env.OPENCLAW_CLUSTER_PORT ?? "18790", 10);
  }

  /**
   * 将字符串最后一个字节加一（用于 etcd 前缀范围查询）
   *
   * @param prefix - 前缀字符串
   * @returns 前缀的下一个值
   */
  private incrementLastByte(prefix: string): string {
    const bytes = new TextEncoder().encode(prefix);
    bytes[bytes.length - 1] += 1;
    return new TextDecoder().decode(bytes);
  }
}
