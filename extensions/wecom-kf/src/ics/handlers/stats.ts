/**
 * 【可选运营模块 — ICS】运营统计处理器
 *
 * 不属于 KF 消息收发核心；仅在 `channels.wecom-kf.icsEnabled=true` 时注册。
 * 提供聚合统计数据供 SCRM 管理后台展示
 *
 * 数据来源：
 * - OpenClaw 会话文件（sessions.json / JSONL）
 * - Gateway Runtime 的 gatewayCall 接口
 *
 * 缓存策略：
 * - 内存缓存 TTL 60 秒，避免频繁文件读取
 * - 每次请求返回缓存数据或重新采集
 *
 * 对应端点：
 * - GET /ics/stats/overview — 统计概览（会话数、消息数、转人工率等）
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { GatewayRuntime, StatsOverview } from "../../types.js";
import { readJsonlFile, resolveWorkspacePath } from "../utils/file-ops.js";

/** 缓存的统计数据 */
let cachedStats: StatsOverview | null = null;

/** 缓存时间戳 */
let cacheTimestamp = 0;

/** 缓存 TTL（毫秒） */
const CACHE_TTL_MS = 60_000;

/**
 * 创建统计处理器
 *
 * @param runtime - Gateway Runtime 引用
 */
export function createStatsHandler(
  runtime: GatewayRuntime
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const method = req.method?.toUpperCase() ?? "GET";

    if (method !== "GET") {
      sendError(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED");
      return;
    }

    // 聚合统计数据（带缓存）
    const overview = await collectStats(runtime);
    sendJson(res, overview);
  };
}

/**
 * 采集运营统计数据（带缓存）
 * 如果缓存未过期则直接返回，否则重新采集
 *
 * @param runtime - Gateway Runtime
 * @returns 聚合后的统计概览
 */
async function collectStats(
  runtime: GatewayRuntime
): Promise<StatsOverview> {
  const now = Date.now();

  // 检查缓存是否有效
  if (cachedStats && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedStats;
  }

  // 重新采集
  const stats = await doCollectStats(runtime);

  // 更新缓存
  cachedStats = stats;
  cacheTimestamp = now;

  return stats;
}

/**
 * 实际的统计数据采集逻辑
 *
 * 采集策略：
 * 1. 遍历所有 Agent 工作区
 * 2. 读取每个 Agent 的 sessions 目录下的 JSONL 文件
 * 3. 按今日日期过滤会话记录
 * 4. 聚合统计指标
 *
 * @param runtime - Gateway Runtime
 * @returns 聚合后的统计概览
 */
async function doCollectStats(
  runtime: GatewayRuntime
): Promise<StatsOverview> {
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  let todaySessions = 0;
  let todayMessages = 0;
  let transferCount = 0;
  const activeAgentIds = new Set<string>();

  try {
    // 获取 Agent 列表
    const agents = getAgentList(runtime);

    for (const agent of agents) {
      const workspace = agent.workspace;
      if (!workspace) continue;

      const resolvedPath = resolveWorkspacePath(workspace);
      const sessionsDir = join(resolvedPath, "sessions");

      // 读取 sessions 目录下的 JSONL 文件
      const sessionFiles = await listSessionFiles(sessionsDir);

      for (const sessionFile of sessionFiles) {
        const filePath = join(sessionsDir, sessionFile);

        // 读取 JSONL 内容
        const records = await readJsonlFile(filePath);
        if (records.length === 0) continue;

        // 按今日过滤：检查记录中是否有今日的消息
        const todayRecords = records.filter((record) => {
          const timestamp = record.timestamp as string | undefined
            ?? record.created_at as string | undefined
            ?? record.ts as string | undefined;
          return timestamp?.startsWith(today);
        });

        if (todayRecords.length > 0) {
          // 该文件有今日活跃记录
          todaySessions++;
          todayMessages += todayRecords.length;
          activeAgentIds.add(agent.id);

          // 检查是否有转人工事件（service_state 变更为 2 或 3）
          const hasTransfer = todayRecords.some((record) => {
            const serviceState = record.service_state as number | undefined
              ?? record.state as number | undefined;
            return serviceState === 2 || serviceState === 3;
          });
          if (hasTransfer) {
            transferCount++;
          }
        }
      }
    }
  } catch (error) {
    console.error("[openclaw_ics] Stats collection error:", error);
    // 优雅降级：返回可用的部分数据
  }

  // 计算转人工率
  const transferRate = todaySessions > 0
    ? Math.round((transferCount / todaySessions) * 10000) / 100 // 保留两位小数
    : 0;

  return {
    todaySessions,
    todayMessages,
    transferRate,
    activeAgents: activeAgentIds.size,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * 从 runtime 配置中提取 Agent 列表
 * 获取每个 Agent 的 ID 和工作区路径
 *
 * @param runtime - Gateway Runtime
 * @returns Agent 基本信息数组
 */
function getAgentList(
  runtime: GatewayRuntime
): Array<{ id: string; workspace: string }> {
  const config = runtime.config as Record<string, unknown>;
  const agentsConfig = config.agents as Record<string, unknown> | undefined;
  if (!agentsConfig) return [];

  const result: Array<{ id: string; workspace: string }> = [];

  // 获取默认工作区
  const defaults = agentsConfig.defaults as Record<string, unknown> | undefined;
  const defaultWorkspace = defaults?.workspace as string | undefined;

  // 遍历 agents 下的具名 Agent
  for (const [key, value] of Object.entries(agentsConfig)) {
    if (key === "defaults" || typeof value !== "object" || !value) continue;
    const agentCfg = value as Record<string, unknown>;
    const workspace = (agentCfg.workspace as string) ?? defaultWorkspace;
    if (workspace) {
      result.push({ id: key, workspace });
    }
  }

  // 如果没有具名 Agent 但有默认工作区，添加默认 Agent
  if (result.length === 0 && defaultWorkspace) {
    result.push({ id: "default", workspace: defaultWorkspace });
  }

  return result;
}

/**
 * 列出 sessions 目录下的 JSONL 文件
 * 优雅处理目录不存在的情况
 *
 * @param sessionsDir - sessions 目录路径
 * @returns JSONL 文件名列表
 */
async function listSessionFiles(sessionsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(sessionsDir);
    return entries.filter(
      (name) => name.endsWith(".jsonl") || name.endsWith(".json")
    );
  } catch {
    // 目录不存在或无法读取
    return [];
  }
}

/** 发送 JSON 成功响应 */
function sendJson(res: ServerResponse, data: unknown, statusCode = 200): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, data }));
}

/** 发送错误响应 */
function sendError(res: ServerResponse, statusCode: number, error: string, code: string): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error, code }));
}
