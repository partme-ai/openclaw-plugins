/**
 * @module mcp/config-fetch
 *
 * 企微 **doc MCP 配置** 自动发现与持久化。
 *
 * **职责**：
 * - 通过 WSClient `aibot_get_mcp_config` 拉取 doc 品类 MCP URL
 * - 写入 state 目录 `wecomConfig/config.json`（按 account 分桶）
 * - 供离线/重启后快速恢复 MCP 端点信息
 *
 * 来源：openclaw-china/wecom mcp-config 实现。
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { WSClient } from "@wecom/aibot-node-sdk";

import { resolveStateDir } from "../state/state-dir-resolve.js";
import { withTimeout } from "../shared/timeout.js";

type WecomRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

type McpConfigResponse = {
  errcode?: number;
  errmsg?: string;
  body?: unknown;
};

type PersistedDocConfig = {
  type: string;
  url: string;
};

type PersistedWecomMcpAccountConfig = {
  fetchedAt?: string;
  isAuthed?: boolean;
  mcpConfig?: {
    doc?: PersistedDocConfig;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type PersistedWecomMcpFile = {
  updatedAt?: string;
  mcpConfig?: {
    doc?: PersistedDocConfig;
    [key: string]: unknown;
  };
  accounts?: Record<string, PersistedWecomMcpAccountConfig>;
  [key: string]: unknown;
};

/** 内存中的 doc MCP 配置快照 */
export interface WecomDocMcpConfig {
  bizType: "doc";
  url: string;
  type: string;
  isAuthed?: boolean;
  fetchedAt: number;
}

const DOC_BIZ_TYPE = "doc";
const DEFAULT_DOC_MCP_TYPE = "streamable-http";
const MCP_GET_CONFIG_CMD = "aibot_get_mcp_config";
const MCP_FETCH_TIMEOUT_MS = 5_000;
const writeQueues = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 解析持久化 MCP 配置文件路径 */
export function resolveWecomMcpConfigPath(): string {
  return path.join(resolveStateDir(), "wecomConfig", "config.json");
}

function readResponseField(body: unknown, key: string): string | undefined {
  if (!isRecord(body)) return undefined;
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readResponseBoolean(body: unknown, key: string): boolean | undefined {
  if (!isRecord(body)) return undefined;
  const value = body[key];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * 从企微服务端拉取 doc MCP 配置。
 *
 * @param client - 已连接的 WSClient
 */
export async function fetchWecomDocMcpConfig(client: WSClient): Promise<WecomDocMcpConfig> {
  const reqId = randomUUID();
  const response = await withTimeout(
    client.reply(
      {
        headers: {
          req_id: reqId,
        },
      },
      { biz_type: DOC_BIZ_TYPE },
      MCP_GET_CONFIG_CMD
    ) as Promise<McpConfigResponse>,
    MCP_FETCH_TIMEOUT_MS,
    `WeCom doc MCP config fetch timed out after ${MCP_FETCH_TIMEOUT_MS}ms`
  );

  if (typeof response.errcode === "number" && response.errcode !== 0) {
    throw new Error(`WeCom doc MCP config request failed: ${response.errcode} ${response.errmsg ?? ""}`.trim());
  }

  const url = readResponseField(response.body, "url");
  if (!url) {
    throw new Error("WeCom doc MCP config response missing url");
  }

  return {
    bizType: DOC_BIZ_TYPE,
    url,
    type: readResponseField(response.body, "type") ?? DEFAULT_DOC_MCP_TYPE,
    isAuthed: readResponseBoolean(response.body, "is_authed"),
    fetchedAt: Date.now(),
  };
}

async function readPersistedConfig(filePath: string): Promise<PersistedWecomMcpFile> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? (parsed as PersistedWecomMcpFile) : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    return {};
  }
}

async function writePersistedConfig(filePath: string, data: PersistedWecomMcpFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tempPath, payload, "utf8");
  await fs.rename(tempPath, filePath);
}

/** 同路径串行写，避免并发写 config.json 损坏 */
async function serializeWrite(filePath: string, action: () => Promise<void>): Promise<void> {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  writeQueues.set(filePath, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(filePath) === next) {
      writeQueues.delete(filePath);
    }
  }
}

/**
 * 将 doc MCP 配置合并写入持久化文件（按 accountId）。
 */
export async function saveWecomDocMcpConfig(params: {
  accountId: string;
  config: WecomDocMcpConfig;
}): Promise<void> {
  const filePath = resolveWecomMcpConfigPath();
  const docConfig: PersistedDocConfig = {
    type: params.config.type || DEFAULT_DOC_MCP_TYPE,
    url: params.config.url,
  };

  await serializeWrite(filePath, async () => {
    const current = await readPersistedConfig(filePath);
    const currentAccounts = isRecord(current.accounts)
      ? (current.accounts as Record<string, PersistedWecomMcpAccountConfig>)
      : {};
    const existingAccount = isRecord(currentAccounts[params.accountId])
      ? (currentAccounts[params.accountId] as PersistedWecomMcpAccountConfig)
      : {};
    const existingAccountMcpConfig = isRecord(existingAccount.mcpConfig)
      ? (existingAccount.mcpConfig as Record<string, unknown>)
      : {};

    current.updatedAt = new Date(params.config.fetchedAt).toISOString();
    current.mcpConfig = {
      ...(isRecord(current.mcpConfig) ? current.mcpConfig : {}),
      doc: docConfig,
    };
    current.accounts = {
      ...currentAccounts,
      [params.accountId]: {
        ...existingAccount,
        fetchedAt: new Date(params.config.fetchedAt).toISOString(),
        isAuthed: params.config.isAuthed,
        mcpConfig: {
          ...existingAccountMcpConfig,
          doc: docConfig,
        },
      },
    };

    await writePersistedConfig(filePath, current);
  });
}

/**
 * 拉取并持久化 doc MCP 配置（失败时仅打日志，不抛给调用方）。
 */
export async function fetchAndSaveWecomDocMcpConfig(params: {
  client: WSClient;
  accountId: string;
  runtime?: WecomRuntimeEnv;
}): Promise<void> {
  try {
    const config = await fetchWecomDocMcpConfig(params.client);
    await saveWecomDocMcpConfig({
      accountId: params.accountId,
      config,
    });
    params.runtime?.log?.(
      `[wecom] doc MCP config saved for account ${params.accountId} at ${resolveWecomMcpConfigPath()}`
    );
  } catch (error) {
    params.runtime?.error?.(
      `[wecom] failed to fetch/save doc MCP config for account ${params.accountId}: ${String(error)}`
    );
  }
}
