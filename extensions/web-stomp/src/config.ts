/**
 * STOMP over WebSocket 运行时配置解析。
 */

import type { StompServerConfig } from "./types.js";

export const DEFAULT_STOMP_WS_CONFIG: StompServerConfig = {
  wsPort: 15674,
  path: "/ws",
  heartbeatIncoming: 10_000,
  heartbeatOutgoing: 10_000,
  maxConnections: 500,
};

/**
 * 从全局网关配置解析 channels.stomp 配置。
 *
 * @param globalConfig - OpenClaw 全局配置对象
 * @returns 合并默认值后的 StompServerConfig
 */
export function resolveStompWsConfig(globalConfig: Record<string, unknown>): StompServerConfig {
  const channels = globalConfig.channels as Record<string, unknown> | undefined;
  const stompConfig = channels?.stomp as (Partial<StompServerConfig> & { port?: number }) | undefined;
  const defaults = DEFAULT_STOMP_WS_CONFIG;

  return {
    wsPort: stompConfig?.wsPort ?? stompConfig?.port ?? defaults.wsPort,
    path: stompConfig?.path ?? defaults.path,
    heartbeatIncoming: stompConfig?.heartbeatIncoming ?? defaults.heartbeatIncoming,
    heartbeatOutgoing: stompConfig?.heartbeatOutgoing ?? defaults.heartbeatOutgoing,
    maxConnections: stompConfig?.maxConnections ?? defaults.maxConnections,
  };
}
