/**
 * Maps Spring Cloud / application.yml style `nacos` blocks into the flat
 * {@link NacosPluginConfig} shape consumed by {@link parseNacosPluginConfig}.
 *
 * Top-level keys on the plugin config win over nested `nacos.*` when both are set.
 */

import { deepMerge } from "./merge-deep.js";
import { isPlainObject } from "../shared/shared.js";
import type { NacosConfigCenterConfig, NacosPluginConfig, NacosSharedConfigItem } from "../shared/types.js";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/**
 * Reads Spring-style `server-addr` or camelCase `serverAddr`.
 */
function serverAddrFrom(obj: Record<string, unknown>): string | undefined {
  return str(obj["server-addr"]) ?? str(obj.serverAddr);
}

/**
 * Parses `shared-configs` or `sharedConfigs` array; supports `data-id` or `dataId`.
 */
function parseSharedConfigsSpring(raw: unknown): NacosSharedConfigItem[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const out: NacosSharedConfigItem[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) {
      continue;
    }
    const dataId = str(item.dataId) ?? str(item["data-id"]);
    if (!dataId) {
      continue;
    }
    const group = str(item.group);
    out.push({
      dataId,
      ...(group ? { group } : {}),
      ...(item.refresh === false ? { refresh: false } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Merges Spring `nacos.config` subtree into a partial {@link NacosConfigCenterConfig}.
 */
function configCenterFromSpringNacosConfig(
  config: Record<string, unknown>,
): Partial<NacosConfigCenterConfig> | undefined {
  const shared =
    parseSharedConfigsSpring(config["shared-configs"]) ??
    parseSharedConfigsSpring(config.sharedConfigs);
  const pluginConfigIds = Array.isArray(config.pluginConfigIds)
    ? config.pluginConfigIds.filter((id): id is string => typeof id === "string" && id.trim() !== "").map((id) => id.trim())
    : undefined;

  const partial: Partial<NacosConfigCenterConfig> = {
    ...(config.enabled === true ? { enabled: true } : {}),
    ...(config.enabled === false ? { enabled: false } : {}),
    ...(str(config.namespace) ? { namespace: str(config.namespace)! } : {}),
    ...(str(config.username) ? { username: str(config.username)! } : {}),
    ...(str(config.password) ? { password: str(config.password)! } : {}),
    ...(str(config.primaryConfigDataId) ? { primaryConfigDataId: str(config.primaryConfigDataId)! } : {}),
    ...(str(config.primaryConfigGroup) ? { primaryConfigGroup: str(config.primaryConfigGroup)! } : {}),
    ...(shared ? { sharedConfigs: shared } : {}),
    ...(str(config.applicationDataId) ? { applicationDataId: str(config.applicationDataId)! } : {}),
    ...(str(config.profile) ? { profile: str(config.profile)! } : {}),
    ...(pluginConfigIds && pluginConfigIds.length > 0 ? { pluginConfigIds } : {}),
    ...(config.skipValidation === true ? { skipValidation: true } : {}),
  };

  const hasWork =
    partial.enabled === true ||
    !!partial.primaryConfigDataId ||
    !!shared ||
    !!partial.applicationDataId ||
    (pluginConfigIds && pluginConfigIds.length > 0) ||
    partial.enabled === false ||
    !!str(config.namespace);

  return Object.keys(partial).length > 0 && hasWork ? partial : undefined;
}

/**
 * If the plugin config uses a nested `nacos` object (Spring style), flattens it into
 * `serverList`, optional `namingServerList` / `configServerList`, `namespace`, and `configCenter`.
 * Existing top-level fields take precedence.
 *
 * @param raw - Parsed plugin entry config object
 * @returns A new object safe to pass to {@link parseNacosPluginConfig} (without mutating input)
 */
export function flattenSpringNacosPluginConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const nacos = raw.nacos;
  if (!isPlainObject(nacos)) {
    return { ...raw };
  }

  const out: Record<string, unknown> = { ...raw };
  delete out.nacos;

  const assignIfAbsent = (key: string, value: unknown) => {
    if (out[key] !== undefined && out[key] !== null && out[key] !== "") {
      return;
    }
    if (value !== undefined && value !== null && value !== "") {
      out[key] = value;
    }
  };

  assignIfAbsent("serverList", serverAddrFrom(nacos) ?? str(nacos.serverList));
  assignIfAbsent("username", str(nacos.username));
  assignIfAbsent("password", str(nacos.password));

  const discovery = isPlainObject(nacos.discovery) ? nacos.discovery : undefined;
  if (discovery) {
    const dAddr = serverAddrFrom(discovery) ?? str(discovery.serverList);
    assignIfAbsent("namingServerList", dAddr);
    assignIfAbsent("serverList", dAddr);
    assignIfAbsent("namespace", str(discovery.namespace));
    assignIfAbsent("username", str(discovery.username));
    assignIfAbsent("password", str(discovery.password));
  }

  const config = isPlainObject(nacos.config) ? nacos.config : undefined;
  if (config) {
    assignIfAbsent("configServerList", serverAddrFrom(config) ?? str(config.serverList));
    const ccSpring = configCenterFromSpringNacosConfig(config);
    const existingCc = isPlainObject(out.configCenter) ? (out.configCenter as Record<string, unknown>) : undefined;
    if (ccSpring) {
      out.configCenter = existingCc
        ? deepMerge(ccSpring as Record<string, unknown>, existingCc)
        : ccSpring;
    }
    assignIfAbsent("username", str(config.username));
    assignIfAbsent("password", str(config.password));
  }

  return out;
}

/**
 * Expands a parsed {@link NacosPluginConfig} with optional split server lists
 * into resolved connection strings (defaults to {@link NacosPluginConfig.serverList}).
 */
export function resolveNamingServerList(cfg: NacosPluginConfig): string {
  return cfg.namingServerList?.trim() || cfg.serverList;
}

/**
 * Resolves the server list used by {@link NacosConfigClient}.
 */
export function resolveConfigServerList(cfg: NacosPluginConfig): string {
  return cfg.configServerList?.trim() || cfg.serverList;
}
