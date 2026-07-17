/**
 * web-mqtt 配置解析。
 * 将 openclaw 配置中的 `channels["mqtt-ws"]` 解析成带默认值的强类型配置。
 */

import type { WebMqttConfig, WebMqttTopicBinding, WebMqttUser } from "./types.js";
import {
  isValidMqttTopicFilter,
  isValidMqttTopicName,
} from "@partme.ai/openclaw-message-sdk/transport";

/**
 * 默认配置。
 */
export const DEFAULT_WEB_MQTT_CONFIG: WebMqttConfig = {
  port: 15675,
  path: "/ws",
  host: "127.0.0.1",
  maxConnections: 5000,
  topicPrefix: "openclaw/",
  subscribeTopics: [],
  topicBindings: [],
  payload: { mode: "jsonTextOrPlain" },
  auth: {
    required: true,
    allowAnonymous: false,
    users: [],
  },
  tls: {
    enabled: false,
    minVersion: "TLSv1.2",
    requestCert: false,
    rejectUnauthorized: false,
  },
  ws: {
    compress: false,
    idleTimeoutMs: 60000,
    maxFrameSize: 256 * 1024,
    allowedOrigins: [],
  },
  limits: {
    maxPayloadBytes: 256 * 1024,
    maxSubscriptionsPerClient: 200,
    maxPendingMessagesPerClient: 32,
    inboundTaskTimeoutMs: 120_000,
  },
  proxyProtocol: false,
};

/**
 * 解析 channels.mqtt-ws 并返回运行时配置。
 *
 * @param globalConfig - OpenClaw 全局配置对象
 * @returns 合并默认值后的 WebMqttConfig
 */
export function resolveWebMqttConfig(globalConfig: Record<string, unknown>): WebMqttConfig {
  const channels = globalConfig.channels as Record<string, unknown> | undefined;
  const raw = (channels?.["mqtt-ws"] ?? {}) as Partial<WebMqttConfig>;
  const topicPrefix = normalizeTopicPrefix(raw.topicPrefix ?? DEFAULT_WEB_MQTT_CONFIG.topicPrefix);

  return {
    port: asConfiguredNumber(raw.port, DEFAULT_WEB_MQTT_CONFIG.port),
    path: normalizeWsPath(raw.path ?? DEFAULT_WEB_MQTT_CONFIG.path),
    host: typeof raw.host === "string" && raw.host.trim() ? raw.host.trim() : DEFAULT_WEB_MQTT_CONFIG.host,
    maxConnections: asConfiguredNumber(raw.maxConnections, DEFAULT_WEB_MQTT_CONFIG.maxConnections),
    topicPrefix,
    subscribeTopics: normalizeStringArray(raw.subscribeTopics),
    topicBindings: normalizeBindings(raw.topicBindings),
    payload: {
      mode: raw.payload?.mode === "jsonTextOrPlain" ? "jsonTextOrPlain" : DEFAULT_WEB_MQTT_CONFIG.payload.mode,
      outboundFormat:
        raw.payload?.outboundFormat === "envelope" ||
        raw.payload?.outboundFormat === "legacyJsonText" ||
        raw.payload?.outboundFormat === "plainText"
          ? raw.payload?.outboundFormat
          : DEFAULT_WEB_MQTT_CONFIG.payload.outboundFormat,
    },
    auth: {
      required: raw.auth?.required ?? DEFAULT_WEB_MQTT_CONFIG.auth.required,
      allowAnonymous: raw.auth?.allowAnonymous ?? DEFAULT_WEB_MQTT_CONFIG.auth.allowAnonymous,
      users: normalizeUsers(raw.auth?.users),
    },
    tls: {
      enabled: raw.tls?.enabled ?? DEFAULT_WEB_MQTT_CONFIG.tls.enabled,
      keyFile: raw.tls?.keyFile,
      certFile: raw.tls?.certFile,
      caFile: raw.tls?.caFile,
      minVersion: raw.tls?.minVersion ?? DEFAULT_WEB_MQTT_CONFIG.tls.minVersion,
      requestCert: raw.tls?.requestCert ?? DEFAULT_WEB_MQTT_CONFIG.tls.requestCert,
      rejectUnauthorized: raw.tls?.rejectUnauthorized ?? DEFAULT_WEB_MQTT_CONFIG.tls.rejectUnauthorized,
    },
    ws: {
      compress: raw.ws?.compress ?? DEFAULT_WEB_MQTT_CONFIG.ws.compress,
      idleTimeoutMs: asConfiguredNumber(raw.ws?.idleTimeoutMs, DEFAULT_WEB_MQTT_CONFIG.ws.idleTimeoutMs),
      maxFrameSize: asConfiguredNumber(raw.ws?.maxFrameSize, DEFAULT_WEB_MQTT_CONFIG.ws.maxFrameSize),
      allowedOrigins: normalizeOrigins(raw.ws?.allowedOrigins),
    },
    limits: {
      maxPayloadBytes: asConfiguredNumber(raw.limits?.maxPayloadBytes, DEFAULT_WEB_MQTT_CONFIG.limits.maxPayloadBytes),
      maxSubscriptionsPerClient: asConfiguredNumber(
        raw.limits?.maxSubscriptionsPerClient,
        DEFAULT_WEB_MQTT_CONFIG.limits.maxSubscriptionsPerClient,
      ),
      maxPendingMessagesPerClient: asConfiguredNumber(
        raw.limits?.maxPendingMessagesPerClient,
        DEFAULT_WEB_MQTT_CONFIG.limits.maxPendingMessagesPerClient,
      ),
      inboundTaskTimeoutMs: asConfiguredNumber(
        raw.limits?.inboundTaskTimeoutMs,
        DEFAULT_WEB_MQTT_CONFIG.limits.inboundTaskTimeoutMs,
      ),
    },
    proxyProtocol: raw.proxyProtocol ?? DEFAULT_WEB_MQTT_CONFIG.proxyProtocol,
  };
}

/**
 * 生成适合 status/debug 的脱敏配置快照。
 *
 * @param config - 完整 WebMqttConfig
 * @returns 脱敏后的可序列化配置对象（密码字段仅保留 hasPassword 标志）
 */
export function buildWebMqttConfigSnapshot(config: WebMqttConfig): Record<string, unknown> {
  return {
    host: config.host,
    port: config.port,
    path: config.path,
    maxConnections: config.maxConnections,
    topicPrefix: config.topicPrefix,
    subscribeTopicCount: config.subscribeTopics.length,
    topicBindingCount: config.topicBindings.length,
    payload: { ...config.payload },
    auth: {
      required: config.auth.required,
      allowAnonymous: config.auth.allowAnonymous,
      userCount: config.auth.users.length,
    },
    tls: {
      enabled: config.tls.enabled,
      minVersion: config.tls.minVersion,
      requestCert: config.tls.requestCert,
      rejectUnauthorized: config.tls.rejectUnauthorized,
    },
    ws: { ...config.ws },
    limits: { ...config.limits },
  };
}

/**
 * 对配置做启动前校验，返回告警信息。
 *
 * @param config - 待校验的 WebMqttConfig
 * @returns 人类可读的问题描述列表（空数组表示无告警）
 */
export function validateWebMqttConfig(config: WebMqttConfig): string[] {
  const issues: string[] = [];
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
    issues.push("port 必须是 1 到 65535 之间的整数。");
  }
  if (!Number.isSafeInteger(config.maxConnections) || config.maxConnections < 1) {
    issues.push("maxConnections 必须是正安全整数。");
  }
  if (!config.path.startsWith("/") || config.path.includes("?") || config.path.includes("#")) {
    issues.push("path 必须是以 / 开头且不包含 query/fragment 的 WebSocket 路径。");
  }
  if (config.auth.required && !config.auth.allowAnonymous && config.auth.users.length === 0) {
    issues.push("auth.required=true 且未配置 auth.users，客户端将无法通过认证。");
  }
  if (config.auth.required && config.auth.allowAnonymous) {
    const anonymous = config.auth.users.find((user) => user.username === "anonymous");
    if (!anonymous || !hasUserAcl(anonymous)) {
      issues.push("auth.allowAnonymous=true 时必须配置 username=anonymous 的用户及 ACL。");
    }
  }
  if (!config.tls.enabled && !isLoopbackHost(config.host)) {
    issues.push("未启用 TLS 时仅允许监听 loopback 地址。");
  }
  if (!isLoopbackHost(config.host) && !config.auth.required) {
    issues.push("监听非 loopback 地址时必须启用客户端认证。");
  }
  if (config.tls.enabled && (!config.tls.keyFile || !config.tls.certFile)) {
    issues.push("tls.enabled=true 但未同时提供 tls.keyFile 与 tls.certFile。");
  }
  if (config.tls.rejectUnauthorized && !config.tls.requestCert) {
    issues.push("tls.rejectUnauthorized=true 时必须同时设置 tls.requestCert=true。");
  }
  if (config.topicBindings.length > 0 && config.subscribeTopics.length === 0) {
    issues.push("配置了 topicBindings 但 subscribeTopics 为空，建议设置订阅白名单。");
  }
  if (config.limits.maxPayloadBytes > config.ws.maxFrameSize) {
    issues.push("limits.maxPayloadBytes 不能大于 ws.maxFrameSize，否则 WebSocket 会先行断开。");
  }
  if (config.proxyProtocol) {
    issues.push("proxyProtocol 尚未实现，禁止启用以避免错误信任来源地址。");
  }
  if (!Number.isSafeInteger(config.ws.idleTimeoutMs) || config.ws.idleTimeoutMs < 1) {
    issues.push("ws.idleTimeoutMs 必须是正安全整数。");
  }
  if (!Number.isSafeInteger(config.ws.maxFrameSize) || config.ws.maxFrameSize < 1) {
    issues.push("ws.maxFrameSize 必须是正安全整数。");
  }
  if (!Number.isSafeInteger(config.limits.maxPayloadBytes) || config.limits.maxPayloadBytes < 1) {
    issues.push("limits.maxPayloadBytes 必须是正安全整数。");
  }
  if (!Number.isSafeInteger(config.limits.maxSubscriptionsPerClient) || config.limits.maxSubscriptionsPerClient < 1) {
    issues.push("limits.maxSubscriptionsPerClient 必须是正安全整数。");
  }
  if (!Number.isSafeInteger(config.limits.maxPendingMessagesPerClient) || config.limits.maxPendingMessagesPerClient < 1) {
    issues.push("limits.maxPendingMessagesPerClient 必须是正安全整数。");
  }
  if (!Number.isSafeInteger(config.limits.inboundTaskTimeoutMs) || config.limits.inboundTaskTimeoutMs < 1) {
    issues.push("limits.inboundTaskTimeoutMs 必须是正安全整数。");
  }
  for (const origin of config.ws.allowedOrigins) {
    if (!isValidBrowserOrigin(origin)) {
      issues.push(`ws.allowedOrigins 包含非法 Origin：${origin}。仅允许规范化的 http/https Origin。`);
    }
  }
  for (const topic of config.subscribeTopics) {
    if (!isValidMqttTopicFilter(topic)) issues.push(`subscribeTopics 包含非法 MQTT Topic Filter：${topic}。`);
  }
  if (!isValidMqttTopicName(config.topicPrefix)) {
    issues.push("topicPrefix 必须是非空且不含 NUL、+、# 的 MQTT Topic 前缀。");
  }
  config.topicBindings.forEach((binding, index) => {
    if (!isValidMqttTopicFilter(binding.topicPattern)) {
      issues.push(`topicBindings[${index}].topicPattern 不是合法 MQTT Topic Filter。`);
    }
    if (binding.replyTopic !== undefined && !isValidMqttTopicName(binding.replyTopic)) {
      issues.push(`topicBindings[${index}].replyTopic 不是合法 MQTT Topic Name。`);
    }
  });
  const usernames = new Set<string>();
  for (const user of config.auth.users) {
    const username = user.username.trim();
    if (!username) issues.push("auth.users[].username 不能为空。");
    else if (usernames.has(username)) issues.push(`auth.users 存在重复用户名：${username}。`);
    usernames.add(username);
    if (username !== "anonymous") {
      if (Boolean(user.password) === Boolean(user.passwordHash)) {
        issues.push(`用户 ${username} 必须且只能配置 password 或 passwordHash 其中一个。`);
      }
    }
    const patterns = [
      ...(user.publishAllow ?? []),
      ...(user.subscribeAllow ?? []),
      ...(user.aclRules ?? []).map((rule) => rule.topicPattern),
    ];
    if (patterns.some((pattern) => !pattern.trim())) issues.push(`用户 ${username} 包含空 ACL topicPattern。`);
    if (patterns.some((pattern) => !isValidMqttTopicFilter(pattern))) {
      issues.push(`用户 ${username} 包含非法 MQTT ACL Topic Filter。`);
    }
  }
  return issues;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.");
}

function hasUserAcl(user: WebMqttUser): boolean {
  return Boolean(user.aclRules?.length || user.publishAllow?.length || user.subscribeAllow?.length);
}

/**
 * 规范化 topic 前缀（保证以 `/` 结尾）。
 *
 * @param prefix - 原始 topic 前缀
 * @returns 以 `/` 结尾的前缀字符串
 */
export function normalizeTopicPrefix(prefix: string): string {
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function normalizeWsPath(path: string): string {
  if (!path) return "/ws";
  return path.startsWith("/") ? path : `/${path}`;
}

/** 保留用户显式提供的有限数字，让 validate 阶段能发现 0、负数和小数误配。 */
function asConfiguredNumber(input: unknown, fallback: number): number {
  return typeof input === "number" && Number.isFinite(input) ? input : fallback;
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

/** 将合法浏览器 Origin 规范化为 URL.origin；非法值保留给 validate 输出明确错误。 */
function normalizeOrigins(input: unknown): string[] {
  const normalized = normalizeStringArray(input).map((origin) => {
    try {
      const url = new URL(origin);
      if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) {
        return origin;
      }
      return url.origin;
    } catch {
      return origin;
    }
  });
  return [...new Set(normalized)];
}

/** Origin 白名单仅接受不带凭据、路径、查询和片段的 http/https 源。 */
function isValidBrowserOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === "" || url.pathname === "/") &&
      url.origin === origin
    );
  } catch {
    return false;
  }
}

function normalizeBindings(input: unknown): WebMqttTopicBinding[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (item): item is WebMqttTopicBinding =>
        Boolean(item && typeof item === "object" && (item as WebMqttTopicBinding).topicPattern && (item as WebMqttTopicBinding).agentId),
    )
    .map((item) => ({
      topicPattern: item.topicPattern,
      agentId: item.agentId,
      accountId: item.accountId,
      replyTopic: item.replyTopic,
    }));
}

function normalizeUsers(input: unknown): WebMqttUser[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is WebMqttUser => Boolean(item && typeof item === "object" && (item as WebMqttUser).username))
    .map((item) => ({
      username: item.username,
      password: item.password,
      passwordHash: item.passwordHash,
      hashAlgorithm: item.hashAlgorithm ?? "sha256",
      publishAllow: normalizeStringArray(item.publishAllow),
      subscribeAllow: normalizeStringArray(item.subscribeAllow),
      aclRules: normalizeAclRules(item.aclRules),
    }));
}

function normalizeAclRules(input: unknown): WebMqttUser["aclRules"] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (item): item is NonNullable<WebMqttUser["aclRules"]>[number] =>
        Boolean(
          item &&
            typeof item === "object" &&
            (item as { action?: unknown }).action &&
            (item as { topicPattern?: unknown }).topicPattern &&
            (item as { effect?: unknown }).effect,
        ),
    )
    .map((item) => ({
      action: item.action,
      topicPattern: item.topicPattern,
      effect: item.effect,
      accountId: item.accountId,
    }));
}
