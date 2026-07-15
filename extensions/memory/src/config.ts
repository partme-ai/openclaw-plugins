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

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function resolveConfig(api: Pick<OpenClawPluginApi, "pluginConfig">): MemoryConfig {
  const raw = (api.pluginConfig ?? {}) as Partial<MemoryConfig>;
  const configuredDir = typeof raw.dataDir === "string" && raw.dataDir.trim()
    ? raw.dataDir.trim()
    : DEFAULTS.dataDir;
  const dataDir = configuredDir === "~" || configuredDir.startsWith("~/")
    ? path.join(process.env.HOME ?? process.cwd(), configuredDir.slice(2))
    : path.resolve(configuredDir);
  const encryptionKeyEnv = typeof raw.encryptionKeyEnv === "string"
    ? raw.encryptionKeyEnv.trim()
    : undefined;

  if (encryptionKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(encryptionKeyEnv)) {
    throw new Error("[memory] encryptionKeyEnv must be a valid environment variable name");
  }
  if (encryptionKeyEnv && !process.env[encryptionKeyEnv]) {
    throw new Error(`[memory] encryption key environment variable ${encryptionKeyEnv} is not set`);
  }
  if (raw.profileScope !== undefined && raw.profileScope !== "session" && raw.profileScope !== "agent") {
    throw new Error("[memory] profileScope must be session or agent");
  }

  return {
    enabled: raw.enabled !== false,
    dataDir,
    maxSearchResults: boundedInteger(raw.maxSearchResults, DEFAULTS.maxSearchResults, 1, 100),
    retentionDays: boundedInteger(raw.retentionDays, DEFAULTS.retentionDays, 1, 3650),
    extractionInterval: boundedInteger(raw.extractionInterval, DEFAULTS.extractionInterval, 1, 100),
    maxRecordBytes: boundedInteger(raw.maxRecordBytes, DEFAULTS.maxRecordBytes, 1024, 1024 * 1024),
    profileScope: raw.profileScope ?? DEFAULTS.profileScope,
    ...(encryptionKeyEnv ? { encryptionKeyEnv } : {}),
  };
}
