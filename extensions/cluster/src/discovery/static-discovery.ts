/**
 * 静态节点发现实现（骨架）
 * 通过配置文件中的静态节点列表进行发现
 *
 * 适用于：
 * - 开发/测试环境
 * - 节点数量固定的小型部署
 */

import type { ClusterNodeInfo, IDiscoveryService } from "../shared/types.js";

/**
 * 静态节点发现服务
 * 从配置中读取固定的节点列表
 */
export class StaticDiscovery implements IDiscoveryService {
  /** 静态节点地址列表 */
  private readonly nodeAddresses: string[];

  /** 已解析的节点信息 */
  private nodes: ClusterNodeInfo[] = [];

  /** 节点变更回调列表 */
  private changeCallbacks: Array<(nodes: ClusterNodeInfo[]) => void> = [];

  constructor(nodeAddresses: string[]) {
    this.nodeAddresses = nodeAddresses;
  }

  /**
   * 启动发现服务
   * 解析静态节点列表为 ClusterNodeInfo
   */
  async start(): Promise<void> {
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
   * 停止发现服务
   */
  async stop(): Promise<void> {
    this.nodes = [];
    this.changeCallbacks = [];
    console.log("[openclaw-cluster] Static discovery stopped");
  }

  /**
   * 获取当前已知节点
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
}
