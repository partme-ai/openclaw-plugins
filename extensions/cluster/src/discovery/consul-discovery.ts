/**
 * Consul 节点发现实现
 *
 * 通过 HashiCorp Consul Agent HTTP API 实现服务注册与发现：
 * - 本节点向 Consul Agent 注册服务（带 TTL 健康检查）
 * - 定期发送 TTL pass 维持健康状态
 * - 轮询 /V1/health/service/<name>?passing 获取健康节点列表
 * - 停止时注销服务
 *
 * 适用于：多数据中心、与 Nomad/Vault 同栈、已有 Consul 基础设施的环境
 *
 * @see https://developer.hashicorp.com/consul/api-docs/agent/service
 * @see https://developer.hashicorp.com/consul/api-docs/health
 */

import type { ClusterNodeInfo, DiscoveryConfig, IDiscoveryService } from "../types.js";

/** 默认服务名 */
const DEFAULT_SERVICE_NAME = "openclaw-gateway";

/** 默认刷新间隔（毫秒） */
const DEFAULT_REFRESH_INTERVAL = 10_000;

/** TTL 检查间隔（毫秒），需小于 Consul Check TTL */
const TTL_PASS_INTERVAL = 7_000;

/** Consul 健康接口返回的单项结构 */
interface ConsulHealthEntry {
  Node?: { Node?: string; Address?: string };
  Service?: { Port?: number; ID?: string };
}

/**
 * Consul 节点发现服务
 *
 * 本节点会注册到 Consul，并定期刷新健康节点列表、通知变更
 */
export class ConsulDiscovery implements IDiscoveryService {
  /** Consul Agent 根地址（如 http://localhost:8500） */
  private readonly consulAddress: string;

  /** 服务名 */
  private readonly serviceName: string;

  /** 当前节点 ID（用作 Service.ID） */
  private readonly nodeId: string;

  /** 数据中心（可选） */
  private readonly datacenter: string | undefined;

  /** ACL Token（可选） */
  private readonly token: string | undefined;

  /** 刷新间隔 */
  private readonly refreshInterval: number;

  /** 本地注册地址（用于注册） */
  private readonly selfAddress: string;

  /** 本地端口（用于注册，通常为 proxy 或 gateway 端口） */
  private readonly selfPort: number;

  /** 已发现的节点列表 */
  private nodes: ClusterNodeInfo[] = [];

  /** 节点变更回调 */
  private changeCallbacks: Array<(nodes: ClusterNodeInfo[]) => void> = [];

  /** 刷新定时器 */
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  /** TTL pass 定时器 */
  private ttlPassTimer: ReturnType<typeof setInterval> | null = null;

  /** 是否已停止 */
  private stopped = false;

  constructor(config: DiscoveryConfig, nodeId: string) {
    this.consulAddress = (config.consulAddress ?? "http://localhost:8500").replace(/\/$/, "");
    this.serviceName = config.consulServiceName ?? DEFAULT_SERVICE_NAME;
    this.nodeId = nodeId;
    this.datacenter = config.consulDatacenter;
    this.token = config.consulToken;
    this.refreshInterval = config.heartbeatInterval ?? DEFAULT_REFRESH_INTERVAL;
    this.selfAddress = process.env.OPENCLAW_CLUSTER_ADDRESS ?? "127.0.0.1";
    this.selfPort = parseInt(process.env.OPENCLAW_CLUSTER_PORT ?? "18790", 10);
  }

  /**
   * 启动 Consul 发现服务
   * 注册本节点、启动 TTL 续期、启动节点列表轮询
   */
  async start(): Promise<void> {
    console.log(
      `[openclaw-cluster] Consul discovery started: ${this.consulAddress}, service=${this.serviceName}, nodeId=${this.nodeId}`
    );

    try {
      await this.registerSelf();
    } catch (err) {
      console.error("[openclaw-cluster] Consul register failed:", (err as Error).message);
    }

    await this.refreshNodes();

    this.ttlPassTimer = setInterval(() => {
      this.passTtlCheck().catch((e) =>
        console.warn("[openclaw-cluster] Consul TTL pass failed:", (e as Error).message)
      );
    }, TTL_PASS_INTERVAL);

    this.refreshTimer = setInterval(() => {
      this.refreshNodes().catch((e) =>
        console.warn("[openclaw-cluster] Consul refresh failed:", (e as Error).message)
      );
    }, this.refreshInterval);
  }

  /**
   * 停止发现服务：注销本节点、清除定时器
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.ttlPassTimer) {
      clearInterval(this.ttlPassTimer);
      this.ttlPassTimer = null;
    }
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    try {
      await this.deregisterSelf();
    } catch (err) {
      console.warn("[openclaw-cluster] Consul deregister failed:", (err as Error).message);
    }
    this.changeCallbacks = [];
    this.nodes = [];
    console.log("[openclaw-cluster] Consul discovery stopped");
  }

  getNodes(): ClusterNodeInfo[] {
    return [...this.nodes];
  }

  onNodeChange(callback: (nodes: ClusterNodeInfo[]) => void): void {
    this.changeCallbacks.push(callback);
  }

  /**
   * 向 Consul Agent 注册本节点服务
   */
  private async registerSelf(): Promise<void> {
    const payload = {
      ID: this.nodeId,
      Name: this.serviceName,
      Address: this.selfAddress,
      Port: this.selfPort,
      Check: {
        CheckID: `service:${this.nodeId}`,
        TTL: "15s",
        DeregisterCriticalServiceAfter: "30s",
      },
    };

    const url = `${this.consulAddress}/v1/agent/service/register`;
    await this.consulRequest(url, { method: "PUT", body: JSON.stringify(payload) });
    console.log(`[openclaw-cluster] Consul service registered: ${this.nodeId}`);
  }

  /**
   * 从 Consul Agent 注销本节点
   */
  private async deregisterSelf(): Promise<void> {
    const url = `${this.consulAddress}/v1/agent/service/deregister/${encodeURIComponent(this.nodeId)}`;
    await this.consulRequest(url, { method: "PUT" });
  }

  /**
   * 发送 TTL 通过，维持健康状态
   */
  private async passTtlCheck(): Promise<void> {
    if (this.stopped) return;
    const checkId = `service:${this.nodeId}`;
    const url = `${this.consulAddress}/v1/agent/check/pass/${encodeURIComponent(checkId)}`;
    await this.consulRequest(url, { method: "PUT" });
  }

  /**
   * 从 Consul 拉取健康服务列表并更新本地节点列表
   */
  private async refreshNodes(): Promise<void> {
    if (this.stopped) return;

    const params = new URLSearchParams({ passing: "true" });
    if (this.datacenter) params.set("dc", this.datacenter);
    const url = `${this.consulAddress}/v1/health/service/${encodeURIComponent(this.serviceName)}?${params}`;

    const list = (await this.consulRequest(url, { method: "GET" })) as ConsulHealthEntry[];

    const newNodes: ClusterNodeInfo[] = (list ?? []).map((e) => {
      const node = e.Node;
      const svc = e.Service;
      const address = node?.Address ?? "127.0.0.1";
      const port = svc?.Port ?? 18790;
      const nodeId = svc?.ID ?? node?.Node ?? `${address}:${port}`;
      return {
        nodeId,
        address,
        port,
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
      for (const cb of this.changeCallbacks) {
        try {
          cb(this.nodes);
        } catch {
          // 忽略回调异常
        }
      }
    }
  }

  /**
   * 发起 Consul HTTP 请求
   */
  private async consulRequest(
    url: string,
    options: { method: string; body?: string }
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) headers["X-Consul-Token"] = this.token;

    const res = await fetch(url, {
      method: options.method,
      headers,
      body: options.body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Consul HTTP ${res.status}: ${text}`);
    }

    const contentType = res.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      return res.json();
    }
    return res.text();
  }
}
