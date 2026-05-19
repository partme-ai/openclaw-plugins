/**
 * @partme.ai/openclaw-knowledge — 知识库 RAG 引擎
 *
 * 独立 AI 能力插件，自注册 hook + tools，无需渠道插件手动接入。
 *
 * 自注册内容：
 * - before_prompt_build hook → 自动 RAG 检索 + 注入上下文
 * - knowledge_add / knowledge_query / knowledge_update / knowledge_delete 四个工具
 *
 * 配置路径：直接读 api.pluginConfig，与任何渠道解耦。
 * 命名空间隔离：{accountId}:{mode}，每个账号+模式独立向量库。
 */

import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import { registerKnowledgeHooks, getOrCreateStore, invalidateStoreCache, extractKnowledgeConfig } from "./src/hooks.js";
import { createKnowledgeAddTool } from "./src/tools/knowledge-add.js";
import { createKnowledgeQueryTool } from "./src/tools/knowledge-query.js";
import { createKnowledgeUpdateTool } from "./src/tools/knowledge-update.js";
import { createKnowledgeDeleteTool } from "./src/tools/knowledge-delete.js";

// Re-export library API（向后兼容）
export * from "./src/index.js";

const plugin = {
  id: "knowledge",
  name: "Knowledge RAG",
  description: "知识库 RAG 引擎 — 自动检索注入 + AI 自主知识管理",
  configSchema: { type: "object" as const, additionalProperties: true, properties: {} },

  register(api: OpenClawPluginApi) {
    const cfg = (api.pluginConfig ?? {}) as Record<string, unknown>;
    if (cfg.enabled === false) {
      api.logger.info("[knowledge] Disabled");
      return;
    }

    // ── 1. before_prompt_build hook — 自动 RAG 检索注入 ──────
    // 直接从 api.pluginConfig 读取配置，与渠道无关
    registerKnowledgeHooks(api);

    api.logger.info("[knowledge] before_prompt_build hook registered");

    // ── 2. 四个知识库工具 — AI 自主管理知识 ──────────────────
    // 工具工厂从 ctx.pluginConfig 读取配置，不再硬编码 wecom 路径
    api.registerTool(
      (ctx: OpenClawPluginToolContext) => createKnowledgeAddTool(ctx),
      { name: "knowledge_add" },
    );
    api.registerTool(
      (ctx: OpenClawPluginToolContext) => createKnowledgeQueryTool(ctx),
      { name: "knowledge_query" },
    );
    api.registerTool(
      (ctx: OpenClawPluginToolContext) => createKnowledgeUpdateTool(ctx),
      { name: "knowledge_update" },
    );
    api.registerTool(
      (ctx: OpenClawPluginToolContext) => createKnowledgeDeleteTool(ctx),
      { name: "knowledge_delete" },
    );

    api.logger.info("[knowledge] 4 tools registered: add, query, update, delete");
    api.logger.info("[knowledge] Plugin ready — auto RAG injection + AI knowledge management");
  },
};

export default plugin;
