import { networkInterfaces } from "node:os";
import type { OpenClawConfigSlice } from "../shared/types.js";

/** Default Gateway port when config/env omit it (matches OpenClaw). */
export const DEFAULT_GATEWAY_PORT = 18789;

const DEFAULT_HOOKS_PATH = "/hooks";

/**
 * Parses OPENCLAW_GATEWAY_PORT the same way OpenClaw does (port, host:port, [ipv6]:port).
 */
function parseGatewayPortEnvValue(raw: string | undefined): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  const bracketedIpv6Match = trimmed.match(/^\[[^\]]+\]:(\d+)$/);
  if (bracketedIpv6Match?.[1]) {
    const parsed = Number.parseInt(bracketedIpv6Match[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  const firstColon = trimmed.indexOf(":");
  const lastColon = trimmed.lastIndexOf(":");
  if (firstColon <= 0 || firstColon !== lastColon) {
    return null;
  }
  const suffix = trimmed.slice(firstColon + 1);
  if (!/^\d+$/.test(suffix)) {
    return null;
  }
  const parsed = Number.parseInt(suffix, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Resolves the Gateway listen port from env and config (OpenClaw-compatible).
 */
export function resolveGatewayPort(
  cfg: OpenClawConfigSlice | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const envPort = parseGatewayPortEnvValue(env.OPENCLAW_GATEWAY_PORT);
  if (envPort !== null) {
    return envPort;
  }
  const configPort = cfg?.gateway?.port;
  if (typeof configPort === "number" && Number.isFinite(configPort) && configPort > 0) {
    return configPort;
  }
  return DEFAULT_GATEWAY_PORT;
}

/**
 * Resolves Hooks base path and enabled flag from OpenClaw hooks config.
 */
export function resolveHooksInfo(cfg: OpenClawConfigSlice | undefined): {
  hooksEnabled: boolean;
  hooksBasePath: string;
} {
  const hooks = cfg?.hooks;
  if (hooks?.enabled !== true) {
    return { hooksEnabled: false, hooksBasePath: DEFAULT_HOOKS_PATH };
  }
  const raw =
    typeof hooks.path === "string" && hooks.path.trim() !== ""
      ? hooks.path.trim()
      : DEFAULT_HOOKS_PATH;
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const trimmed = withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
  return { hooksEnabled: true, hooksBasePath: trimmed };
}

/**
 * Picks the first non-internal IPv4 from local interfaces.
 */
function pickFirstNonInternalIPv4(): string | null {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    const addrs = nets[name];
    if (!addrs) {
      continue;
    }
    for (const a of addrs) {
      if (a.family !== "IPv4" || a.internal) {
        continue;
      }
      return a.address;
    }
  }
  return null;
}

/**
 * Resolves the IP to register in Nacos: config → env → first LAN IPv4 → 127.0.0.1.
 */
export function resolveRegisterIp(params: {
  configIp?: string;
  env?: NodeJS.ProcessEnv;
  warn: (msg: string) => void;
}): string {
  const env = params.env ?? process.env;
  const fromConfig = params.configIp?.trim();
  if (fromConfig) {
    return fromConfig;
  }
  const fromEnv = env.OPENCLAW_NACOS_REGISTER_IP?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const lan = pickFirstNonInternalIPv4();
  if (lan) {
    return lan;
  }
  params.warn(
    "[openclaw-nacos] No registerIp or OPENCLAW_NACOS_REGISTER_IP; falling back to 127.0.0.1 (not reachable from other hosts).",
  );
  return "127.0.0.1";
}
