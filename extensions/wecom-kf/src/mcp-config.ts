/**
 * MCP 配置拉取与持久化模块
 *
 * 负责:
 * - 通过 WSClient 发送 aibot_get_mcp_config 请求
 * - 解析服务端响应，提取 MCP 配置 (url、type、is_authed)
 * - 将配置写入 ~/.openclaw/wecomKfConfig/config.json 的 mcpConfig 字段
 */

import fs from "node:fs";
import { promises as fsp } from "node:fs";
import os from "os";
import path from "path";
import type { WSClient } from "@wecom/aibot-node-sdk";
import { generateReqId } from "@wecom/aibot-node-sdk";
import type { WecomRuntimeEnv } from "./legacy/monitor/types.js";
import { withTimeout } from "./timeout.js";

// ============================================================================
// 常量
// ============================================================================

/** 获取 MCP 配置的 WebSocket 命令 */
const MCP_GET_CONFIG_CMD = "aibot_get_mcp_config";

/** MCP 配置拉取超时时间（毫秒） */
const MCP_CONFIG_FETCH_TIMEOUT_MS = 15_000;

// ============================================================================
// 类型
// ============================================================================

/**
 * MCP 配置响应体
 */
export interface McpConfigBody {
    /** MCP Server 的 StreamableHttp URL */
    url: string;
    /** 连接类型，如 "doc" */
    type?: string;
    /** 是否已授权 */
    is_authed?: boolean;
}

// ============================================================================
// MCP 配置拉取
// ============================================================================

/**
 * 通过 WSClient 发送 aibot_get_mcp_config 命令，获取 MCP 配置
 *
 * @param wsClient - 已认证的 WSClient 实例
 * @returns MCP 配置 (url、type、is_authed)
 * @throws 响应错误码非 0 或缺少 url 字段时抛出错误
 */
export async function fetchMcpConfig(
    wsClient: WSClient,
): Promise<McpConfigBody> {
    const reqId = generateReqId("mcp_config");

    // 通过 reply 方法发送自定义命令
    const response = await withTimeout(
        wsClient.reply(
            { headers: { req_id: reqId } },
            { biz_type: "doc" },
            MCP_GET_CONFIG_CMD,
        ),
        MCP_CONFIG_FETCH_TIMEOUT_MS,
        `MCP config fetch timed out after ${MCP_CONFIG_FETCH_TIMEOUT_MS}ms`,
    );

    // 校验响应错误码
    if (response.errcode && response.errcode !== 0) {
        throw new Error(
            `MCP config request failed: errcode=${response.errcode}, errmsg=${response.errmsg ?? "unknown"}`,
        );
    }

    // 提取并校验 body
    const body = response.body as McpConfigBody | undefined;
    if (!body?.url) {
        throw new Error(
            "MCP config response missing required 'url' field",
        );
    }

    return {
        url: body.url,
        type: "doc",
        is_authed: body.is_authed,
    };
}

// ============================================================================
// 配置持久化
// ============================================================================

const WECOM_KF_CONFIG_DIR = "wecomKfConfig";
const LEGACY_WECOM_CS_CONFIG_DIR = "wecomCsConfig";

/** 同路径串行写，避免并发写 config.json 损坏 */
const writeQueues = new Map<string, Promise<void>>();

function resolveWecomKfConfigWritePath(): string {
    return path.join(os.homedir(), ".openclaw", WECOM_KF_CONFIG_DIR, "config.json");
}

function resolveWecomKfConfigReadPath(): string {
    const primaryPath = resolveWecomKfConfigWritePath();
    if (fs.existsSync(primaryPath)) {
        return primaryPath;
    }
    const legacyPath = path.join(os.homedir(), ".openclaw", LEGACY_WECOM_CS_CONFIG_DIR, "config.json");
    if (fs.existsSync(legacyPath)) {
        console.warn(
            "[wecom-kf] ~/.openclaw/wecomCsConfig is deprecated; migrate to ~/.openclaw/wecomKfConfig",
        );
        return legacyPath;
    }
    return primaryPath;
}

/**
 * 读取 JSON 配置文件；不存在时返回 fallback。
 */
async function readJsonFileWithFallback<T>(
    filePath: string,
    fallback: T,
): Promise<{ value: T; exists: boolean }> {
    try {
        const raw = await fsp.readFile(filePath, "utf-8");
        return { value: JSON.parse(raw) as T, exists: true };
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return { value: fallback, exists: false };
        }
        return { value: fallback, exists: false };
    }
}

/**
 * 原子写入 JSON 配置文件。
 */
async function writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
    await fsp.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const content = `${JSON.stringify(value, null, 2)}\n`;
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    await fsp.writeFile(tmpPath, content, { mode: 0o600 });
    await fsp.rename(tmpPath, filePath);
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
 * 将 MCP 配置写入 ~/.openclaw/wecomKfConfig/config.json 的 mcpConfig 字段
 *
 * 使用 Node.js 原子写入与路径级串行队列，保证并发安全。
 * 配置格式: { mcpConfig: { [type]: { type, url } } }
 */
async function saveMcpConfigToPluginJson(
    config: McpConfigBody,
    runtime: WecomRuntimeEnv,
): Promise<void> {
    const wecomConfigPath = resolveWecomKfConfigWritePath();

    await serializeWrite(wecomConfigPath, async () => {
        const { value: pluginJson } = await readJsonFileWithFallback<Record<string, unknown>>(
            wecomConfigPath,
            {},
        );

        if (!pluginJson.mcpConfig || typeof pluginJson.mcpConfig !== "object") {
            pluginJson.mcpConfig = {};
        }

        const typeKey = config.type || "default";
        (pluginJson.mcpConfig as Record<string, unknown>)[typeKey] = {
            type: config.type,
            url: config.url,
        };

        await writeJsonFileAtomically(wecomConfigPath, pluginJson);

        runtime.log?.(`[WeCom KF] MCP config saved to ${wecomConfigPath}`);
    });
}

// ============================================================================
// 组合入口
// ============================================================================

/**
 * 拉取 MCP 配置并持久化到 ~/.openclaw/wecomKfConfig/config.json
 *
 * 认证成功后调用。失败仅记录日志，不影响 WebSocket 消息正常收发。
 *
 * @param wsClient - 已认证的 WSClient 实例
 * @param accountId - 账户 ID（用于日志）
 * @param runtime - 运行时环境（用于日志）
 */
export async function fetchAndSaveMcpConfig(
    wsClient: WSClient,
    accountId: string,
    runtime: WecomRuntimeEnv,
): Promise<void> {
    try {
        runtime.log?.(`[${accountId}] Fetching MCP config...`);

        const config = await fetchMcpConfig(wsClient);
        runtime.log?.(
            `[${accountId}] MCP config fetched: url=${config.url}, type=${config.type ?? "N/A"}, is_authed=${config.is_authed ?? "N/A"}`,
        );

        await saveMcpConfigToPluginJson(config, runtime);
    } catch (err) {
        runtime.error?.(
            `[${accountId}] Failed to fetch/save MCP config: ${String(err)}`,
        );
    }
}
