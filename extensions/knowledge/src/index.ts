/**
 * Knowledge RAG 模块 — 统一导出入口
 *
 * 对外暴露的核心 API：
 * - indexFile()          — 单文件索引入口（文件上传时调用）
 * - searchByQuery()      — 按语义查询知识库
 * - registerKnowledgeHooks — 注册 OpenClaw before_prompt_build hook
 * - getOrCreateStore()   — 获取/创建命名空间的 Store 实例
 * - invalidateStoreCache() — 清除 Store 缓存
 * - createKnowledgeConfig() — 从原始配置创建标准配置
 * - validateKnowledgeConfig() — 校验配置
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
 * 索引单个上传文件
 *
 * 完整流程：
 * 1. 校验文件类型（仅支持 .md/.txt/.csv/.json）
 * 2. 确认文件存在且有大小
 * 3. 获取/创建命名空间的 Store 实例
 * 4. 调用 indexDocument() 完成切分 → 嵌入 → 存储
 *
 * @param filePath - 文件在磁盘上的绝对路径
 * @param options  - 索引选项
 * @returns 索引结果
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
 * 批量索引多个上传文件
 *
 * @param files - 文件信息数组
 * @param getOptions - 为每个文件生成索引选项的回调函数
 * @returns 所有文件的索引结果
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
 * 按语义查询知识库
 *
 * 简化的查询入口，封装了 embedding + search 的调用。
 *
 * @param query   - 用户查询文本
 * @param options - 查询选项
 * @returns 检索结果（含排序后的文档块和上下文文本）
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
 * 判断文件扩展名是否属于可索引类型
 */
export function isIndexableFile(filePath: string): boolean {
  return INDEXABLE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

/**
 * 获取支持的文件类型描述（用于提示用户）
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

const plugin = {
  id: 'knowledge',
  name: 'Knowledge RAG',
  description: '知识库 RAG 引擎 — 自动检索注入 + AI 自主知识管理',
  configSchema: { type: 'object' as const, additionalProperties: true, properties: {} },

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
