/**
 * @fileoverview 跨渠道消息 Router 的规则、投递策略和状态目录配置解析。
 *
 * 解析器校验规则 ID 唯一性、forward/reply-via 动作结构、重试与容量边界，并约束 writer
 * lease 超时至少为心跳周期两倍。所有缺省值集中在这里，状态目录默认落在 OpenClaw state
 * 下，显式相对路径也以该目录为基准解析。
 */
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import type { RouteAction, RouterConfig, RouterRule } from "./types.js";

const DEFAULTS: RouterConfig = {
  enabled: true,
  rules: [],
  audit: { enabled: true, logToConsole: false, maxEntries: 5_000 },
  delivery: {
    maxAttempts: 5,
    initialDelayMs: 500,
    maxDelayMs: 30_000,
    backoffMultiplier: 2,
    jitter: 0.2,
    dedupeTtlMs: 24 * 60 * 60 * 1000,
    maxDeliveredKeys: 50_000,
    maxDeadLetters: 10_000,
    maxPendingTasks: 10_000,
    maxPayloadBytes: 1_048_576,
    maxHops: 8,
    publishTimeoutMs: 15_000,
    concurrency: 4,
    lockHeartbeatMs: 5_000,
    lockTimeoutMs: 30_000,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`[router] ${field} contains unknown field(s): ${unknown.join(", ")}`);
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`[router] ${field} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`[router] ${field} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > 1_024) throw new Error(`[router] ${field} must not exceed 1024 characters`);
  return normalized;
}

function stringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`[router] ${field} must be an array`);
  return value.map((item, index) => nonEmpty(item, `${field}[${index}]`));
}

function resolveAction(value: unknown, field: string): RouteAction {
  if (!isRecord(value)) throw new Error(`[router] ${field} must be an object`);
  const action = value;
  const type = action.type;
  const target = nonEmpty(action.target, `${field}.target`);
  if (type === "forward") {
    assertKnownKeys(action, ["type", "target", "topic"], field);
    return { type, target, ...(action.topic === undefined ? {} : { topic: nonEmpty(action.topic, `${field}.topic`) }) };
  }
  if (type === "reply-via") {
    assertKnownKeys(action, ["type", "target", "accountId", "to"], field);
    return {
      type,
      target,
      ...(action.accountId === undefined ? {} : { accountId: nonEmpty(action.accountId, `${field}.accountId`) }),
      ...(action.to === undefined ? {} : { to: nonEmpty(action.to, `${field}.to`) }),
    };
  }
  throw new Error(`[router] ${field}.type must be forward or reply-via`);
}

function resolveRule(value: unknown, index: number): RouterRule {
  if (!isRecord(value)) throw new Error(`[router] rules[${index}] must be an object`);
  const rule = value;
  assertKnownKeys(rule, ["id", "match", "actions"], `rules[${index}]`);
  if (rule.match !== undefined && !isRecord(rule.match)) throw new Error(`[router] rules[${index}].match must be an object`);
  const match = isRecord(rule.match) ? rule.match : {};
  assertKnownKeys(match, ["channels", "direction", "topic", "accountId"], `rules[${index}].match`);
  const direction = match.direction;
  if (direction !== undefined && !["inbound", "outbound", "both"].includes(String(direction))) {
    throw new Error(`[router] rules[${index}].match.direction is invalid`);
  }
  if (!Array.isArray(rule.actions) || rule.actions.length === 0) {
    throw new Error(`[router] rules[${index}].actions must contain at least one action`);
  }
  if (rule.actions.length > 128) throw new Error(`[router] rules[${index}].actions must contain at most 128 actions`);
  const channels = stringList(match.channels, `rules[${index}].match.channels`);
  return {
    id: nonEmpty(rule.id, `rules[${index}].id`),
    match: {
      ...(channels ? { channels } : {}),
      ...(direction ? { direction: direction as RouterRule["match"]["direction"] } : {}),
      ...(match.topic === undefined ? {} : { topic: nonEmpty(match.topic, `rules[${index}].match.topic`) }),
      ...(match.accountId === undefined ? {} : { accountId: nonEmpty(match.accountId, `rules[${index}].match.accountId`) }),
    },
    actions: rule.actions.map((action, actionIndex) => resolveAction(action, `rules[${index}].actions[${actionIndex}]`)),
  };
}

/** 将不可信插件配置解析为边界完整的 RouterConfig。 */
export function resolveRouterConfig(api: OpenClawPluginApi): RouterConfig {
  if (api.pluginConfig !== undefined && !isRecord(api.pluginConfig)) throw new Error("[router] config must be an object");
  const raw = isRecord(api.pluginConfig) ? api.pluginConfig : {};
  assertKnownKeys(raw, ["enabled", "rules", "audit", "delivery"], "config");
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") throw new Error("[router] enabled must be a boolean");
  if (raw.audit !== undefined && !isRecord(raw.audit)) throw new Error("[router] audit must be an object");
  if (raw.delivery !== undefined && !isRecord(raw.delivery)) throw new Error("[router] delivery must be an object");
  if (raw.rules !== undefined && !Array.isArray(raw.rules)) throw new Error("[router] rules must be an array");
  const audit = isRecord(raw.audit) ? raw.audit : {};
  const delivery = isRecord(raw.delivery) ? raw.delivery : {};
  assertKnownKeys(audit, ["enabled", "logToConsole", "maxEntries"], "audit");
  assertKnownKeys(delivery, [
    "stateDir", "maxAttempts", "initialDelayMs", "maxDelayMs", "backoffMultiplier", "jitter",
    "dedupeTtlMs", "maxDeliveredKeys", "maxDeadLetters", "maxPendingTasks", "maxPayloadBytes",
    "maxHops", "publishTimeoutMs", "concurrency", "lockHeartbeatMs", "lockTimeoutMs",
  ], "delivery");
  if (audit.enabled !== undefined && typeof audit.enabled !== "boolean") throw new Error("[router] audit.enabled must be a boolean");
  if (audit.logToConsole !== undefined && typeof audit.logToConsole !== "boolean") throw new Error("[router] audit.logToConsole must be a boolean");
  if (delivery.stateDir !== undefined && (typeof delivery.stateDir !== "string" || !delivery.stateDir.trim())) {
    throw new Error("[router] delivery.stateDir must be a non-empty string");
  }
  const rules = Array.isArray(raw.rules) ? raw.rules.map(resolveRule) : [];
  if (rules.length > 1_000) throw new Error("[router] rules must contain at most 1000 entries");
  const duplicateIds = rules.map((rule) => rule.id).filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) throw new Error(`[router] duplicate rule id(s): ${[...new Set(duplicateIds)].join(", ")}`);
  const lockHeartbeatMs = Math.floor(finiteNumber(delivery.lockHeartbeatMs, DEFAULTS.delivery.lockHeartbeatMs, 1_000, 60_000, "delivery.lockHeartbeatMs"));
  const lockTimeoutMs = Math.floor(finiteNumber(delivery.lockTimeoutMs, DEFAULTS.delivery.lockTimeoutMs, 5_000, 300_000, "delivery.lockTimeoutMs"));
  if (lockTimeoutMs < lockHeartbeatMs * 2) throw new Error("[router] delivery.lockTimeoutMs must be at least twice lockHeartbeatMs");
  const initialDelayMs = Math.floor(finiteNumber(delivery.initialDelayMs, DEFAULTS.delivery.initialDelayMs, 10, 3_600_000, "delivery.initialDelayMs"));
  const maxDelayMs = Math.floor(finiteNumber(delivery.maxDelayMs, DEFAULTS.delivery.maxDelayMs, 10, 86_400_000, "delivery.maxDelayMs"));
  if (maxDelayMs < initialDelayMs) throw new Error("[router] delivery.maxDelayMs must be greater than or equal to initialDelayMs");
  return {
    enabled: raw.enabled !== false,
    rules,
    audit: {
      enabled: audit.enabled !== false,
      logToConsole: audit.logToConsole === true,
      maxEntries: Math.floor(finiteNumber(audit.maxEntries, DEFAULTS.audit.maxEntries, 100, 100_000, "audit.maxEntries")),
    },
    delivery: {
      ...(typeof delivery.stateDir === "string" && delivery.stateDir.trim() ? { stateDir: delivery.stateDir.trim() } : {}),
      maxAttempts: Math.floor(finiteNumber(delivery.maxAttempts, DEFAULTS.delivery.maxAttempts, 1, 100, "delivery.maxAttempts")),
      initialDelayMs,
      maxDelayMs,
      backoffMultiplier: finiteNumber(delivery.backoffMultiplier, DEFAULTS.delivery.backoffMultiplier, 1, 10, "delivery.backoffMultiplier"),
      jitter: finiteNumber(delivery.jitter, DEFAULTS.delivery.jitter, 0, 1, "delivery.jitter"),
      dedupeTtlMs: Math.floor(finiteNumber(delivery.dedupeTtlMs, DEFAULTS.delivery.dedupeTtlMs, 1_000, 30 * 86_400_000, "delivery.dedupeTtlMs")),
      maxDeliveredKeys: Math.floor(finiteNumber(delivery.maxDeliveredKeys, DEFAULTS.delivery.maxDeliveredKeys, 100, 1_000_000, "delivery.maxDeliveredKeys")),
      maxDeadLetters: Math.floor(finiteNumber(delivery.maxDeadLetters, DEFAULTS.delivery.maxDeadLetters, 100, 1_000_000, "delivery.maxDeadLetters")),
      maxPendingTasks: Math.floor(finiteNumber(delivery.maxPendingTasks, DEFAULTS.delivery.maxPendingTasks, 100, 1_000_000, "delivery.maxPendingTasks")),
      maxPayloadBytes: Math.floor(finiteNumber(delivery.maxPayloadBytes, DEFAULTS.delivery.maxPayloadBytes, 1_024, 16_777_216, "delivery.maxPayloadBytes")),
      maxHops: Math.floor(finiteNumber(delivery.maxHops, DEFAULTS.delivery.maxHops, 1, 64, "delivery.maxHops")),
      publishTimeoutMs: Math.floor(finiteNumber(delivery.publishTimeoutMs, DEFAULTS.delivery.publishTimeoutMs, 100, 300_000, "delivery.publishTimeoutMs")),
      concurrency: Math.floor(finiteNumber(delivery.concurrency, DEFAULTS.delivery.concurrency, 1, 64, "delivery.concurrency")),
      lockHeartbeatMs,
      lockTimeoutMs,
    },
  };
}

/** 解析持久化投递状态的绝对目录。 */
export function resolveRouterStateDir(config: RouterConfig): string {
  const base = process.env.OPENCLAW_STATE_DIR?.trim() || join(homedir(), ".openclaw");
  const configured = config.delivery.stateDir;
  if (!configured) return join(base, "router");
  return isAbsolute(configured) ? resolve(configured) : resolve(base, configured);
}
