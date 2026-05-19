import { flattenSpringNacosPluginConfig } from "./spring-normalize.js";
import type {
  NacosConfigCenterConfig,
  NacosPluginConfig,
  NacosSharedConfigItem,
} from "./types.js";
import { isPlainObject } from "./shared.js";

export type ParsePluginConfigResult =
  | { kind: "skip"; reason: string }
  | { kind: "disabled" }
  | { kind: "ok"; config: NacosPluginConfig }
  | { kind: "error"; message: string };

function parseSharedConfigs(raw: unknown): NacosSharedConfigItem[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const out: NacosSharedConfigItem[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) {
      continue;
    }
    const dataId =
      typeof item.dataId === "string"
        ? item.dataId.trim()
        : typeof item["data-id"] === "string"
          ? item["data-id"].trim()
          : "";
    if (!dataId) {
      continue;
    }
    out.push({
      dataId,
      ...(typeof item.group === "string" && item.group.trim() !== ""
        ? { group: item.group.trim() }
        : {}),
      ...(item.refresh === false ? { refresh: false } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

function parseConfigCenter(raw: unknown): NacosConfigCenterConfig | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!isPlainObject(raw)) {
    return undefined;
  }
  const sharedConfigs =
    parseSharedConfigs(raw.sharedConfigs) ?? parseSharedConfigs(raw["shared-configs"]);
  const pluginConfigIds = Array.isArray(raw.pluginConfigIds)
    ? raw.pluginConfigIds.filter((id): id is string => typeof id === "string" && id.trim() !== "").map((id) => id.trim())
    : undefined;

  const cc: NacosConfigCenterConfig = {
    ...(raw.enabled === true ? { enabled: true } : {}),
    ...(raw.enabled === false ? { enabled: false } : {}),
    ...(typeof raw.namespace === "string" && raw.namespace.trim() !== ""
      ? { namespace: raw.namespace.trim() }
      : {}),
    ...(typeof raw.username === "string" ? { username: raw.username } : {}),
    ...(typeof raw.password === "string" ? { password: raw.password } : {}),
    ...(typeof raw.primaryConfigDataId === "string" && raw.primaryConfigDataId.trim() !== ""
      ? { primaryConfigDataId: raw.primaryConfigDataId.trim() }
      : {}),
    ...(typeof raw.primaryConfigGroup === "string" && raw.primaryConfigGroup.trim() !== ""
      ? { primaryConfigGroup: raw.primaryConfigGroup.trim() }
      : {}),
    ...(sharedConfigs ? { sharedConfigs } : {}),
    ...(typeof raw.applicationDataId === "string" && raw.applicationDataId.trim() !== ""
      ? { applicationDataId: raw.applicationDataId.trim() }
      : {}),
    ...(typeof raw.profile === "string" && raw.profile.trim() !== ""
      ? { profile: raw.profile.trim() }
      : {}),
    ...(pluginConfigIds && pluginConfigIds.length > 0 ? { pluginConfigIds } : {}),
    ...(raw.skipValidation === true ? { skipValidation: true } : {}),
  };

  const hasWork =
    cc.enabled === true ||
    !!cc.primaryConfigDataId ||
    sharedConfigs ||
    cc.applicationDataId ||
    (pluginConfigIds && pluginConfigIds.length > 0);
  if (!hasWork && cc.enabled !== false) {
    return undefined;
  }
  return cc;
}

/**
 * Normalizes `plugins.entries["openclaw-nacos"].config` into a {@link NacosPluginConfig}.
 */
export function parseNacosPluginConfig(raw: unknown): ParsePluginConfigResult {
  if (raw === undefined || raw === null) {
    return { kind: "skip", reason: "no plugin config" };
  }
  if (!isPlainObject(raw)) {
    return { kind: "error", message: "plugin config must be an object" };
  }
  const flat = flattenSpringNacosPluginConfig(raw);
  if (flat.enabled === false) {
    return { kind: "disabled" };
  }
  const serverList = typeof flat.serverList === "string" ? flat.serverList.trim() : "";
  if (!serverList) {
    return {
      kind: "skip",
      reason: "serverList not configured; Nacos plugin disabled",
    };
  }

  const metadata =
    isPlainObject(flat.metadata) && flat.metadata !== null
      ? Object.fromEntries(
          Object.entries(flat.metadata).filter(
            (e): e is [string, string] => typeof e[1] === "string",
          ),
        )
      : undefined;

  const namingRaw = isPlainObject(flat.naming) ? flat.naming : undefined;
  const configCenter = parseConfigCenter(flat.configCenter);

  const namingServerList =
    typeof flat.namingServerList === "string" && flat.namingServerList.trim() !== ""
      ? flat.namingServerList.trim()
      : undefined;
  const configServerList =
    typeof flat.configServerList === "string" && flat.configServerList.trim() !== ""
      ? flat.configServerList.trim()
      : undefined;

  const config: NacosPluginConfig = {
    enabled: flat.enabled !== false,
    serverList,
    ...(namingServerList ? { namingServerList } : {}),
    ...(configServerList ? { configServerList } : {}),
    ...(typeof flat.namespace === "string" && flat.namespace.trim() !== ""
      ? { namespace: flat.namespace.trim() }
      : {}),
    ...(typeof flat.username === "string" && flat.username !== "" ? { username: flat.username } : {}),
    ...(typeof flat.password === "string" && flat.password !== "" ? { password: flat.password } : {}),
    ...(typeof flat.serviceName === "string" && flat.serviceName.trim() !== ""
      ? { serviceName: flat.serviceName.trim() }
      : {}),
    ...(typeof flat.groupName === "string" && flat.groupName.trim() !== ""
      ? { groupName: flat.groupName.trim() }
      : {}),
    ...(typeof flat.clusterName === "string" && flat.clusterName.trim() !== ""
      ? { clusterName: flat.clusterName.trim() }
      : {}),
    ...(typeof flat.weight === "number" && Number.isFinite(flat.weight) ? { weight: flat.weight } : {}),
    ...(flat.ephemeral === false ? { ephemeral: false } : {}),
    ...(typeof flat.registerIp === "string" && flat.registerIp.trim() !== ""
      ? { registerIp: flat.registerIp.trim() }
      : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(namingRaw && namingRaw.enabled === false ? { naming: { enabled: false } } : {}),
    ...(configCenter ? { configCenter } : {}),
  };

  return { kind: "ok", config };
}
