import { resolveConfigServerList } from "../config/spring-normalize.js";
import { DEFAULT_GROUP, DEFAULT_NAMESPACE } from "../shared/shared.js";
import type { NacosPluginConfig } from "../shared/types.js";

/**
 * First address from a comma-separated Nacos `serverList`.
 */
export function resolveServerAddr(serverList: string): string {
  const first = serverList.split(",")[0]?.trim();
  return first ?? serverList.trim();
}

/**
 * Resolves active profile for config file names.
 */
export function resolveProfile(pluginProfile: string | undefined, env: NodeJS.ProcessEnv): string {
  const p =
    pluginProfile?.trim() ||
    env.OPENCLAW_PROFILE?.trim() ||
    env.SPRING_PROFILES_ACTIVE?.trim() ||
    "default";
  return p;
}

/**
 * Replaces `${profile}` / `${spring.profiles.active}` in a dataId template.
 */
export function expandDataIdTemplate(template: string, profile: string): string {
  return template
    .replace(/\$\{spring\.profiles\.active\}/g, profile)
    .replace(/\$\{profile\}/g, profile);
}

export function resolveConfigNamespace(cfg: NacosPluginConfig): string {
  const ccNs = cfg.configCenter?.namespace?.trim();
  if (ccNs) {
    return ccNs;
  }
  return cfg.namespace?.trim() || DEFAULT_NAMESPACE;
}

export function resolveNamingNamespace(cfg: NacosPluginConfig): string {
  return cfg.namespace?.trim() || DEFAULT_NAMESPACE;
}

export function resolveGroupName(explicit?: string): string {
  return explicit?.trim() || DEFAULT_GROUP;
}

/**
 * Build options for {@link NacosConfigClient} from plugin config.
 */
export function buildNacosConfigClientOptions(cfg: NacosPluginConfig): Record<string, unknown> {
  const serverAddr = resolveServerAddr(resolveConfigServerList(cfg));
  const namespace = resolveConfigNamespace(cfg);
  const username = cfg.configCenter?.username ?? cfg.username;
  const password = cfg.configCenter?.password ?? cfg.password;
  const opts: Record<string, unknown> = {
    serverAddr,
    namespace,
    ssl: false,
  };
  if (username && password) {
    opts.username = username;
    opts.password = password;
  }
  return opts;
}
