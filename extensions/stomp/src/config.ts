/**
 * @fileoverview STOMP TCP 运行时配置解析（channels.stomp-tcp）。
 *
 * @description
 * `resolveStompTcpConfig` 从网关全局配置合并默认值；topicBindings 经
 * `normalizeTopicBindings` 过滤无效项。
 *
 * @module config
 */

/**
 * STOMP 配置 — Base Profile 入口。
 */

import type { StompTcpConfig, TopicBinding } from "./types.js";

/** @description 默认 STOMP TCP 服务配置（端口、心跳、auth、prefetch 等）。 */
export const DEFAULT_STOMP_TCP_CONFIG: StompTcpConfig = {
  port: 61613,
  tlsPort: 61614,
  tls: { enabled: false },
  heartbeat: { serverMs: 10_000, clientMs: 10_000 },
  maxConnections: 1000,
  maxFrameSize: 1024 * 1024 * 4,
  auth: { required: true },
  subscribeTopics: [],
  topicBindings: [],
  defaultAckMode: "auto",
  prefetchCount: 100,
};

/**
 * @description 从全局网关配置解析 `channels.stomp-tcp` 并合并默认值。
 * @param globalConfig - 宿主 runtime.config。
 * @returns 合并后的 `StompTcpConfig`。
 * @throws 不抛出。
 */
export function resolveStompTcpConfig(globalConfig: Record<string, unknown>): StompTcpConfig {
  const channels = (globalConfig.channels as Record<string, unknown> | undefined) ?? {};
  const cfg = (channels["stomp-tcp"] as Partial<StompTcpConfig> | undefined) ?? {};
  const defaults = DEFAULT_STOMP_TCP_CONFIG;
  return {
    port: cfg.port ?? defaults.port,
    tlsPort: cfg.tlsPort ?? defaults.tlsPort,
    tls: {
      enabled: cfg.tls?.enabled ?? defaults.tls.enabled,
      certFile: cfg.tls?.certFile,
      keyFile: cfg.tls?.keyFile,
      caFile: cfg.tls?.caFile,
    },
    heartbeat: {
      serverMs: cfg.heartbeat?.serverMs ?? defaults.heartbeat.serverMs,
      clientMs: cfg.heartbeat?.clientMs ?? defaults.heartbeat.clientMs,
    },
    maxConnections: cfg.maxConnections ?? defaults.maxConnections,
    maxFrameSize: cfg.maxFrameSize ?? defaults.maxFrameSize,
    auth: {
      required: cfg.auth?.required ?? defaults.auth.required,
      defaultUser: cfg.auth?.defaultUser,
      defaultPass: cfg.auth?.defaultPass,
    },
    subscribeTopics: Array.isArray(cfg.subscribeTopics) ? cfg.subscribeTopics : defaults.subscribeTopics,
    topicBindings: normalizeTopicBindings(cfg.topicBindings),
    defaultAckMode: cfg.defaultAckMode ?? defaults.defaultAckMode,
    prefetchCount: cfg.prefetchCount ?? defaults.prefetchCount,
  };
}

/**
 * @description 过滤并规范化 topicBindings 数组（要求 topicPattern + agentId）。
 * @param input - 原始配置值。
 * @returns 有效的 TopicBinding 列表。
 * @throws 不抛出。
 */
function normalizeTopicBindings(input: unknown): TopicBinding[] {
  if (!Array.isArray(input)) return [];
  const result: TopicBinding[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const candidate = row as Partial<TopicBinding>;
    if (!candidate.topicPattern || !candidate.agentId) continue;
    result.push({
      topicPattern: candidate.topicPattern,
      agentId: candidate.agentId,
      accountId: candidate.accountId,
      replyTopic: candidate.replyTopic,
    });
  }
  return result;
}
