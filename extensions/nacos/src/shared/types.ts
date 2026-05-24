/** Minimal logger surface used by this plugin (matches OpenClaw PluginLogger). */
export type PluginLog = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
};

/**
 * @module nacos/shared/types
 *
 * Subset of OpenClaw config used for Gateway port and Hooks path resolution.
 */
export type OpenClawConfigSlice = {
  gateway?: { port?: number };
  hooks?: { enabled?: boolean; path?: string };
};

/** One Nacos Config shared entry (Spring `shared-configs` style). */
export type NacosSharedConfigItem = {
  dataId: string;
  /** Defaults to `DEFAULT_GROUP`. */
  group?: string;
  /** When true, subscribe for changes. Default true. */
  refresh?: boolean;
};

/**
 * Nacos Config Center: pull + merge + optional subscribe.
 */
export type NacosConfigCenterConfig = {
  /** When true, load and merge remote config. Default false. */
  enabled?: boolean;
  /**
   * Config namespace (tenant). Overrides top-level `namespace` for Config only.
   */
  namespace?: string;
  /** Username for Nacos auth (optional). */
  username?: string;
  /** Password for Nacos auth (optional). */
  password?: string;
  /**
   * Primary Nacos dataId that holds the COMPLETE openclaw.json.
   * When set, this config replaces the base snapshot (sharedConfigs/pluginConfigIds
   * are still deep-merged on top). When unset, the current runtime config is the base.
   */
  primaryConfigDataId?: string;
  /**
   * Group for primaryConfigDataId. Default: `DEFAULT_GROUP`.
   */
  primaryConfigGroup?: string;
  /** Ordered list; each item merged in order with deep merge. */
  sharedConfigs?: NacosSharedConfigItem[];
  /**
   * Optional main application dataId (e.g. `application-dev.json`).
   * Resolved literally; use `${profile}` in the string if desired (caller replaces).
   */
  applicationDataId?: string;
  /**
   * Profile for `application-${profile}.*` and per-plugin `${pluginId}-${profile}.json`.
   * Defaults: `OPENCLAW_PROFILE` / `SPRING_PROFILES_ACTIVE` / `default`.
   */
  profile?: string;
  /** Plugin IDs to fetch `dataId = {pluginId}-{profile}.json` into `plugins.entries[id].config`. */
  pluginConfigIds?: string[];
  /** Skip structural validation before write (dangerous). Default false. */
  skipValidation?: boolean;
};

/** Naming registration can be disabled while keeping Config Center. */
export type NacosNamingOptions = {
  enabled?: boolean;
};

/** A discovered peer node in the webhook cluster. */
export type ClusterPeer = {
  ip: string;
  port: number;
  serviceName: string;
  groupName: string;
  clusterName?: string;
  weight: number;
  healthy: boolean;
  metadata: Record<string, string>;
};

/** Cluster discovery configuration. */
export type ClusterDiscoveryConfig = {
  /** When false, skip cluster discovery. Default true (when naming is active). */
  enabled?: boolean;
};

/**
 * Plugin-owned configuration under `plugins.entries["openclaw-nacos"].config`.
 */
export type NacosPluginConfig = {
  /** When false, skip entire plugin. Default true. */
  enabled?: boolean;
  /** Nacos server list, e.g. `127.0.0.1:8848`. */
  serverList: string;
  /**
   * Optional separate address list for Naming; defaults to {@link serverList}.
   * Spring: `nacos.discovery.server-addr`.
   */
  namingServerList?: string;
  /**
   * Optional separate address list for Config client; defaults to {@link serverList}.
   * Spring: `nacos.config.server-addr`.
   */
  configServerList?: string;
  /** Namespace for Naming (and Config default if configCenter.namespace unset). */
  namespace?: string;
  /** Nacos username (optional; applies to Naming + Config when set). */
  username?: string;
  /** Nacos password (optional). */
  password?: string;
  /** Service name in Nacos. Default `openclaw-gateway`. */
  serviceName?: string;
  /** Group name. Default `DEFAULT_GROUP`. */
  groupName?: string;
  /** Optional cluster name on the instance. */
  clusterName?: string;
  /** Load-balancing weight. Default 1. */
  weight?: number;
  /** Ephemeral instance. Default true. */
  ephemeral?: boolean;
  /** Explicit IP to register; overrides env. */
  registerIp?: string;
  /** Extra metadata merged with built-in keys (hooks, gateway port). */
  metadata?: Record<string, string>;
  /** Disable only naming registration. Default true. */
  naming?: NacosNamingOptions;
  /** Nacos Config Center integration. */
  configCenter?: NacosConfigCenterConfig;
  /** Cluster discovery settings. */
  clusterDiscovery?: ClusterDiscoveryConfig;
};
