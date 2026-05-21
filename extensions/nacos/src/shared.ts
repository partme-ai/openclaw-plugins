import type { PluginLog } from "./types.js";

export const DEFAULT_GROUP = "DEFAULT_GROUP";
export const DEFAULT_NAMESPACE = "public";
export const DEFAULT_SERVICE = "openclaw-gateway";

/**
 * Creates a console-like logger for Nacos SDK (requires `logger` property).
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
 * Type guard for plain objects (not null, not arrays).
 */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Safely closes a Nacos client by calling its `close` method if available.
 * Used for both `NacosConfigClient` and `NacosNamingClient`.
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
