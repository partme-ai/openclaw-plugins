/**
 * Bindings（路由规则）管理处理器
 * 管理 Agent 路由规则：哪个客服账号对应哪个 Agent
 *
 * 从原 config.ts 中提取的业务专属功能，
 * 全局配置读写已由 openclaw_management /api/config 承担。
 *
 * 对应端点：
 * - GET /ics/config/bindings  - 获取 bindings 路由规则
 * - PUT /ics/config/bindings  - 更新 bindings 路由规则（自动触发热重载）
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayRuntime } from "../types.js";
import { triggerConfigReload, safeConfigUpdate } from "../utils/config-reload.js";

/**
 * 创建 bindings 路由规则处理器
 *
 * @param runtime - Gateway Runtime 引用
 */
export function createBindingsHandler(
  runtime: GatewayRuntime
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const method = req.method?.toUpperCase() ?? "GET";

    switch (method) {
      case "GET":
        return getBindings(runtime, res);
      case "PUT":
        return updateBindings(runtime, req, res);
      default:
        sendError(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED");
    }
  };
}

/**
 * 获取 bindings 路由规则
 * 读取 openclaw.json 中的 bindings 数组
 *
 * bindings 定义了 channel + peer 到 Agent 的映射关系，
 * 例如哪个企微客服账号（open_kfid）由哪个 Agent 处理。
 */
function getBindings(
  runtime: GatewayRuntime,
  res: ServerResponse
): void {
  const bindings = (runtime.config as Record<string, unknown>).bindings ?? [];
  sendJson(res, bindings);
}

/**
 * 更新 bindings 路由规则
 * 写入 openclaw.json 中的 bindings 字段，并触发 Gateway 热重载
 *
 * @param runtime - Gateway Runtime
 * @param req - HTTP 请求
 * @param res - HTTP 响应
 */
async function updateBindings(
  runtime: GatewayRuntime,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = await parseBody(req);
  const newBindings = body.bindings;

  if (!Array.isArray(newBindings)) {
    sendError(res, 400, "bindings must be an array", "INVALID_BINDINGS");
    return;
  }

  try {
    // 尝试通过 configPath 定位 openclaw.json
    const configPath = resolveConfigPath(runtime);

    if (configPath) {
      // 安全更新 openclaw.json 中的 bindings 字段
      await safeConfigUpdate(configPath, (config) => {
        config.bindings = newBindings;
        return config;
      });

      // 触发 Gateway 热重载
      await triggerConfigReload(runtime);

      sendJson(res, {
        updated: true,
        bindingsCount: newBindings.length,
        message: "Bindings updated and config reload triggered",
      });
    } else {
      // configPath 无法解析时，记录到日志并返回部分成功
      console.warn(
        "[openclaw_ics] Cannot resolve config file path for bindings update. " +
        "Relying on Gateway file watcher for reload."
      );

      sendJson(res, {
        updated: false,
        message: "Config file path not available. Please update openclaw.json manually.",
      });
    }
  } catch (error) {
    console.error("[openclaw_ics] Bindings update failed:", error);
    sendError(res, 500, "Failed to update bindings", "UPDATE_FAILED");
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
    // openclaw.json 通常与 workspace 同级
    const { join, dirname } = require("node:path");
    return join(dirname(workspace), "openclaw.json");
  }

  return null;
}

/** 发送 JSON 成功响应 */
function sendJson(res: ServerResponse, data: unknown, statusCode = 200): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, data }));
}

/** 发送错误响应 */
function sendError(
  res: ServerResponse,
  statusCode: number,
  error: string,
  code: string
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error, code }));
}

/** 解析请求体 JSON */
function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}
