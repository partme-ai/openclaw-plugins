/**
 * 【可选运营模块 — ICS】知识库管理处理器
 *
 * 不属于 KF 消息收发核心；仅在 `channels.wecom-kf.icsEnabled=true` 时由 index.ts 注册 HTTP 路由。
 * 依赖 `src/http/ics/storage/` 文件读写工具。
 *
 * 管理 Agent 的知识库文档（extraPaths 目录下的 Markdown 文件）
 *
 * 对应端点：
 * - GET    /ics/agents/:agentId/knowledge            — 列出知识库文档
 * - POST   /ics/agents/:agentId/knowledge            — 上传文档
 * - GET    /ics/agents/:agentId/knowledge/:docId     — 读取文档
 * - PUT    /ics/agents/:agentId/knowledge/:docId     — 更新文档
 * - DELETE /ics/agents/:agentId/knowledge/:docId     — 删除文档
 * - POST   /ics/agents/:agentId/knowledge/search     — 测试语义搜索
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { GatewayRuntime, AgentInfo } from "../../../types/compat.js";
import {
  listFiles,
  readMarkdownFile,
  createFile,
  writeMarkdownFile,
  deleteFile,
  resolveWorkspacePath,
} from "../storage/file-ops.js";

/**
 * 创建 ICS Agent 知识库管理处理器。
 *
 * @param runtime Gateway Runtime 引用
 */
export function createAgentKnowledgeAdminHandler(
  runtime: GatewayRuntime
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method?.toUpperCase() ?? "GET";

    // 解析路径参数
    const agentIdMatch = url.match(/\/ics\/agents\/([^/]+)\/knowledge/);
    const agentId = agentIdMatch?.[1];
    if (!agentId) {
      sendError(res, 400, "Agent ID required", "MISSING_AGENT_ID");
      return;
    }

    // 查找 Agent 配置
    const agent = findAgent(runtime, agentId);
    if (!agent) {
      sendError(res, 404, "Agent not found", "AGENT_NOT_FOUND");
      return;
    }

    // 知识库目录（Agent workspace 下的 knowledge/ 目录）
    const workspace = resolveWorkspacePath(agent.workspace);
    const knowledgeDir = join(workspace, "knowledge");

    // 文档 ID
    const docIdMatch = url.match(/\/knowledge\/([^/]+)$/);
    const docId = docIdMatch?.[1];

    // 搜索功能：POST /admin/agents/:agentId/knowledge/search
    if (docId === "search" && method === "POST") {
      const body = await parseBody(req);
      const query = body.query as string;
      const limit = (body.limit as number) ?? 10;

      if (!query) {
        sendError(res, 400, "Search query is required", "MISSING_QUERY");
        return;
      }

      // 通过 runtime.memorySearch 执行语义搜索（BM25 + 向量混合搜索）
      const results = await performSemanticSearch(runtime, agentId, query, limit);

      sendJson(res, {
        query,
        limit,
        results,
        total: results.length,
      });
      return;
    }

    // 单个文档操作
    if (docId) {
      const docPath = join(knowledgeDir, `${docId}.md`);

      switch (method) {
        case "GET": {
          try {
            const doc = await readMarkdownFile(docPath);
            sendJson(res, { id: docId, ...doc });
          } catch {
            sendError(res, 404, "Document not found", "DOC_NOT_FOUND");
          }
          return;
        }
        case "PUT": {
          const body = await parseBody(req);
          await writeMarkdownFile(docPath, body.content as string);
          sendJson(res, { id: docId, updated: true });
          return;
        }
        case "DELETE": {
          try {
            await deleteFile(docPath);
            sendJson(res, { id: docId, deleted: true });
          } catch {
            sendError(res, 404, "Document not found", "DOC_NOT_FOUND");
          }
          return;
        }
      }
    }

    // 文档列表 / 上传
    switch (method) {
      case "GET": {
        const files = await listFiles(knowledgeDir);
        sendJson(res, files);
        return;
      }
      case "POST": {
        const body = await parseBody(req);
        const fileName = (body.name as string) ?? `doc-${Date.now()}.md`;
        const path = await createFile(
          knowledgeDir,
          fileName,
          body.content as string
        );
        sendJson(res, { id: fileName.replace(/\.md$/, ""), path, created: true }, 201);
        return;
      }
    }

    sendError(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED");
  };
}

/**
 * 查找指定 Agent
 */
function findAgent(
  runtime: GatewayRuntime,
  agentId: string
): AgentInfo | undefined {
  const config = runtime.config;
  const agents = (config as Record<string, Record<string, unknown>>).agents;
  const list = agents?.list as AgentInfo[] | undefined;
  return list?.find((a) => a.id === agentId);
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

/**
 * 执行语义搜索
 * 通过 OpenClaw Runtime 的 memorySearch 接口进行 BM25 + 向量混合搜索
 *
 * 搜索策略（按优先级）：
 * 1. runtime.memorySearch() — 直接调用搜索接口
 * 2. runtime.gatewayCall("memory.search") — 通过 Gateway 调用
 * 3. runtime.invoke("memory_search") — 通用调用
 *
 * @param runtime - Gateway Runtime 引用
 * @param agentId - 目标 Agent ID
 * @param query - 搜索查询文本
 * @param maxResults - 最大返回结果数
 * @returns 搜索结果列表
 */
async function performSemanticSearch(
  runtime: GatewayRuntime,
  agentId: string,
  query: string,
  maxResults: number
): Promise<Array<{ document: string; snippet: string; score: number }>> {
  const runtimeAny = runtime as unknown as Record<string, unknown>;

  try {
    // 策略 1: runtime.memorySearch（首选）
    if (typeof runtimeAny.memorySearch === "function") {
      const searchFn = runtimeAny.memorySearch as (params: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
      const results = await searchFn({ query, agentId, maxResults });
      return results.map((r: Record<string, unknown>) => ({
        document: (r.path as string) ?? "",
        snippet: (r.snippet as string) ?? "",
        score: (r.score as number) ?? 0,
      }));
    }

    // 策略 2: runtime.gatewayCall
    if (typeof runtimeAny.gatewayCall === "function") {
      const gatewayCall = runtimeAny.gatewayCall as (method: string, params: Record<string, unknown>) => Promise<unknown>;
      const results = await gatewayCall("memory.search", {
        query,
        agentId,
        maxResults,
      });
      if (Array.isArray(results)) {
        return results.map((r: Record<string, unknown>) => ({
          document: (r.path as string) ?? (r.document as string) ?? "",
          snippet: (r.snippet as string) ?? (r.content as string) ?? "",
          score: (r.score as number) ?? 0,
        }));
      }
    }

    // 策略 3: runtime.invoke
    if (typeof runtimeAny.invoke === "function") {
      const invokeFn = runtimeAny.invoke as (m: string, p: Record<string, unknown>) => Promise<unknown>;
      const results = await invokeFn("memory_search", { query, agentId, maxResults });
      if (Array.isArray(results)) {
        return results.map((r: Record<string, unknown>) => ({
          document: (r.path as string) ?? "",
          snippet: (r.snippet as string) ?? "",
          score: (r.score as number) ?? 0,
        }));
      }
    }

    // 降级：无可用搜索接口
    console.warn(
      `[openclaw_ics] memorySearch unavailable. Runtime keys: ${Object.keys(runtimeAny).join(", ")}`
    );
    return [];
  } catch (error) {
    console.error("[openclaw_ics] Semantic search error:", error);
    return [];
  }
}

/** @deprecated 使用 createAgentKnowledgeAdminHandler */
export const createKnowledgeHandler = createAgentKnowledgeAdminHandler;
