/**
 * @fileoverview **mDNS/Bonjour 局域网发现**：零配置组播 DNS 广播与 PTR 查询发现同网段节点。
 *
 * @description 集群插件 **discovery 层** 后端，适用于边缘/开发局域网；响应 PTR 查询并周期性 probe。
 *
 * **关键依赖**
 * - 可选 `multicast-dns` npm 包 — 未安装时 `start()` 抛出明确错误。
 * - 环境变量 `OPENCLAW_CLUSTER_ADDRESS` / `OPENCLAW_CLUSTER_PORT`。
 *
 * @see https://github.com/mafintosh/multicast-dns
 */

import type { ClusterNodeInfo, DiscoveryConfig, IDiscoveryService } from "../shared/types.js";

/** @description 默认 mDNS 服务类型（PTR/SRV 查询名）。 */
const DEFAULT_SERVICE_TYPE = "_openclaw._tcp.local";

/** @description 主动 PTR 查询间隔（毫秒）。 */
const QUERY_INTERVAL_MS = 15_000;

/** @description `multicast-dns` 实例 duck-typing 形状。 */
type MdnsInstance = {
  on: (e: string, fn: (packet: MdnsPacket) => void) => void;
  removeListener?: (e: string, fn: (packet: MdnsPacket) => void) => void;
  query: (name: string, type: string) => void;
  respond: (packet: { answers: unknown[] }) => void;
  destroy: () => void;
} | null;

/**
 * @description 动态加载 `multicast-dns`；缺失时返回 `null`。
 *
 * @returns mdns 实例或 `null`。
 */
async function createMdns(): Promise<MdnsInstance> {
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const mdns = require("multicast-dns") as () => MdnsInstance;
    return mdns();
  } catch {
    return null;
  }
}

/**
 * @description 基于 mDNS 的局域网成员发现。
 *
 * @implements {IDiscoveryService}
 */
export class MdnsDiscovery implements IDiscoveryService {
  private readonly serviceType: string;
  private readonly nodeId: string;
  private readonly selfAddress: string;
  private readonly selfPort: number;
  private instanceName: string = "";
  private mdns: MdnsInstance = null;
  private nodes: ClusterNodeInfo[] = [];
  private changeCallbacks: Array<(nodes: ClusterNodeInfo[]) => void> = [];
  private queryTimer: ReturnType<typeof setInterval> | null = null;
  private responseHandler: ((packet: MdnsPacket) => void) | null = null;
  private stopped = false;

  /** 已知节点：instanceName -> { address, port }，用于去重与更新 */
  private readonly nodeMap = new Map<string, { address: string; port: number }>();

  constructor(config: DiscoveryConfig, nodeId: string) {
    this.serviceType = config.mdnsServiceType ?? DEFAULT_SERVICE_TYPE;
    this.nodeId = nodeId;
    this.selfAddress = process.env.OPENCLAW_CLUSTER_ADDRESS ?? "127.0.0.1";
    this.selfPort = parseInt(process.env.OPENCLAW_CLUSTER_PORT ?? "18790", 10);
    this.instanceName = `openclaw-${nodeId.replace(/\./g, "-")}.${this.serviceType}`;
  }

  /**
   * @description 启动 mdns、注册 query/respond 处理器并开始周期性 PTR 查询。
   *
   * @returns mdns 就绪后 resolve。
   * @throws {Error} 未安装 `multicast-dns` 依赖。
   */
  async start(): Promise<void> {
    this.mdns = await createMdns();
    if (!this.mdns) {
      throw new Error(
        "[openclaw-cluster] mDNS discovery requires optional dependency 'multicast-dns'. Run: pnpm add multicast-dns"
      );
    }

    this.responseHandler = (packet: MdnsPacket) => this.onResponse(packet);
    this.mdns.on("response", this.responseHandler);

    this.mdns.on("query", (packet: MdnsPacket) => {
      const q = packet.questions?.[0];
      if (!q || q.name !== this.serviceType) return;
      this.mdns!.respond({
        answers: [
          { name: this.serviceType, type: "PTR", ttl: 120, data: this.instanceName },
          {
            name: this.instanceName,
            type: "SRV",
            ttl: 120,
            data: { port: this.selfPort, weight: 0, priority: 10, target: this.selfAddress },
          },
          { name: this.selfAddress, type: "A", ttl: 120, data: this.selfAddress },
        ],
      });
    });

    console.log(
      `[openclaw-cluster] mDNS discovery started: type=${this.serviceType}, instance=${this.instanceName}`
    );

    this.sendQuery();
    this.queryTimer = setInterval(() => this.sendQuery(), QUERY_INTERVAL_MS);
  }

  /**
   * @description 销毁 mdns 实例并清空节点映射。
   *
   * @returns 解析即完成的 Promise。
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.queryTimer) clearInterval(this.queryTimer);
    if (this.mdns) {
      if (this.responseHandler) this.mdns.removeListener?.("response", this.responseHandler);
      this.mdns.destroy();
      this.mdns = null;
    }
    this.changeCallbacks = [];
    this.nodes = [];
    this.nodeMap.clear();
    console.log("[openclaw-cluster] mDNS discovery stopped");
  }

  getNodes(): ClusterNodeInfo[] {
    return [...this.nodes];
  }

  onNodeChange(callback: (nodes: ClusterNodeInfo[]) => void): void {
    this.changeCallbacks.push(callback);
  }

  private sendQuery(): void {
    if (this.stopped || !this.mdns) return;
    this.mdns.query(this.serviceType, "PTR");
  }

  private onResponse(packet: MdnsPacket): void {
    const answers = packet.answers ?? [];
    const additionals = packet.additionals ?? [];
    const all = [...answers, ...additionals];

    const ptrs = all.filter((r) => r.type === "PTR" && r.name === this.serviceType);
    const srvByName = new Map<string, { port: number; target: string }>();
    const aByHost = new Map<string, string>();

    for (const r of all) {
      if (r.type === "SRV" && r.data && typeof r.data === "object" && "port" in r.data) {
        const d = r.data as { port: number; target?: string };
        srvByName.set(r.name, { port: d.port, target: d.target ?? r.name });
      }
      if (r.type === "A" && typeof r.data === "string") aByHost.set(r.name, r.data);
    }

    for (const ptr of ptrs) {
      const instanceName = typeof ptr.data === "string" ? ptr.data : "";
      if (!instanceName || instanceName === this.instanceName) continue;
      const srv = srvByName.get(instanceName);
      if (!srv) continue;
      const address = aByHost.get(srv.target) ?? srv.target;
      const port = srv.port ?? 18790;
      this.nodeMap.set(instanceName, { address, port });
    }

    const newNodes: ClusterNodeInfo[] = [];
    for (const [name, { address, port }] of this.nodeMap) {
      newNodes.push({
        nodeId: name,
        address,
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

/** @description multicast-dns 响应 packet 结构（questions/answers/additionals）。 */
interface MdnsPacket {
  questions?: Array<{ name: string; type: string }>;
  answers?: MdnsRecord[];
  additionals?: MdnsRecord[];
}

interface MdnsRecord {
  name: string;
  type: string;
  ttl?: number;
  data?: string | { port?: number; target?: string; weight?: number; priority?: number };
}
