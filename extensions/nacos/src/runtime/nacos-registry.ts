/**
 * @module runtime/nacos-registry
 *
 * Gateway 实例 Nacos 命名服务注册：解析端口/IP、写入 Hooks 元数据、生命周期 deregister。
 */

import { NacosNamingClient } from "nacos";
import { resolveNamingServerList } from "../config/spring-normalize.js";
import type { OpenClawConfigSlice, NacosPluginConfig, PluginLog } from "../shared/types.js";
import { resolveGatewayPort, resolveHooksInfo, resolveRegisterIp } from "../config/resolve-endpoint.js";
import { createNacosSdkLogger, DEFAULT_GROUP, DEFAULT_NAMESPACE, DEFAULT_SERVICE } from "../shared/shared.js";

export type NamingRegistryState = {
  serviceName: string;
  groupName: string;
  ip: string;
  port: number;
};

/**
 * Builds instance metadata for Nacos (hooks path, gateway port, user metadata).
 */
export function buildInstanceMetadata(params: {
  cfg: OpenClawConfigSlice;
  plugin: NacosPluginConfig;
  port: number;
}): Record<string, string> {
  const { hooksEnabled, hooksBasePath } = resolveHooksInfo(params.cfg);
  const base: Record<string, string> = {
    hooksEnabled: hooksEnabled ? "true" : "false",
    hooksBasePath,
    gatewayPort: String(params.port),
    provider: "openclaw-nacos",
  };
  const extra = params.plugin.metadata ?? {};
  return { ...base, ...extra };
}

export class GatewayNacosRegistry {
  private client: NacosNamingClient | null = null;
  private state: NamingRegistryState | null = null;

  /**
   * Registers the current Gateway instance with Nacos.
   */
  async register(params: {
    pluginConfig: NacosPluginConfig;
    openClawConfig: OpenClawConfigSlice;
    logger: PluginLog;
  }): Promise<void> {
    const { pluginConfig, openClawConfig, logger } = params;
    const port = resolveGatewayPort(openClawConfig);
    const ip = resolveRegisterIp({
      configIp: pluginConfig.registerIp,
      warn: (m) => logger.warn(m),
    });
    const serviceName = pluginConfig.serviceName?.trim() || DEFAULT_SERVICE;
    const groupName = pluginConfig.groupName?.trim() || DEFAULT_GROUP;
    const namespace = pluginConfig.namespace?.trim() || DEFAULT_NAMESPACE;
    const ephemeral = pluginConfig.ephemeral !== false;
    const weight = typeof pluginConfig.weight === "number" ? pluginConfig.weight : 1;
    const clusterName = pluginConfig.clusterName?.trim() || undefined;

    const metadata = buildInstanceMetadata({
      cfg: openClawConfig,
      plugin: pluginConfig,
      port,
    });

    const client = new NacosNamingClient({
      logger: createNacosSdkLogger(logger),
      serverList: resolveNamingServerList(pluginConfig),
      namespace,
      ...(pluginConfig.username && pluginConfig.password
        ? { username: pluginConfig.username, password: pluginConfig.password }
        : {}),
    });

    await client.ready();

    /** SDK runtime accepts plain objects; upstream `.d.ts` is incomplete for `metadata`. */
    const instancePayload = {
      ip,
      port,
      ephemeral,
      weight,
      ...(clusterName ? { clusterName } : {}),
      metadata,
    };
    await client.registerInstance(serviceName, instancePayload as never, groupName);

    this.client = client;
    this.state = { serviceName, groupName, ip, port };
    logger.info(
      `[openclaw-nacos] Registered instance ${ip}:${port} as ${serviceName} (${groupName}, ns=${namespace})`,
    );
  }

  /**
   * Deregisters the instance and releases the client reference.
   */
  async stop(logger: PluginLog): Promise<void> {
    const client = this.client;
    const state = this.state;
    this.client = null;
    this.state = null;
    if (!client || !state) {
      return;
    }
    try {
      await client.deregisterInstance(state.serviceName, { ip: state.ip, port: state.port } as never, state.groupName);
      logger.info(`[openclaw-nacos] Deregistered ${state.ip}:${state.port} from ${state.serviceName}`);
    } catch (err) {
      logger.warn(`[openclaw-nacos] Deregister failed: ${String(err)}`);
    }
  }
}
