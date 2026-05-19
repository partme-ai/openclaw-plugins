/**
 * MQTT 渠道账号与 `channels.mqtt` 配置解析。
 */

import type { ChannelAccountSnapshot, OpenClawConfig } from "openclaw/plugin-sdk";

import type { MqttChannelConfig, OpenClawDmScope, MqttPersistenceConfig } from "./types.js";

export type { MqttChannelConfig } from "./types.js";

/** 默认账号 id（单账号阶段固定为 default） */
export const DEFAULT_MQTT_ACCOUNT_ID = "default";

/**
 * 解析后的 MQTT 账号视图（供 ChannelPlugin 使用）。
 */
export type ResolvedMqttAccount = {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
};

/** 与 {@link resolveBrokerConfig} 默认一致 */
export const DEFAULT_BROKER_CONFIG: MqttChannelConfig = {
  port: 1883,
  wsPort: 8883,
  maxConnections: 1000,
  tls: {
    enabled: false,
    port: 8883,
    requestCert: false,
    rejectUnauthorized: false,
  },
  persistence: {
    enabled: false,
    backend: "memory",
    redis: {
      enabled: false,
      host: "localhost",
      port: 6379,
      db: 0,
      keyPrefix: "mqtt",
      subscriptionTTL: 3600,
      retainedTTL: 0,
    },
  },
  limits: {
    maxPayloadBytes: 1024 * 1024,
  },
  session: {
    maxExpirySeconds: 86400,
    persistentAcrossReconnect: true,
  },
  qos0: {
    mailboxSoftLimit: 200,
  },
  retain: {
    allowInboundRetain: true,
    outboundRetain: false,
  },
  audit: {
    enabled: false,
    format: "json",
  },
  will: {
    allow: true,
    allowedTopicPatterns: [],
  },
  subscribeTopics: [],
  topicBindings: [],
  payload: {
    mode: "jsonTextOrPlain",
  },
  auth: {
    enabled: false,
    allowAnonymous: false,
    users: [],
  },
};

/**
 * 列出当前支持的账号 id（单账号阶段仅 default）。
 */
export function listMqttAccountIds(_cfg: OpenClawConfig): string[] {
  return [DEFAULT_MQTT_ACCOUNT_ID];
}

/**
 * 解析默认账号 id。
 */
export function resolveDefaultMqttAccountId(_cfg: OpenClawConfig): string {
  return DEFAULT_MQTT_ACCOUNT_ID;
}

/**
 * 解析指定账号（单账号阶段忽略 accountId 细节，仅返回统一视图）。
 */
export function resolveMqttAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedMqttAccount {
  const id = accountId?.trim() || DEFAULT_MQTT_ACCOUNT_ID;
  const channels = cfg.channels as Record<string, unknown> | undefined;
  const mqtt = channels?.mqtt;
  const configured = Boolean(mqtt && typeof mqtt === "object");
  return {
    accountId: id,
    name: "MQTT",
    enabled: true,
    configured,
  };
}

/**
 * 从 OpenClaw 全局配置解析 `channels.mqtt` 为 Broker/Channel 共用结构。
 */
export function resolveBrokerConfig(globalConfig: Record<string, unknown>): MqttChannelConfig {
  const channels = globalConfig.channels as Record<string, unknown> | undefined;
  const mqttConfig = channels?.mqtt as Partial<MqttChannelConfig> | undefined;

  const topicBindings = Array.isArray(mqttConfig?.topicBindings)
    ? mqttConfig.topicBindings.filter(
        (item): item is MqttChannelConfig["topicBindings"][number] =>
          Boolean(item?.topicPattern) && Boolean(item?.agentId),
      )
    : [];

  const subscribeTopics = Array.isArray(mqttConfig?.subscribeTopics)
    ? mqttConfig.subscribeTopics.filter((topic): topic is string => typeof topic === "string" && topic.length > 0)
    : [];

  return {
    port: mqttConfig?.port ?? DEFAULT_BROKER_CONFIG.port,
    wsPort: mqttConfig?.wsPort ?? DEFAULT_BROKER_CONFIG.wsPort,
    maxConnections: mqttConfig?.maxConnections ?? DEFAULT_BROKER_CONFIG.maxConnections,
    subscribeTopics,
    topicBindings,
    payload: {
      mode: mqttConfig?.payload?.mode ?? DEFAULT_BROKER_CONFIG.payload.mode,
    },
    auth: {
      enabled: mqttConfig?.auth?.enabled ?? DEFAULT_BROKER_CONFIG.auth.enabled,
      allowAnonymous: mqttConfig?.auth?.allowAnonymous ?? DEFAULT_BROKER_CONFIG.auth.allowAnonymous,
      users: mqttConfig?.auth?.users ?? DEFAULT_BROKER_CONFIG.auth.users,
    },
    tls: {
      enabled: mqttConfig?.tls?.enabled ?? DEFAULT_BROKER_CONFIG.tls.enabled,
      port: mqttConfig?.tls?.port ?? DEFAULT_BROKER_CONFIG.tls.port,
      certFile: mqttConfig?.tls?.certFile,
      keyFile: mqttConfig?.tls?.keyFile,
      caFile: mqttConfig?.tls?.caFile,
      requestCert: mqttConfig?.tls?.requestCert ?? DEFAULT_BROKER_CONFIG.tls.requestCert,
      rejectUnauthorized:
        mqttConfig?.tls?.rejectUnauthorized ?? DEFAULT_BROKER_CONFIG.tls.rejectUnauthorized,
    },
    limits: {
      maxPayloadBytes:
        mqttConfig?.limits?.maxPayloadBytes ?? DEFAULT_BROKER_CONFIG.limits.maxPayloadBytes,
    },
    session: {
      maxExpirySeconds:
        mqttConfig?.session?.maxExpirySeconds ?? DEFAULT_BROKER_CONFIG.session.maxExpirySeconds,
      persistentAcrossReconnect:
        mqttConfig?.session?.persistentAcrossReconnect ??
        DEFAULT_BROKER_CONFIG.session.persistentAcrossReconnect,
    },
    qos0: {
      mailboxSoftLimit:
        mqttConfig?.qos0?.mailboxSoftLimit ?? DEFAULT_BROKER_CONFIG.qos0.mailboxSoftLimit,
    },
    retain: {
      allowInboundRetain:
        mqttConfig?.retain?.allowInboundRetain ?? DEFAULT_BROKER_CONFIG.retain.allowInboundRetain,
      outboundRetain:
        mqttConfig?.retain?.outboundRetain ?? DEFAULT_BROKER_CONFIG.retain.outboundRetain,
    },
    audit: {
      enabled: mqttConfig?.audit?.enabled ?? DEFAULT_BROKER_CONFIG.audit.enabled,
      format: mqttConfig?.audit?.format ?? DEFAULT_BROKER_CONFIG.audit.format,
    },
    will: {
      allow: mqttConfig?.will?.allow ?? DEFAULT_BROKER_CONFIG.will.allow,
      allowedTopicPatterns:
        mqttConfig?.will?.allowedTopicPatterns ?? DEFAULT_BROKER_CONFIG.will.allowedTopicPatterns,
    },
    persistence: {
      enabled: mqttConfig?.persistence?.enabled ?? DEFAULT_BROKER_CONFIG.persistence.enabled,
      backend: mqttConfig?.persistence?.backend ?? DEFAULT_BROKER_CONFIG.persistence.backend,
      redis: {
        enabled: mqttConfig?.persistence?.redis?.enabled ?? DEFAULT_BROKER_CONFIG.persistence.redis?.enabled,
        host: mqttConfig?.persistence?.redis?.host ?? DEFAULT_BROKER_CONFIG.persistence.redis?.host,
        port: mqttConfig?.persistence?.redis?.port ?? DEFAULT_BROKER_CONFIG.persistence.redis?.port,
        db: mqttConfig?.persistence?.redis?.db ?? DEFAULT_BROKER_CONFIG.persistence.redis?.db,
        password: mqttConfig?.persistence?.redis?.password,
        keyPrefix: mqttConfig?.persistence?.redis?.keyPrefix ?? DEFAULT_BROKER_CONFIG.persistence.redis?.keyPrefix,
        subscriptionTTL: mqttConfig?.persistence?.redis?.subscriptionTTL ?? DEFAULT_BROKER_CONFIG.persistence.redis?.subscriptionTTL,
        retainedTTL: mqttConfig?.persistence?.redis?.retainedTTL ?? DEFAULT_BROKER_CONFIG.persistence.redis?.retainedTTL,
      },
    },
  };
}

/**
 * 兼容旧函数名：读取 OpenClaw 全局 `session.dmScope`。
 */
export function resolveOpenClawDmScope(globalConfig: Record<string, unknown>): OpenClawDmScope {
  return (globalConfig.session as any)?.dmScope ?? 'per-peer';
}

/**
 * 检测遗留误配：`channels.mqtt.session.dmScope`。
 * 插件会忽略该字段，始终使用 OpenClaw 全局 `session.dmScope`。
 */
export function hasLegacyMqttDmScope(globalConfig: Record<string, unknown>): boolean {
  const channels = globalConfig.channels as Record<string, unknown> | undefined;
  const mqtt = channels?.mqtt as { session?: { dmScope?: unknown } } | undefined;
  return typeof mqtt?.session?.dmScope === "string";
}

/**
 * 构建账号列表行（Channel status / describe）。
 */
export function describeMqttAccountSnapshot(
  account: ResolvedMqttAccount,
  port: number | null,
): ChannelAccountSnapshot {
  return {
    accountId: account.accountId,
    name: account.name,
    enabled: account.enabled,
    configured: account.configured,
    webhookPath: "/mqtt/status",
    port,
  };
}
