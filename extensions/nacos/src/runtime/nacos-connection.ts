/**
 * @module runtime/nacos-connection
 *
 * Nacos Config / Naming 客户端连接参数解析：serverAddr、namespace、profile、dataId 模板。
 */

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

/**
 * Config Center 使用的 namespace（优先 configCenter.namespace，否则顶层 namespace）。
 *
 * @param cfg - 已解析的 Nacos 插件配置
 * @returns Nacos tenant / namespace id
 */
export function resolveConfigNamespace(cfg: NacosPluginConfig): string {
  const configured = cfg.configCenter?.namespace?.trim() || cfg.namespace?.trim();
  // Nacos 控制台显示的 `public` 是默认命名空间名称，但 Config OpenAPI/SDK 使用的
  // tenant id 是空字符串。把字面量 public 直接发给 Config API 会落到一个不存在的
  // tenant，表现为发布成功而客户端始终拉取为空。Naming SDK 仍保留 `public` 默认值。
  return !configured || configured === DEFAULT_NAMESPACE ? "" : configured;
}

/**
 * Naming 注册使用的 namespace（顶层 `namespace`，默认 public）。
 *
 * @param cfg - 已解析的 Nacos 插件配置
 * @returns Nacos tenant / namespace id
 */
export function resolveNamingNamespace(cfg: NacosPluginConfig): string {
  return cfg.namespace?.trim() || DEFAULT_NAMESPACE;
}

/**
 * 解析 Nacos 配置 group，缺省为 `DEFAULT_GROUP`。
 *
 * @param explicit - 显式 group 名
 * @returns 非空 group 字符串
 */
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
