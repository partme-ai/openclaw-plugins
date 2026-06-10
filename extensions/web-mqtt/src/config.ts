/**
 * web-mqtt 配置解析。
 * 将 openclaw 配置中的 `channels["mqtt-ws"]` 解析成带默认值的强类型配置。
 */

import type { WebMqttConfig, WebMqttTopicBinding, WebMqttUser } from "./types.js";

/**
 * 默认配置。
 */
export const DEFAULT_WEB_MQTT_CONFIG: WebMqttConfig = {
  port: 15675,
  path: "/ws",
  host: "0.0.0.0",
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
    compress: true,
    idleTimeoutMs: 60000,
    maxFrameSize: 256 * 1024,
  },
  limits: {
    maxPayloadBytes: 1024 * 1024,
    maxSubscriptionsPerClient: 200,
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
    port: asSafeInteger(raw.port, DEFAULT_WEB_MQTT_CONFIG.port),
    path: normalizeWsPath(raw.path ?? DEFAULT_WEB_MQTT_CONFIG.path),
    host: typeof raw.host === "string" && raw.host.trim() ? raw.host.trim() : DEFAULT_WEB_MQTT_CONFIG.host,
    maxConnections: asSafeInteger(raw.maxConnections, DEFAULT_WEB_MQTT_CONFIG.maxConnections),
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
      idleTimeoutMs: asSafeInteger(raw.ws?.idleTimeoutMs, DEFAULT_WEB_MQTT_CONFIG.ws.idleTimeoutMs),
      maxFrameSize: asSafeInteger(raw.ws?.maxFrameSize, DEFAULT_WEB_MQTT_CONFIG.ws.maxFrameSize),
    },
    limits: {
      maxPayloadBytes: asSafeInteger(raw.limits?.maxPayloadBytes, DEFAULT_WEB_MQTT_CONFIG.limits.maxPayloadBytes),
      maxSubscriptionsPerClient: asSafeInteger(
        raw.limits?.maxSubscriptionsPerClient,
        DEFAULT_WEB_MQTT_CONFIG.limits.maxSubscriptionsPerClient,
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
    ...config,
    auth: {
      required: config.auth.required,
      allowAnonymous: config.auth.allowAnonymous,
      users: config.auth.users.map((user) => ({
        username: user.username,
        hasPassword: Boolean(user.password || user.passwordHash),
        hashAlgorithm: user.hashAlgorithm ?? null,
        publishAllowCount: user.publishAllow?.length ?? 0,
        subscribeAllowCount: user.subscribeAllow?.length ?? 0,
        aclRuleCount: user.aclRules?.length ?? 0,
      })),
    },
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
  if (config.auth.required && !config.auth.allowAnonymous && config.auth.users.length === 0) {
    issues.push("auth.required=true 且未配置 auth.users，客户端将无法通过认证。");
  }
  if (config.tls.enabled && (!config.tls.keyFile || !config.tls.certFile)) {
    issues.push("tls.enabled=true 但未同时提供 tls.keyFile 与 tls.certFile。");
  }
  if (config.topicBindings.length > 0 && config.subscribeTopics.length === 0) {
    issues.push("配置了 topicBindings 但 subscribeTopics 为空，建议设置订阅白名单。");
  }
  return issues;
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

function asSafeInteger(input: unknown, fallback: number): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) return fallback;
  return Math.floor(input);
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
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
