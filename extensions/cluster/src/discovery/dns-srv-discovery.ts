/**
 * @fileoverview **DNS SRV 节点发现**：通过 DNS SRV 记录发现 K8s Headless Service 后端 Pod。
 *
 * @description 集群插件 **discovery 层** 后端；定期 `resolveSrv` 并将结果映射为 `ClusterNodeInfo`。
 * 查询失败时保留上次缓存并将超时节点标为 `suspect`。
 *
 * **关键依赖**
 * - `node:dns` — 系统 DNS 解析器。
 */

import * as dns from "node:dns";
import { promisify } from "node:util";
import type { DiscoveryConfig, IDiscoveryService, ClusterNodeInfo } from "../shared/types.js";

const resolveSrv = promisify(dns.resolveSrv);

/** 默认刷新间隔（毫秒） */
const DEFAULT_REFRESH_INTERVAL = 30_000;

/** 默认节点超时（毫秒） */
const DEFAULT_NODE_TIMEOUT = 60_000;

/**
 * @description 基于 DNS SRV 的集群成员发现（无自注册，只读 DNS）。
 *
 * @implements {IDiscoveryService}
 */
export class DnsSrvDiscovery implements IDiscoveryService {
  /** DNS SRV 域名 */
  private readonly domain: string;

  /** 刷新间隔 */
  private readonly refreshInterval: number;

  /** 节点超时时间 */
  private readonly nodeTimeout: number;

  /** 已发现的节点列表 */
  private nodes: ClusterNodeInfo[] = [];

  /** 节点变更回调 */
  private changeCallbacks: Array<(nodes: ClusterNodeInfo[]) => void> = [];

  /** 定时刷新器 */
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: DiscoveryConfig) {
    this.domain = config.dnsDomain ?? "_openclaw._tcp.openclaw-headless.default.svc.cluster.local";
    this.refreshInterval = config.heartbeatInterval ?? DEFAULT_REFRESH_INTERVAL;
    this.nodeTimeout = config.nodeTimeout ?? DEFAULT_NODE_TIMEOUT;
  }

  /**
   * 启动 DNS SRV 发现服务
   * 立即执行一次查询，然后定时刷新
   */
  async start(): Promise<void> {
    console.log(`[openclaw-cluster] DNS SRV discovery started: domain=${this.domain}`);

    // 首次查询
    await this.refresh();

    // 定时刷新
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((err) => {
        console.error("[openclaw-cluster] DNS SRV refresh error:", err);
      });
    }, this.refreshInterval);
  }

  /**
   * 停止发现服务
   */
  async stop(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.nodes = [];
    console.log("[openclaw-cluster] DNS SRV discovery stopped");
  }

  /**
   * 获取当前已知节点列表
   */
  getNodes(): ClusterNodeInfo[] {
    return [...this.nodes];
  }

  /**
   * 注册节点变更监听
   */
  onNodeChange(callback: (nodes: ClusterNodeInfo[]) => void): void {
    this.changeCallbacks.push(callback);
  }

  /**
   * 执行一次 DNS SRV 查询并更新节点列表
   *
   * 流程：
   * 1. 查询 DNS SRV 记录
   * 2. 将 SRV 记录转换为 ClusterNodeInfo
   * 3. 与现有节点列表对比，检测变更
   * 4. 通知变更回调
   */
  private async refresh(): Promise<void> {
    try {
      const records = await resolveSrv(this.domain);

      const now = new Date().toISOString();
      const newNodes: ClusterNodeInfo[] = records.map((record) => {
        // 复用已有节点信息（保留 activeSessions 等运行时数据）
        const existing = this.nodes.find(
          (n) => n.address === record.name && n.port === record.port
        );

        return {
          nodeId: existing?.nodeId ?? `srv-${record.name}:${record.port}`,
          address: record.name,
          port: record.port,
          status: "online" as const,
          lastHeartbeat: now,
          activeSessions: existing?.activeSessions ?? 0,
          activeConnections: existing?.activeConnections ?? 0,
          joinedAt: existing?.joinedAt ?? now,
        };
      });

      // 检测是否有变更
      const changed = this.hasChanges(newNodes);
      this.nodes = newNodes;

      if (changed) {
        console.log(
          `[openclaw-cluster] DNS SRV: ${newNodes.length} node(s) discovered from ${this.domain}`
        );
        this.notifyChange();
      }
    } catch (error) {
      // DNS 查询失败时保留上次成功的缓存
      console.warn(
        `[openclaw-cluster] DNS SRV query failed for ${this.domain}, ` +
        `keeping cached ${this.nodes.length} node(s):`,
        (error as Error).message
      );

      // 标记超时节点为 suspect
      const now = Date.now();
      for (const node of this.nodes) {
        const lastHeartbeat = new Date(node.lastHeartbeat).getTime();
        if (now - lastHeartbeat > this.nodeTimeout) {
          node.status = "suspect";
        }
      }
    }
  }

  /**
   * 检测节点列表是否有变更
   */
  private hasChanges(newNodes: ClusterNodeInfo[]): boolean {
    if (newNodes.length !== this.nodes.length) return true;

    const oldAddresses = new Set(this.nodes.map((n) => `${n.address}:${n.port}`));
    const newAddresses = new Set(newNodes.map((n) => `${n.address}:${n.port}`));

    for (const addr of newAddresses) {
      if (!oldAddresses.has(addr)) return true;
    }
    return false;
  }

  /**
   * 通知所有变更监听器
   */
  private notifyChange(): void {
    for (const callback of this.changeCallbacks) {
      try {
        callback(this.getNodes());
      } catch (err) {
        console.error("[openclaw-cluster] Node change callback error:", err);
      }
    }
  }
}
