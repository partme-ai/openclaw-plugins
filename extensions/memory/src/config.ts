import { Buffer } from "node:buffer";
import * as path from "node:path";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export interface MemoryConfig {
  enabled: boolean;
  dataDir: string;
  maxSearchResults: number;
  retentionDays: number;
  extractionInterval: number;
  maxRecordBytes: number;
  profileScope: "session" | "agent";
  encryptionKeyEnv?: string;
}

const DEFAULTS: MemoryConfig = {
  enabled: true,
  dataDir: "~/.openclaw/state/memory",
  maxSearchResults: 10,
  retentionDays: 90,
  extractionInterval: 5,
  maxRecordBytes: 64 * 1024,
  profileScope: "session",
};

function boundedInteger(
  value: unknown,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`[memory] ${name} must be an integer between ${min} and ${max}`);
  }
  return value as number;
}

export function resolveConfig(api: Pick<OpenClawPluginApi, "pluginConfig">): MemoryConfig {
  const raw = (api.pluginConfig ?? {}) as Partial<MemoryConfig>;
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
    throw new Error("[memory] enabled must be a boolean");
  }
  if (raw.dataDir !== undefined && (typeof raw.dataDir !== "string" || !raw.dataDir.trim())) {
    throw new Error("[memory] dataDir must be a non-empty string");
  }
  const configuredDir = raw.dataDir?.trim() || DEFAULTS.dataDir;
  const dataDir = configuredDir === "~" || configuredDir.startsWith("~/")
    ? path.join(process.env.HOME ?? process.cwd(), configuredDir.slice(2))
    : path.resolve(configuredDir);
  if (
    raw.encryptionKeyEnv !== undefined &&
    (typeof raw.encryptionKeyEnv !== "string" || !raw.encryptionKeyEnv.trim())
  ) {
    throw new Error("[memory] encryptionKeyEnv must be a non-empty string");
  }
  const encryptionKeyEnv = raw.encryptionKeyEnv?.trim();

  if (encryptionKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(encryptionKeyEnv)) {
    throw new Error("[memory] encryptionKeyEnv must be a valid environment variable name");
  }
  if (encryptionKeyEnv && !process.env[encryptionKeyEnv]) {
    throw new Error(`[memory] encryption key environment variable ${encryptionKeyEnv} is not set`);
  }
  if (
    encryptionKeyEnv &&
    Buffer.byteLength(process.env[encryptionKeyEnv] ?? "", "utf8") < 32
  ) {
    throw new Error(`[memory] encryption key environment variable ${encryptionKeyEnv} must contain at least 32 bytes`);
  }
  if (raw.profileScope !== undefined && raw.profileScope !== "session" && raw.profileScope !== "agent") {
    throw new Error("[memory] profileScope must be session or agent");
  }

  return {
    enabled: raw.enabled !== false,
    dataDir,
    maxSearchResults: boundedInteger(raw.maxSearchResults, "maxSearchResults", DEFAULTS.maxSearchResults, 1, 100),
    retentionDays: boundedInteger(raw.retentionDays, "retentionDays", DEFAULTS.retentionDays, 1, 3650),
    extractionInterval: boundedInteger(raw.extractionInterval, "extractionInterval", DEFAULTS.extractionInterval, 1, 100),
    maxRecordBytes: boundedInteger(raw.maxRecordBytes, "maxRecordBytes", DEFAULTS.maxRecordBytes, 1024, 1024 * 1024),
    profileScope: raw.profileScope ?? DEFAULTS.profileScope,
    ...(encryptionKeyEnv ? { encryptionKeyEnv } : {}),
  };
}
