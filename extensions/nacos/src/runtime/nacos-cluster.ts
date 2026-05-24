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
  private unsubscribeFn: (() => void) | null = null;

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

    await client.ready();

    const updatePeers = (hosts: Array<{ ip: string; port: number; weight?: number; healthy?: boolean; metadata?: Record<string, string>; clusterName?: string }>) => {
      this.peers = hosts
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
      client.subscribe(
        { serviceName, groupName, clusters: pluginConfig.clusterName?.trim() || undefined },
        (hosts: unknown) => {
          updatePeers(hosts as Array<{ ip: string; port: number; weight?: number; healthy?: boolean; metadata?: Record<string, string>; clusterName?: string }>);
        },
      );
      this.unsubscribeFn = () => {
        try {
          client.unSubscribe({ serviceName, groupName }, undefined as never);
        } catch {
          /* ignore */
        }
      };

      // Initial fetch
      const initialHosts = await client.getAllInstances(serviceName, groupName, pluginConfig.clusterName?.trim() || undefined, false);
      if (initialHosts && Array.isArray(initialHosts)) {
        updatePeers(initialHosts as Array<{ ip: string; port: number; weight?: number; healthy?: boolean; metadata?: Record<string, string>; clusterName?: string }>);
      }

      this.client = client;
      logger.info(
        `[openclaw-nacos] cluster discovery started for ${serviceName} (${groupName}, ns=${namespace})`,
      );
    } catch (err) {
      logger.error(`[openclaw-nacos] cluster discovery failed: ${String(err)}`);
      throw err;
    }
  }

  /**
   * Stops cluster discovery and releases the client.
   */
  async stop(logger: PluginLog): Promise<void> {
    if (this.unsubscribeFn) {
      try {
        this.unsubscribeFn();
      } catch {
        /* ignore */
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
