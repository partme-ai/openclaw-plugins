/**
 * @fileoverview Knowledge RAG 模块 — OpenClaw 内知识库能力的统一导出入口。
 *
 * @description
 * 本文件衔接 **摄取（Indexing）→ 嵌入（Embedding）→ 向量存储（VectorStore）→ 检索（Retrieval）→
 * 注入（Prompt Injection）** 的 RAG 管道：对外导出库式 API（`indexFile`、`searchByQuery` 等），
 * 并注册默认插件对象（`before_prompt_build` 钩子 + `knowledge_*` 工具集），供渠道/编排层作为
 * **基础设施类（infra/capability）** 插件挂载。
 *
 * 对外暴露的核心能力：
 * - `indexFile` / `indexFiles` — 单/多文件索引入口（上传/落盘后调用）
 * - `searchByQuery` — 面向查询的语义检索 + 上下文拼装
 * - `registerKnowledgeHooks` — 在提示词构建前自动注入检索上下文
 * - `getOrCreateStore` / `invalidateStoreCache` — Store 生命周期与缓存
 * - `createKnowledgeConfig` / `validateKnowledgeConfig` — 配置校验与规范化
 *
 * @module knowledge
 */

export { registerKnowledgeHooks, getOrCreateStore, invalidateStoreCache } from './runtime/hooks.js';
export { extractKnowledgeConfig, deepMergeKnowledgeConfig } from './runtime/hooks.js';
export { indexDocument, indexDocuments, retrieveContext } from './indexer/scheduler.js';
export { createKnowledgeConfig, validateKnowledgeConfig, mergeKnowledgeConfig } from './config/config.js';

// 知识库 CRUD 工具（给渠道插件注册用）
export { createKnowledgeAddTool } from './tools/knowledge-add.js';
export { createKnowledgeQueryTool } from './tools/knowledge-query.js';
export { createKnowledgeUpdateTool } from './tools/knowledge-update.js';
export { createKnowledgeDeleteTool } from './tools/knowledge-delete.js';

export type {
  KnowledgeConfig,
  KnowledgeEmbeddingConfig,
  KnowledgeStoreConfig,
  KnowledgeRetrievalConfig,
  KnowledgeInjectionConfig,
  KnowledgeModerationConfig,
  DeepPartialKnowledgeConfig,
  EmbeddingService,
  VectorStore,
  VectorChunk,
  ScoredChunk,
  TextChunk,
  BeforePromptBuildContext,
  BeforePromptBuildResult,
} from './types.js';

// ===================================================================
// 文件上传索引 — 业务入口
// ===================================================================

import { extname } from 'node:path';
import { stat } from 'node:fs/promises';
import { getOrCreateStore } from './runtime/hooks.js';
import { indexDocument, retrieveContext } from './indexer/scheduler.js';
import type { IndexResult } from './indexer/scheduler.js';
import type { KnowledgeConfig } from './types.js';
import type { ChunkerConfig } from './indexer/chunker.js';

export type { IndexResult };

/** 支持索引的文件类型（按扩展名） */
const INDEXABLE_EXTENSIONS = new Set(['.md', '.txt', '.csv', '.json', '.text']);

/** 文件上传索引配置 */
/**
 * @description 单文件索引调用所需的选项：绑定已合并的 {@link KnowledgeConfig}、租户/会话命名空间，
 *              以及可选的切分参数覆盖。
 */
export type FileIndexOptions = {
  /** 知识库配置（已合并） */
  config: KnowledgeConfig;
  /** 命名空间（格式：accountId:mode） */
  namespace: string;
  /** 来源标识 */
  sourceId: string;
  /** 切分配置覆盖 */
  chunkerConfig?: Partial<ChunkerConfig>;
};

/**
 * @description 索引单个上传文件：走文档读取 → 切分 → 批量嵌入 → `upsert` 向量库的流水线，
 *              并在入口处校验扩展名与文件可读性。
 *
 * @param filePath - 待索引文件的磁盘路径（建议使用绝对路径）
 * @param options - {@link FileIndexOptions}：命名空间、配置、`sourceId` 及可选 chunker 覆盖
 * @returns `chunksAdded` / `success` / `error` 等指标封装 {@link IndexResult}
 */
export async function indexFile(
  filePath: string,
  options: FileIndexOptions,
): Promise<IndexResult> {
  const ext = extname(filePath).toLowerCase();
  if (!INDEXABLE_EXTENSIONS.has(ext)) {
    return {
      chunksAdded: 0,
      sourceId: options.sourceId,
      success: false,
      error: `不支持的文件类型: ${ext}（支持: .md, .txt, .csv, .json）`,
    };
  }

  // 确认文件存在且非空
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size === 0) {
      return {
        chunksAdded: 0,
        sourceId: options.sourceId,
        success: false,
        error: '文件不存在或为空',
      };
    }
  } catch {
    return {
      chunksAdded: 0,
      sourceId: options.sourceId,
      success: false,
      error: `无法读取文件: ${filePath}`,
    };
  }

  const { store, embedding } = await getOrCreateStore(options.config, options.namespace);
  return indexDocument(filePath, options.sourceId, embedding, store, options.chunkerConfig);
}

/**
 * @description 顺序批量索引多个文件（逐项调用 {@link indexFile}）。
 *
 * @param files - 每项包含磁盘路径与稳定 `sourceId`
 * @param getOptions - 为每条输入推导索引上下文（配置、`chunkerConfig`、`namespace` 等）
 * @returns 与输入顺序一一对应的 {@link IndexResult} 数组
 */
export async function indexFiles(
  files: { filePath: string; sourceId: string }[],
  getOptions: (file: { filePath: string; sourceId: string }) => FileIndexOptions,
): Promise<IndexResult[]> {
  const results: IndexResult[] = [];

  for (const file of files) {
    const options = getOptions(file);
    const result = await indexFile(file.filePath, { ...options, sourceId: file.sourceId });
    results.push(result);
  }

  return results;
}

/**
 * @description 语义检索的一站式封装：解析/embed → {@link retrieveContext} → 返回向量打分片段与会拼接上下文，
 *              供自建链路或非钩子场景直接调用。
 *
 * @param query - 用户自然语言提问或多关键字短语
 * @param options - `config`、`namespace`，可选 `topK`/`minScore`（阈值语义与各后端对齐）
 * @returns `chunks`（向量打分条目）与 `contextText`（按序号展开的可读拼装文本）
 */
export async function searchByQuery(
  query: string,
  options: {
    config: KnowledgeConfig;
    namespace: string;
    topK?: number;
    minScore?: number;
  },
): Promise<{ chunks: import('./types.js').ScoredChunk[]; contextText: string }> {
  const { store, embedding } = await getOrCreateStore(options.config, options.namespace);
  return retrieveContext(query, embedding, store, options.topK, options.minScore);
}

/**
 * @description 基于静态后缀集合判断是否可被内置 ingest/chunker 接受。
 *
 * @param filePath - 任意路径或文件名（后缀取自 `path.extname`）
 * @returns 若为支持的 `.md`/`.txt`/`.csv`/`.json`/`.text` 后缀则为 true
 */
export function isIndexableFile(filePath: string): boolean {
  return INDEXABLE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

/**
 * @description 返回可被 ingest UI/Prompt 提示复用的扩展名列表拼接字符串。
 *
 * @returns 逗号分隔的后缀清单（来自运行时常量）
 */
export function getSupportedExtensions(): string {
  return Array.from(INDEXABLE_EXTENSIONS).join(', ');
}

// ===================================================================
// Plugin entry — 自注册 hook + tools
// ===================================================================

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { registerKnowledgeHooks } from './runtime/hooks.js';
import { createKnowledgeAddTool } from './tools/knowledge-add.js';
import { createKnowledgeQueryTool } from './tools/knowledge-query.js';
import { createKnowledgeUpdateTool } from './tools/knowledge-update.js';
import { createKnowledgeDeleteTool } from './tools/knowledge-delete.js';

/**
 * @description OpenClaw 运行时注册的默认知识库插件：挂载钩子与 4 个托管工具，形成「自动 RAG 注入」+
 *              「模型自服务 CRUD」双层能力面。
 */
const plugin = {
  id: 'knowledge',
  name: 'Knowledge RAG',
  description: '知识库 RAG 引擎 — 自动检索注入 + AI 自主知识管理',
  configSchema: { type: 'object' as const, additionalProperties: true, properties: {} },

  /**
   * @description 向 OpenClaw 注册 `before_prompt_build` 钩子和 `knowledge_add|query|update|delete` 工具。
   *              当 `pluginConfig.enabled === false` 时提前返回，不注册任何能力。
   *
   * @param api - OpenClaw 插件 API（含 `config`、`pluginConfig`、`registerTool`、`logger` 等）
   */
  register(api: OpenClawPluginApi) {
    const cfg = (api.pluginConfig ?? {}) as Record<string, unknown>;
    if (cfg.enabled === false) {
      api.logger.info('[knowledge] Disabled');
      return;
    }

    registerKnowledgeHooks(api);
    api.logger.info('[knowledge] before_prompt_build hook registered');

    api.registerTool((ctx) => createKnowledgeAddTool(ctx), { name: 'knowledge_add' });
    api.registerTool((ctx) => createKnowledgeQueryTool(ctx), { name: 'knowledge_query' });
    api.registerTool((ctx) => createKnowledgeUpdateTool(ctx), { name: 'knowledge_update' });
    api.registerTool((ctx) => createKnowledgeDeleteTool(ctx), { name: 'knowledge_delete' });

    api.logger.info('[knowledge] 4 tools registered: add, query, update, delete');
    api.logger.info('[knowledge] Plugin ready — auto RAG injection + AI knowledge management');
  },
};

export default plugin;
