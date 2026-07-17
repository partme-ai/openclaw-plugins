/**
 * @module runtime/nacos-cluster
 *
 * 基于 Nacos 命名订阅的 Webhook 集群发现：维护 peer 列表并排除自身实例。
 */

import { NacosNamingClient } from "nacos";
import { resolveNamingServerList } from "../config/spring-normalize.js";
import { resolveRegisterIp } from "../config/resolve-endpoint.js";
import type { ClusterPeer, NacosPluginConfig, PluginLog } from "../shared/types.js";
import { createNacosSdkLogger, DEFAULT_GROUP, DEFAULT_NAMESPACE, DEFAULT_SERVICE, tryCloseNacosClient } from "../shared/shared.js";

export type ClusterServiceState = {
  peers: ClusterPeer[];
  lastUpdated: number;
};

/**
 * Discovers peer nodes in the webhook cluster by subscribing to Nacos naming service.
 * Maintains an in-memory peer list that updates automatically on instance changes.
 */
export class WebhookClusterService {
  private client: NacosNamingClient | null = null;
  private peers: ClusterPeer[] = [];
  private lastUpdated = 0;
  private selfIp: string | null = null;
  private selfPort: number | null = null;
  private unsubscribeFn: (() => Promise<void>) | null = null;

  /**
   * Returns the current list of discovered peer nodes (excluding self).
   */
  getPeers(): ClusterPeer[] {
    return this.peers;
  }

  /**
   * Returns the full cluster state including metadata.
   */
  getState(): ClusterServiceState {
    return {
      peers: this.peers,
      lastUpdated: this.lastUpdated,
    };
  }

  /**
   * Starts cluster discovery: creates a Naming client and subscribes to service changes.
   */
  async start(params: {
    pluginConfig: NacosPluginConfig;
    selfPort: number;
    logger: PluginLog;
  }): Promise<void> {
    const { pluginConfig, selfPort, logger } = params;
    const serverList = resolveNamingServerList(pluginConfig);
    const namespace = pluginConfig.namespace?.trim() || DEFAULT_NAMESPACE;
    const serviceName = pluginConfig.serviceName?.trim() || DEFAULT_SERVICE;
    const groupName = pluginConfig.groupName?.trim() || DEFAULT_GROUP;

    this.selfPort = selfPort;
    this.selfIp = resolveRegisterIp({
      configIp: pluginConfig.registerIp,
      warn: (m) => logger.warn(m),
    });

    const client = new NacosNamingClient({
      logger: createNacosSdkLogger(logger),
      serverList,
      namespace,
      ...(pluginConfig.username && pluginConfig.password
        ? { username: pluginConfig.username, password: pluginConfig.password }
        : {}),
    });

    // 先保存引用，后续 ready/subscribe/initial fetch 任一步失败都可由 stop 统一回收。
    this.client = client;

    const updatePeers = (hosts: unknown) => {
      if (!Array.isArray(hosts)) {
        logger.warn("[openclaw-nacos] ignored invalid cluster update: hosts is not an array");
        return;
      }
      this.peers = hosts
        .filter((host): host is { ip: string; port: number; weight?: number; healthy?: boolean; metadata?: Record<string, string>; clusterName?: string } => {
          if (!host || typeof host !== "object") return false;
          const candidate = host as { ip?: unknown; port?: unknown };
          return typeof candidate.ip === "string" && candidate.ip.length > 0 &&
            typeof candidate.port === "number" && Number.isInteger(candidate.port) &&
            candidate.port > 0 && candidate.port <= 65_535;
        })
        // 防御异常注册表或恶意服务端响应，诊断端点和进程内状态都保持有界。
        .slice(0, 1_000)
        .filter((h) => !(h.ip === this.selfIp && h.port === this.selfPort))
        .map((h) => ({
          ip: h.ip,
          port: h.port,
          serviceName,
          groupName,
          clusterName: h.clusterName,
          weight: typeof h.weight === "number" ? h.weight : 1,
          healthy: h.healthy !== false,
          metadata: h.metadata ?? {},
        }));
      this.lastUpdated = Date.now();
      logger.debug(
        `[openclaw-nacos] cluster peers updated: ${this.peers.length} peer(s)`,
      );
    };

    try {
      await client.ready();
      const clusters = pluginConfig.clusterName?.trim() || undefined;
      const subscription = { serviceName, groupName, clusters };
      const listener = (hosts: unknown) => updatePeers(hosts);
      await Promise.resolve(client.subscribe(subscription, listener));
      this.unsubscribeFn = async () => {
        await Promise.resolve(client.unSubscribe(subscription, listener));
      };

      // Initial fetch
      const initialHosts = await client.getAllInstances(serviceName, groupName, pluginConfig.clusterName?.trim() || undefined, false);
      if (initialHosts && Array.isArray(initialHosts)) {
        updatePeers(initialHosts);
      }

      logger.info(
        `[openclaw-nacos] cluster discovery started for ${serviceName} (${groupName}, ns=${namespace})`,
      );
    } catch (err) {
      logger.error(`[openclaw-nacos] cluster discovery failed: ${String(err)}`);
      await this.stop(logger);
      throw err;
    }
  }

  /**
   * Stops cluster discovery and releases the client.
   */
  async stop(logger: PluginLog): Promise<void> {
    if (this.unsubscribeFn) {
      try {
        await this.unsubscribeFn();
      } catch (error) {
        logger.warn(`[openclaw-nacos] cluster unsubscribe failed: ${String(error)}`);
      }
      this.unsubscribeFn = null;
    }
    const c = this.client;
    this.client = null;
    this.peers = [];
    this.lastUpdated = 0;
    await tryCloseNacosClient(c, logger, "cluster");
  }
}
