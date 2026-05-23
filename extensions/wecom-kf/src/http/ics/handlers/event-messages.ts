/**
 * 【可选运营模块 — ICS】事件消息配置处理器
 *
 * 不属于 KF 消息收发核心；仅在 `channels.wecom-kf.icsEnabled=true` 时注册。
 * 管理欢迎语、结束语、满意度评价内容
 *
 * 对应端点：
 * - GET /ics/config/event-messages             — 获取渠道默认事件消息配置
 * - PUT /ics/config/event-messages             — 更新渠道默认配置
 * - GET /ics/config/event-messages/:accountId  — 获取账号级配置
 * - PUT /ics/config/event-messages/:accountId  — 更新账号级配置
 * - DELETE /ics/config/event-messages/:accountId — 删除账号级覆盖（回退到默认）
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayRuntime, EventMessagesConfig } from "../../../types/compat.js";
import { triggerConfigReload, safeConfigUpdate } from "../storage/config-reload.js";

/**
 * 创建事件消息配置处理器
 *
 * @param runtime - Gateway Runtime 引用
 */
export function createEventMessagesHandler(
  runtime: GatewayRuntime
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method?.toUpperCase() ?? "GET";

    // 提取账号 ID
    const accountIdMatch = url.match(/\/event-messages\/([^/]+)$/);
    const accountId = accountIdMatch?.[1];

    // 账号级事件消息配置
    if (accountId) {
      switch (method) {
        case "GET":
          return getAccountEventMessages(runtime, accountId, res);
        case "PUT":
          return updateAccountEventMessages(runtime, accountId, req, res);
        case "DELETE":
          return deleteAccountEventMessages(runtime, accountId, res);
        default:
          sendError(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED");
          return;
      }
    }

    // 渠道默认事件消息配置
    switch (method) {
      case "GET":
        return getChannelEventMessages(runtime, res);
      case "PUT":
        return updateChannelEventMessages(runtime, req, res);
      default:
        sendError(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED");
    }
  };
}

/**
 * 获取渠道默认事件消息配置
 * 读取 channels.wecom-kf.eventMessages
 */
function getChannelEventMessages(
  runtime: GatewayRuntime,
  res: ServerResponse
): void {
  const channelCfg = getWecomKfConfig(runtime);
  const eventMessages = channelCfg?.eventMessages as EventMessagesConfig | undefined;
  sendJson(res, eventMessages ?? {});
}

/**
 * 更新渠道默认事件消息配置
 * 写入 channels.wecom-kf.eventMessages → 触发热重载
 *
 * 逻辑：
 * 1. 解析请求体中的 eventMessages 配置
 * 2. 通过 safeConfigUpdate 安全地写入 openclaw.json 的 channels.wecom-kf.eventMessages
 * 3. 触发 Gateway 配置热重载
 */
async function updateChannelEventMessages(
  runtime: GatewayRuntime,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = await parseBody(req);

  try {
    const configPath = resolveConfigPath(runtime);

    if (!configPath) {
      sendError(res, 500, "Cannot resolve config file path", "CONFIG_PATH_NOT_FOUND");
      return;
    }

    // 安全更新 channels.wecom-kf.eventMessages
    await safeConfigUpdate(configPath, (config) => {
      const channels = (config.channels ?? {}) as Record<string, Record<string, unknown>>;
      const wecomKf = channels["wecom-kf"] ?? {};
      wecomKf.eventMessages = body;
      channels["wecom-kf"] = wecomKf;
      config.channels = channels;
      return config;
    });

    // 触发 Gateway 热重载
    await triggerConfigReload(runtime);

    console.log("[openclaw_ics] Channel event messages updated successfully");
    sendJson(res, {
      updated: true,
      message: "Channel event messages updated and config reload triggered",
    });
  } catch (error) {
    console.error("[openclaw_ics] Channel event messages update failed:", error);
    sendError(res, 500, "Failed to update channel event messages", "UPDATE_FAILED");
  }
}

/**
 * 获取账号级事件消息配置
 * 读取 channels.wecom-kf.accounts[accountId].eventMessages
 */
function getAccountEventMessages(
  runtime: GatewayRuntime,
  accountId: string,
  res: ServerResponse
): void {
  const channelCfg = getWecomKfConfig(runtime);
  const accounts = channelCfg?.accounts as Record<string, Record<string, unknown>> | undefined;
  const accountCfg = accounts?.[accountId];
  const eventMessages = accountCfg?.eventMessages as EventMessagesConfig | undefined;
  sendJson(res, eventMessages ?? {});
}

/**
 * 更新账号级事件消息配置
 * 写入 channels.wecom-kf.accounts[accountId].eventMessages → 触发热重载
 *
 * 逻辑：
 * 1. 解析请求体中的 eventMessages 配置
 * 2. 通过 safeConfigUpdate 写入 channels.wecom-kf.accounts[accountId].eventMessages
 * 3. 如果 accounts 或 accounts[accountId] 不存在，自动创建
 * 4. 触发 Gateway 配置热重载
 */
async function updateAccountEventMessages(
  runtime: GatewayRuntime,
  accountId: string,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = await parseBody(req);

  try {
    const configPath = resolveConfigPath(runtime);

    if (!configPath) {
      sendError(res, 500, "Cannot resolve config file path", "CONFIG_PATH_NOT_FOUND");
      return;
    }

    // 安全更新 channels.wecom-kf.accounts[accountId].eventMessages
    await safeConfigUpdate(configPath, (config) => {
      const channels = (config.channels ?? {}) as Record<string, Record<string, unknown>>;
      const wecomKf = channels["wecom-kf"] ?? {};
      const accounts = (wecomKf.accounts ?? {}) as Record<string, Record<string, unknown>>;
      const account = accounts[accountId] ?? {};

      account.eventMessages = body;
      accounts[accountId] = account;
      wecomKf.accounts = accounts;
      channels["wecom-kf"] = wecomKf;
      config.channels = channels;
      return config;
    });

    // 触发 Gateway 热重载
    await triggerConfigReload(runtime);

    console.log(`[openclaw_ics] Account ${accountId} event messages updated successfully`);
    sendJson(res, {
      accountId,
      updated: true,
      message: "Account event messages updated and config reload triggered",
    });
  } catch (error) {
    console.error(`[openclaw_ics] Account ${accountId} event messages update failed:`, error);
    sendError(res, 500, "Failed to update account event messages", "UPDATE_FAILED");
  }
}

/**
 * 删除账号级事件消息覆盖
 * 删除后回退到渠道默认配置
 *
 * 逻辑：
 * 1. 通过 safeConfigUpdate 删除 channels.wecom-kf.accounts[accountId].eventMessages 字段
 * 2. 如果账号下没有其他配置，清理空的 account 对象
 * 3. 触发 Gateway 配置热重载
 */
async function deleteAccountEventMessages(
  runtime: GatewayRuntime,
  accountId: string,
  res: ServerResponse
): Promise<void> {
  try {
    const configPath = resolveConfigPath(runtime);

    if (!configPath) {
      sendError(res, 500, "Cannot resolve config file path", "CONFIG_PATH_NOT_FOUND");
      return;
    }

    // 安全删除 channels.wecom-kf.accounts[accountId].eventMessages
    await safeConfigUpdate(configPath, (config) => {
      const channels = (config.channels ?? {}) as Record<string, Record<string, unknown>>;
      const wecomKf = channels["wecom-kf"];

      if (wecomKf) {
        const accounts = (wecomKf.accounts ?? {}) as Record<string, Record<string, unknown>>;
        const account = accounts[accountId];

        if (account) {
          // 删除 eventMessages 字段
          delete account.eventMessages;

          // 如果账号对象为空，删除整个账号条目
          if (Object.keys(account).length === 0) {
            delete accounts[accountId];
          }

          wecomKf.accounts = accounts;
          channels["wecom-kf"] = wecomKf;
          config.channels = channels;
        }
      }

      return config;
    });

    // 触发 Gateway 热重载
    await triggerConfigReload(runtime);

    console.log(
      `[openclaw_ics] Account ${accountId} event messages deleted (fallback to channel default)`
    );
    sendJson(res, {
      accountId,
      deleted: true,
      message: "Account event messages deleted, falling back to channel defaults",
    });
  } catch (error) {
    console.error(`[openclaw_ics] Account ${accountId} event messages delete failed:`, error);
    sendError(res, 500, "Failed to delete account event messages", "DELETE_FAILED");
  }
}

/**
 * 解析 openclaw.json 配置文件路径
 * 从 runtime.config 中尝试获取配置文件位置
 *
 * @param runtime - Gateway Runtime
 * @returns 配置文件路径（如果可用）
 */
function resolveConfigPath(runtime: GatewayRuntime): string | null {
  const config = runtime.config as Record<string, unknown>;

  // 尝试从 config 中获取路径信息
  if (typeof config._configPath === "string") {
    return config._configPath;
  }

  if (typeof config.configFile === "string") {
    return config.configFile;
  }

  // 尝试从 agents.defaults.workspace 推导
  const agents = config.agents as Record<string, unknown> | undefined;
  const defaults = agents?.defaults as Record<string, unknown> | undefined;
  const workspace = defaults?.workspace as string | undefined;
  if (workspace) {
    const { join, dirname } = require("node:path");
    return join(dirname(workspace), "openclaw.json");
  }

  return null;
}

/**
 * 获取 wecom-kf 渠道配置
 */
function getWecomKfConfig(
  runtime: GatewayRuntime
): Record<string, unknown> | undefined {
  const channels = (runtime.config as Record<string, Record<string, unknown>>).channels;
  return channels?.["wecom-kf"] as Record<string, unknown> | undefined;
}

/** 辅助函数 */
function sendJson(res: ServerResponse, data: unknown, statusCode = 200): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, data }));
}

function sendError(res: ServerResponse, statusCode: number, error: string, code: string): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error, code }));
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}
