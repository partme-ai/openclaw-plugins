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

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`[router] ${field} must be a non-empty string`);
  }
  return value.trim();
}

function stringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`[router] ${field} must be an array`);
  return value.map((item, index) => nonEmpty(item, `${field}[${index}]`));
}

function resolveAction(value: unknown, field: string): RouteAction {
  if (!value || typeof value !== "object") throw new Error(`[router] ${field} must be an object`);
  const action = value as Record<string, unknown>;
  const type = action.type;
  const target = nonEmpty(action.target, `${field}.target`);
  if (type === "forward") {
    return { type, target, ...(action.topic === undefined ? {} : { topic: nonEmpty(action.topic, `${field}.topic`) }) };
  }
  if (type === "reply-via") {
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
  if (!value || typeof value !== "object") throw new Error(`[router] rules[${index}] must be an object`);
  const rule = value as Record<string, unknown>;
  const match = rule.match && typeof rule.match === "object"
    ? rule.match as Record<string, unknown>
    : {};
  const direction = match.direction;
  if (direction !== undefined && !["inbound", "outbound", "both"].includes(String(direction))) {
    throw new Error(`[router] rules[${index}].match.direction is invalid`);
  }
  if (!Array.isArray(rule.actions) || rule.actions.length === 0) {
    throw new Error(`[router] rules[${index}].actions must contain at least one action`);
  }
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

export function resolveRouterConfig(api: OpenClawPluginApi): RouterConfig {
  const raw = (api.pluginConfig ?? {}) as Record<string, unknown>;
  const audit = raw.audit && typeof raw.audit === "object" ? raw.audit as Record<string, unknown> : {};
  const delivery = raw.delivery && typeof raw.delivery === "object" ? raw.delivery as Record<string, unknown> : {};
  const rules = Array.isArray(raw.rules) ? raw.rules.map(resolveRule) : [];
  const duplicateIds = rules.map((rule) => rule.id).filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) throw new Error(`[router] duplicate rule id(s): ${[...new Set(duplicateIds)].join(", ")}`);
  const lockHeartbeatMs = Math.floor(finiteNumber(delivery.lockHeartbeatMs, DEFAULTS.delivery.lockHeartbeatMs, 1_000, 60_000));
  const lockTimeoutMs = Math.floor(finiteNumber(delivery.lockTimeoutMs, DEFAULTS.delivery.lockTimeoutMs, 5_000, 300_000));
  if (lockTimeoutMs < lockHeartbeatMs * 2) throw new Error("[router] delivery.lockTimeoutMs must be at least twice lockHeartbeatMs");
  return {
    enabled: raw.enabled !== false,
    rules,
    audit: {
      enabled: audit.enabled !== false,
      logToConsole: audit.logToConsole === true,
      maxEntries: Math.floor(finiteNumber(audit.maxEntries, DEFAULTS.audit.maxEntries, 100, 100_000)),
    },
    delivery: {
      ...(typeof delivery.stateDir === "string" && delivery.stateDir.trim() ? { stateDir: delivery.stateDir.trim() } : {}),
      maxAttempts: Math.floor(finiteNumber(delivery.maxAttempts, DEFAULTS.delivery.maxAttempts, 1, 100)),
      initialDelayMs: Math.floor(finiteNumber(delivery.initialDelayMs, DEFAULTS.delivery.initialDelayMs, 10, 3_600_000)),
      maxDelayMs: Math.floor(finiteNumber(delivery.maxDelayMs, DEFAULTS.delivery.maxDelayMs, 10, 86_400_000)),
      backoffMultiplier: finiteNumber(delivery.backoffMultiplier, DEFAULTS.delivery.backoffMultiplier, 1, 10),
      jitter: finiteNumber(delivery.jitter, DEFAULTS.delivery.jitter, 0, 1),
      dedupeTtlMs: Math.floor(finiteNumber(delivery.dedupeTtlMs, DEFAULTS.delivery.dedupeTtlMs, 1_000, 30 * 86_400_000)),
      maxDeliveredKeys: Math.floor(finiteNumber(delivery.maxDeliveredKeys, DEFAULTS.delivery.maxDeliveredKeys, 100, 1_000_000)),
      maxDeadLetters: Math.floor(finiteNumber(delivery.maxDeadLetters, DEFAULTS.delivery.maxDeadLetters, 100, 1_000_000)),
      maxPendingTasks: Math.floor(finiteNumber(delivery.maxPendingTasks, DEFAULTS.delivery.maxPendingTasks, 100, 1_000_000)),
      maxPayloadBytes: Math.floor(finiteNumber(delivery.maxPayloadBytes, DEFAULTS.delivery.maxPayloadBytes, 1_024, 16_777_216)),
      maxHops: Math.floor(finiteNumber(delivery.maxHops, DEFAULTS.delivery.maxHops, 1, 64)),
      publishTimeoutMs: Math.floor(finiteNumber(delivery.publishTimeoutMs, DEFAULTS.delivery.publishTimeoutMs, 100, 300_000)),
      concurrency: Math.floor(finiteNumber(delivery.concurrency, DEFAULTS.delivery.concurrency, 1, 64)),
      lockHeartbeatMs,
      lockTimeoutMs,
    },
  };
}

export function resolveRouterStateDir(config: RouterConfig): string {
  const base = process.env.OPENCLAW_STATE_DIR?.trim() || join(homedir(), ".openclaw");
  const configured = config.delivery.stateDir;
  if (!configured) return join(base, "router");
  return isAbsolute(configured) ? resolve(configured) : resolve(base, configured);
}
