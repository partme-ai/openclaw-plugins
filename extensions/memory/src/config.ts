/**
 * 本地 Memory 插件的严格配置解析层。
 *
 * 这里集中处理路径展开、数值硬边界与加密密钥环境变量；解析结果供存储和检索共享，
 * 避免各层各自使用默认值导致保留期、记录大小或租户范围不一致。
 */
import { Buffer } from "node:buffer";
import * as path from "node:path";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

/**
 * 本地 Memory 存储、抽取和召回的完整运行时配置。
 * `profileScope=agent` 会允许同一 Agent 跨会话召回 L3，因此必须由管理员显式选择。
 */
export interface MemoryConfig {
  enabled: boolean;
  dataDir: string;
  maxSearchResults: number;
  /** 单次词法搜索最多顺序读取的 JSONL 字节数，防止历史文件拖垮 Agent Hook。 */
  maxSearchBytes: number;
  /** Memory Host 单次 readFile 最多返回的解码记录行数。 */
  maxReadLines: number;
  retentionDays: number;
  extractionInterval: number;
  maxRecordBytes: number;
  profileScope: "session" | "agent";
  autoRecall: boolean;
  autoRecallMaxResults: number;
  autoRecallMaxChars: number;
  autoRecallTimeoutMs: number;
  encryptionKeyEnv?: string;
}

const DEFAULTS: MemoryConfig = {
  enabled: true,
  dataDir: "~/.openclaw/state/memory",
  maxSearchResults: 10,
  maxSearchBytes: 16 * 1024 * 1024,
  maxReadLines: 200,
  retentionDays: 90,
  extractionInterval: 5,
  maxRecordBytes: 64 * 1024,
  profileScope: "session",
  autoRecall: true,
  autoRecallMaxResults: 5,
  autoRecallMaxChars: 4_000,
  autoRecallTimeoutMs: 1_000,
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

/**
 * 解析并冻结各层共享的 Memory 配置语义。
 * 路径会展开为绝对路径；数值均有硬上下限；启用加密时只保存环境变量名，不把密钥写入配置。
 */
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
  if (raw.autoRecall !== undefined && typeof raw.autoRecall !== "boolean") {
    throw new Error("[memory] autoRecall must be a boolean");
  }

  return {
    enabled: raw.enabled !== false,
    dataDir,
    maxSearchResults: boundedInteger(raw.maxSearchResults, "maxSearchResults", DEFAULTS.maxSearchResults, 1, 100),
    maxSearchBytes: boundedInteger(
      raw.maxSearchBytes,
      "maxSearchBytes",
      DEFAULTS.maxSearchBytes,
      1024 * 1024,
      256 * 1024 * 1024,
    ),
    maxReadLines: boundedInteger(raw.maxReadLines, "maxReadLines", DEFAULTS.maxReadLines, 1, 2_000),
    retentionDays: boundedInteger(raw.retentionDays, "retentionDays", DEFAULTS.retentionDays, 1, 3650),
    extractionInterval: boundedInteger(raw.extractionInterval, "extractionInterval", DEFAULTS.extractionInterval, 1, 100),
    maxRecordBytes: boundedInteger(raw.maxRecordBytes, "maxRecordBytes", DEFAULTS.maxRecordBytes, 1024, 1024 * 1024),
    profileScope: raw.profileScope ?? DEFAULTS.profileScope,
    autoRecall: raw.autoRecall !== false,
    autoRecallMaxResults: boundedInteger(
      raw.autoRecallMaxResults,
      "autoRecallMaxResults",
      DEFAULTS.autoRecallMaxResults,
      1,
      10,
    ),
    autoRecallMaxChars: boundedInteger(
      raw.autoRecallMaxChars,
      "autoRecallMaxChars",
      DEFAULTS.autoRecallMaxChars,
      256,
      16_000,
    ),
    autoRecallTimeoutMs: boundedInteger(
      raw.autoRecallTimeoutMs,
      "autoRecallTimeoutMs",
      DEFAULTS.autoRecallTimeoutMs,
      50,
      5_000,
    ),
    ...(encryptionKeyEnv ? { encryptionKeyEnv } : {}),
  };
}
