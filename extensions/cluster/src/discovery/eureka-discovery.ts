/**
 * Eureka 节点发现实现
 *
 * 通过 Netflix Eureka REST API 实现服务注册与发现（老版 Spring Cloud 常用）：
 * - 本节点注册到 Eureka，定期心跳
 * - 轮询 GET /eureka/v2/apps/{appName} 获取 UP 实例列表
 * - 停止时注销
 *
 * @see https://github.com/Netflix/eureka/wiki/Eureka-REST-operations
 */

import type { ClusterNodeInfo, DiscoveryConfig, IDiscoveryService } from "../types.js";

const DEFAULT_APP_NAME = "OPENCLAW-GATEWAY";
const DEFAULT_REFRESH_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Eureka 应用详情响应 */
interface EurekaAppResponse {
  application?: {
    instance?: Array<{
      instanceId?: string;
      hostName?: string;
      ipAddr?: string;
      port?: { $?: number } | number;
      status?: string;
    }>;
  };
}

export class EurekaDiscovery implements IDiscoveryService {
  private readonly baseUrl: string;
  private readonly appName: string;
  private readonly nodeId: string;
  private readonly selfAddress: string;
  private readonly selfPort: number;
  private readonly refreshInterval: number;
  private instanceId: string = "";
  private nodes: ClusterNodeInfo[] = [];
  private changeCallbacks: Array<(nodes: ClusterNodeInfo[]) => void> = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(config: DiscoveryConfig, nodeId: string) {
    this.baseUrl = (config.eurekaAddress ?? "http://localhost:8761/eureka").replace(/\/$/, "");
    this.appName = (config.eurekaAppName ?? DEFAULT_APP_NAME).toUpperCase();
    this.nodeId = nodeId;
    this.selfAddress = process.env.OPENCLAW_CLUSTER_ADDRESS ?? "127.0.0.1";
    this.selfPort = parseInt(process.env.OPENCLAW_CLUSTER_PORT ?? "18790", 10);
    this.refreshInterval = config.heartbeatInterval ?? DEFAULT_REFRESH_MS;
    this.instanceId = `${this.selfAddress}:${this.serviceId()}:${this.selfPort}`;
  }

  private serviceId(): string {
    return `${this.appName.toLowerCase()}:${this.selfPort}`;
  }

  async start(): Promise<void> {
    console.log(
      `[openclaw_cluster] Eureka discovery started: ${this.baseUrl}, app=${this.appName}, instanceId=${this.instanceId}`
    );
    try {
      await this.registerSelf();
    } catch (err) {
      console.error("[openclaw_cluster] Eureka register failed:", (err as Error).message);
    }
    await this.refreshNodes();
    this.heartbeatTimer = setInterval(
      () => this.heartbeat().catch((e) => console.warn("[openclaw_cluster] Eureka heartbeat:", (e as Error).message)),
      HEARTBEAT_INTERVAL_MS
    );
    this.refreshTimer = setInterval(
      () => this.refreshNodes().catch((e) => console.warn("[openclaw_cluster] Eureka refresh:", (e as Error).message)),
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
    console.log("[openclaw_cluster] Eureka discovery stopped");
  }

  getNodes(): ClusterNodeInfo[] {
    return [...this.nodes];
  }

  onNodeChange(callback: (nodes: ClusterNodeInfo[]) => void): void {
    this.changeCallbacks.push(callback);
  }

  private async registerSelf(): Promise<void> {
    const body = {
      instance: {
        instanceId: this.instanceId,
        hostName: this.selfAddress,
        app: this.appName,
        ipAddr: this.selfAddress,
        status: "UP",
        port: { $: this.selfPort },
        dataCenterInfo: { "@class": "com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo", name: "MyOwn" },
      },
    };
    const res = await fetch(`${this.baseUrl}/eureka/v2/apps/${this.appName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status !== 204 && res.status !== 200) {
      const text = await res.text();
      throw new Error(`Eureka register ${res.status}: ${text}`);
    }
    console.log(`[openclaw_cluster] Eureka instance registered: ${this.instanceId}`);
  }

  private async deregisterSelf(): Promise<void> {
    await fetch(`${this.baseUrl}/eureka/v2/apps/${this.appName}/${encodeURIComponent(this.instanceId)}`, {
      method: "DELETE",
    });
  }

  private async heartbeat(): Promise<void> {
    if (this.stopped) return;
    const res = await fetch(
      `${this.baseUrl}/eureka/v2/apps/${this.appName}/${encodeURIComponent(this.instanceId)}`,
      { method: "PUT" }
    );
    if (res.status === 404) await this.registerSelf();
  }

  private async refreshNodes(): Promise<void> {
    if (this.stopped) return;
    const res = await fetch(`${this.baseUrl}/eureka/v2/apps/${this.appName}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return;
    const json = (await res.json()) as EurekaAppResponse;
    const instances = json.application?.instance ?? [];
    const up = instances.filter((i) => (i.status ?? "").toUpperCase() === "UP");
    const newNodes: ClusterNodeInfo[] = up.map((i) => {
      const port = typeof i.port === "object" && i.port && "$" in i.port ? i.port.$ : Number(i.port);
      const addr = i.ipAddr ?? i.hostName ?? "0.0.0.0";
      const id = i.instanceId ?? `${addr}:${port}`;
      return {
        nodeId: id,
        address: addr,
        port: port || 18790,
        status: "online" as const,
        lastHeartbeat: new Date().toISOString(),
        activeSessions: 0,
        activeConnections: 0,
        joinedAt: new Date().toISOString(),
      };
    });
    const changed =
      newNodes.length !== this.nodes.length ||
      newNodes.some((n) => !this.nodes.find((e) => e.nodeId === n.nodeId));
    this.nodes = newNodes;
    if (changed) {
      for (const cb of this.changeCallbacks) try { cb(this.nodes); } catch { /* ignore */ }
    }
  }
}
