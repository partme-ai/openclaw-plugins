/**
 * @fileoverview **静态拓扑 Discovery**：把配置文件列举的对端网关 `host:port` **升格成运行时视图**，不产生心跳开销。
 *
 * @description 适用于 Dev / Staging 固定拓扑或集成测试；**不监测节点活性**，所有成员恒为 `online`。
 */

import type { ClusterNodeInfo, IDiscoveryService } from "../shared/types.js";

/**
 * @description 将 `staticNodes` 字符串一次性物化为 `ClusterNodeInfo[]`；`onNodeChange` 目前**不会自动触发**（需外部扩展）。
 */
export class StaticDiscovery implements IDiscoveryService {
  /** 静态节点地址列表 */
  private readonly nodeAddresses: string[];

  /** 已解析的节点信息 */
  private nodes: ClusterNodeInfo[] = [];

  /** @description `onNodeChange` 订阅者队列；静态模式下通常保持静音。 */
  private changeCallbacks: Array<(nodes: ClusterNodeInfo[]) => void> = [];

  /**
   * @description 捕获原始地址列表（格式由运维约定）。
   *
   * @param nodeAddresses - 形如 `192.168.1.10:18789` 的条目数组。
   */
  constructor(nodeAddresses: string[]) {
    this.nodeAddresses = nodeAddresses;
  }

  /**
   * @description 启动静态发现：将配置的 `host:port` 列表解析为 `ClusterNodeInfo[]`。
   *
   * @returns 解析完成后 resolve；不触发 `onNodeChange` 回调。
   */
  async start(): Promise<void> {
    // 将 `host:port` 解析为 ClusterNodeInfo；`nodeId` 采用稳定序号，避免每次启动抖动。
    this.nodes = this.nodeAddresses.map((addr, idx) => {
      const [host, portStr] = addr.split(":");
      return {
        nodeId: `node-${idx}`,
        address: host ?? "127.0.0.1",
        port: parseInt(portStr ?? "18789", 10),
        status: "online" as const,
        lastHeartbeat: new Date().toISOString(),
        activeSessions: 0,
        activeConnections: 0,
        joinedAt: new Date().toISOString(),
      };
    });

    console.log(
      `[openclaw-cluster] Static discovery started with ${this.nodes.length} nodes`
    );
  }

  /**
   * @description 清空节点缓存与变更订阅者。
   *
   * @returns 解析即完成的 Promise。
   */
  async stop(): Promise<void> {
    this.nodes = [];
    this.changeCallbacks = [];
    console.log("[openclaw-cluster] Static discovery stopped");
  }

  /**
   * @description 返回当前静态节点列表的浅拷贝。
   *
   * @returns 所有成员恒为 `online` 的节点数组。
   */
  getNodes(): ClusterNodeInfo[] {
    return [...this.nodes];
  }

  /**
   * @description 注册拓扑变更观察者（静态模式下通常不会被调用）。
   *
   * @param callback - 节点列表更新时触发的回调。
   */
  onNodeChange(callback: (nodes: ClusterNodeInfo[]) => void): void {
    this.changeCallbacks.push(callback);
  }
}
