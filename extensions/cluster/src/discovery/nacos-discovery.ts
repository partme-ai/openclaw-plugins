/**
 * Nacos 节点发现实现
 *
 * 通过 Nacos Open API 实现服务注册与发现（国内 Spring Cloud / Dubbo 常用）：
 * - 本节点注册为临时实例，定期发送心跳
 * - 轮询 /nacos/v2/ns/instance/list 获取健康实例列表
 * - 停止时注销实例
 *
 * @see https://nacos.io/docs/latest/guide/user/open-api/
 */

import type { ClusterNodeInfo, DiscoveryConfig, IDiscoveryService } from "../shared/types.js";

const DEFAULT_SERVICE_NAME = "openclaw-gateway";
const DEFAULT_GROUP = "DEFAULT_GROUP";
const DEFAULT_REFRESH_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 5_000;

/** Nacos 实例列表接口返回 */
interface NacosInstanceList {
  hosts?: Array<{ ip?: string; port?: number; healthy?: boolean }>;
}

export class NacosDiscovery implements IDiscoveryService {
  private readonly baseUrl: string;
  private readonly serviceName: string;
  private readonly namespace: string;
  private readonly groupName: string;
  private readonly nodeId: string;
  private readonly selfAddress: string;
  private readonly selfPort: number;
  private readonly refreshInterval: number;
  private nodes: ClusterNodeInfo[] = [];
  private changeCallbacks: Array<(nodes: ClusterNodeInfo[]) => void> = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(config: DiscoveryConfig, nodeId: string) {
    this.baseUrl = (config.nacosAddress ?? "http://localhost:8848").replace(/\/$/, "");
    this.serviceName = config.nacosServiceName ?? DEFAULT_SERVICE_NAME;
    this.namespace = config.nacosNamespace ?? "public";
    this.groupName = config.nacosGroupName ?? DEFAULT_GROUP;
    this.nodeId = nodeId;
    this.selfAddress = process.env.OPENCLAW_CLUSTER_ADDRESS ?? "127.0.0.1";
    this.selfPort = parseInt(process.env.OPENCLAW_CLUSTER_PORT ?? "18790", 10);
    this.refreshInterval = config.heartbeatInterval ?? DEFAULT_REFRESH_MS;
  }

  async start(): Promise<void> {
    console.log(
      `[openclaw-cluster] Nacos discovery started: ${this.baseUrl}, service=${this.serviceName}, nodeId=${this.nodeId}`
    );
    try {
      await this.registerSelf();
    } catch (err) {
      console.error("[openclaw-cluster] Nacos register failed:", (err as Error).message);
    }
    await this.refreshNodes();
    this.heartbeatTimer = setInterval(() => this.sendBeat().catch(() => {}), HEARTBEAT_INTERVAL_MS);
    this.refreshTimer = setInterval(
      () => this.refreshNodes().catch((e) => console.warn("[openclaw-cluster] Nacos refresh:", (e as Error).message)),
      this.refreshInterval
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    try {
      await this.deregisterSelf();
    } catch {
      // ignore
    }
    this.changeCallbacks = [];
    this.nodes = [];
    console.log("[openclaw-cluster] Nacos discovery stopped");
  }

  getNodes(): ClusterNodeInfo[] {
    return [...this.nodes];
  }

  onNodeChange(callback: (nodes: ClusterNodeInfo[]) => void): void {
    this.changeCallbacks.push(callback);
  }

  private async registerSelf(): Promise<void> {
    const params = new URLSearchParams({
      serviceName: this.serviceName,
      ip: this.selfAddress,
      port: String(this.selfPort),
      ephemeral: "true",
      namespaceId: this.namespace,
      groupName: this.groupName,
    });
    const res = await fetch(`${this.baseUrl}/nacos/v2/ns/instance`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = (await res.json()) as { code?: number };
    if (json.code !== 0) throw new Error(`Nacos register failed: ${JSON.stringify(json)}`);
    console.log(`[openclaw-cluster] Nacos instance registered: ${this.nodeId}`);
  }

  private async deregisterSelf(): Promise<void> {
    const params = new URLSearchParams({
      serviceName: this.serviceName,
      ip: this.selfAddress,
      port: String(this.selfPort),
      ephemeral: "true",
      namespaceId: this.namespace,
      groupName: this.groupName,
    });
    await fetch(`${this.baseUrl}/nacos/v2/ns/instance?${params}`, { method: "DELETE" });
  }

  private async sendBeat(): Promise<void> {
    if (this.stopped) return;
    const params = new URLSearchParams({
      serviceName: this.serviceName,
      ip: this.selfAddress,
      port: String(this.selfPort),
      namespaceId: this.namespace,
      groupName: this.groupName,
    });
    await fetch(`${this.baseUrl}/nacos/v1/ns/instance/beat`, {
      method: "PUT",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  }

  private async refreshNodes(): Promise<void> {
    if (this.stopped) return;
    const params = new URLSearchParams({
      serviceName: this.serviceName,
      healthyOnly: "true",
      namespaceId: this.namespace,
      groupName: this.groupName,
    });
    const res = await fetch(`${this.baseUrl}/nacos/v2/ns/instance/list?${params}`);
    const json = (await res.json()) as { code?: number; data?: NacosInstanceList };
    if (json.code !== 0) return;
    const hosts = json.data?.hosts ?? [];
    const newNodes: ClusterNodeInfo[] = hosts.map((h) => ({
      nodeId: `${h.ip ?? "0.0.0.0"}:${h.port ?? 18790}`,
      address: h.ip ?? "0.0.0.0",
      port: h.port ?? 18790,
      status: "online" as const,
      lastHeartbeat: new Date().toISOString(),
      activeSessions: 0,
      activeConnections: 0,
      joinedAt: new Date().toISOString(),
    }));
    const changed =
      newNodes.length !== this.nodes.length ||
      newNodes.some((n) => !this.nodes.find((e) => e.nodeId === n.nodeId));
    this.nodes = newNodes;
    if (changed) {
      for (const cb of this.changeCallbacks) try { cb(this.nodes); } catch { /* ignore */ }
    }
  }
}
