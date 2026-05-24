/**
 * @fileoverview Nacos SDK 辅助函数与默认常量。
 *
 * @module nacos/shared/shared
 */

import type { PluginLog } from "./types.js";

export const DEFAULT_GROUP = "DEFAULT_GROUP";
export const DEFAULT_NAMESPACE = "public";
export const DEFAULT_SERVICE = "openclaw-gateway";

/**
 * 创建 Nacos SDK 所需的 console 风格 logger。
 *
 * @param log - OpenClaw 插件日志接口
 * @returns 适配 Nacos SDK `logger` 属性的对象
 */
export function createNacosSdkLogger(log: PluginLog): typeof console {
  return {
    log: (...args: unknown[]) => log.info(String(args[0] ?? "")),
    info: (...args: unknown[]) => log.info(args.map(String).join(" ")),
    warn: (...args: unknown[]) => log.warn(args.map(String).join(" ")),
    error: (...args: unknown[]) => log.error(args.map(String).join(" ")),
    debug: (...args: unknown[]) => log.debug(args.map(String).join(" ")),
  } as typeof console;
}

/**
 * 判断是否为 plain object（非 null、非数组）。
 *
 * @param v - 待检测值
 * @returns 是否为 Record 对象
 */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 安全关闭 Nacos 客户端（调用 `close` 若存在）。
 *
 * @param client - NacosConfigClient 或 NacosNamingClient 实例
 * @param logger - 插件日志
 * @param label - 日志前缀标签
 */
export async function tryCloseNacosClient(
  client: unknown,
  logger: PluginLog,
  label: string,
): Promise<void> {
  const c = client as Record<string, unknown> | null;
  const closeFn = typeof c?.close === "function"
    ? (c.close as () => void | Promise<void>)
    : null;
  if (closeFn) {
    try {
      await Promise.resolve(closeFn.call(c));
    } catch (err) {
      logger.warn(`[openclaw-nacos] ${label} client close: ${String(err)}`);
    }
  }
}
