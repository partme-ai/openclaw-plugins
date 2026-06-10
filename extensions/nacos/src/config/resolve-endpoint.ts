/**
 * @fileoverview Gateway/Hooks 端点解析 — 端口、Hooks 路径、Nacos 注册 IP。
 *
 * @module nacos/config/resolve-endpoint
 */

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
 * 解析 Gateway 监听端口（兼容 OPENCLAW_GATEWAY_PORT 与 config.gateway.port）。
 *
 * @param cfg - OpenClaw 配置片段
 * @param env - 环境变量表，默认 `process.env`
 * @returns 有效端口号
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
 * 解析 Hooks 基路径与启用状态。
 *
 * @param cfg - OpenClaw 配置片段
 * @returns hooks 是否启用及规范化 base path
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
 * 解析注册到 Nacos 的实例 IP（config → env → 首个 LAN IPv4 → 127.0.0.1）。
 *
 * @param params.configIp - 配置中的 registerIp
 * @param params.env - 环境变量表
 * @param params.warn - 回退到 127.0.0.1 时的 warn 回调
 * @returns 用于 Nacos 注册的 IP 字符串
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
