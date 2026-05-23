/**
 * knowledge_query — 知识库检索 Tool
 *
 * 支持三种检索策略：
 * - vector  — 纯向量相似度检索
 * - keyword — 纯关键词（FTS5）检索
 * - hybrid  — 向量 + 关键词加权融合（默认）
 *
 * 输出结构化检索结果，供 AI 参考回答用户问题。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenClawPluginToolContext = any;
type AgentToolResult<T = unknown> = {
  content: { type: 'text'; text: string }[];
  details: T | undefined;
};

import { getOrCreateStore } from '../hooks.js';
import { hybridSearch } from '../retriever/hybrid.js';

// ===================================================================
// 类型定义
// ===================================================================

interface KnowledgeQueryParams {
  /** 查询文本 */
  query: string;
  /** 检索策略（默认 hybrid） */
  strategy?: 'vector' | 'keyword' | 'hybrid';
  /** 返回 topK 条结果（默认 5） */
  topK?: number;
  /** 相似度阈值（0-1，低于此值不返回，默认 0） */
  minScore?: number;
  /** 按 sourceId 过滤 */
  sourceId?: string;
  /** 知识库命名空间（默认对话级别） */
  namespace?: string;
}

interface ResultItem {
  sourceId: string;
  chunkIndex: number;
  score: number;
  text: string;
  metadata: Record<string, unknown>;
}

// ===================================================================
// 响应构造
// ===================================================================

function successResult(data: Record<string, unknown>): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ success: true, ...data }) }],
    details: undefined,
  };
}

function failedResult(message: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }) }],
    details: undefined,
  };
}

// ===================================================================
// 获取共享配置
// ===================================================================

function buildBaseConfig(ctx: OpenClawPluginToolContext): import('../types.js').KnowledgeConfig {
  const knowledgeConfig = (ctx.pluginConfig ?? {}) as import('../types.js').KnowledgeConfig;
  if (knowledgeConfig.enabled ?? true) {
    return knowledgeConfig;
  }
  return { enabled: true };
}

// ===================================================================
// 工具定义
// ===================================================================

/**
 * 创建 wecom_knowledge_query Tool 定义
 */
export function createKnowledgeQueryTool(ctx: OpenClawPluginToolContext) {
  return {
    name: 'knowledge_query',
    label: '知识库检索',
    description: [
      '从本地知识库（RAG 向量存储）中检索与查询最相关的内容。',
      '',
      '支持三种检索策略：',
      '  - vector  — 纯向量语义相似度检索（推荐用于语义匹配）',
      '  - keyword — 纯关键词 FTS5 全文检索（推荐用于精确词组匹配）',
      '  - hybrid  — 向量 + 关键词加权融合（默认，兼顾语义和精确度）',
      '',
      '参数说明：',
      '  query（必填）：检索查询文本',
      '  topK（可选）：返回结果条数，默认 5',
      '  minScore（可选）：最小相似度阈值（0-1），低于此值的不返回',
      '  strategy（可选）：检索策略，默认 hybrid',
      '  sourceId（可选）：按 sourceId 精确过滤',
      '  namespace（可选）：知识库命名空间，默认对话级别（{accountId}:{mode}）',
      '',
      '返回结构化结果列表，每条包含 sourceId、chunkIndex、score、text、metadata。',
    ].join('\n'),
    parameters: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: '检索查询文本（必填）',
        },
        strategy: {
          type: 'string',
          enum: ['vector', 'keyword', 'hybrid'],
          description: '检索策略：vector（向量）、keyword（关键词）、hybrid（混合，默认）',
        },
        topK: {
          type: 'number',
          description: '返回结果条数，默认 5',
        },
        minScore: {
          type: 'number',
          description: '最小相似度阈值（0-1），低于此值不返回',
        },
        sourceId: {
          type: 'string',
          description: '按 sourceId 精确过滤，仅返回该来源的 chunks',
        },
        namespace: {
          type: 'string',
          description: '知识库命名空间，默认当前对话命名空间（{accountId}:{mode}）',
        },
      },
      required: ['query'],
    },
    async execute(_toolCallId: string, params: unknown) {
      const p = params as KnowledgeQueryParams;

      if (!p.query || typeof p.query !== 'string' || p.query.trim().length === 0) {
        return failedResult('缺少必填参数 query');
      }

      const query = p.query.trim();
      const topK = p.topK ?? 5;
      const minScore = p.minScore ?? 0;
      const strategy = p.strategy ?? 'hybrid';

      let namespace = p.namespace;
      if (!namespace) {
        const accountId = ctx.agentAccountId ?? 'default';
        const mode = ctx.agentId ? 'agent' : 'bot';
        namespace = `${accountId}:${mode}`;
      }

      try {
        const config = buildBaseConfig(ctx);
        const { store, embedding } = await getOrCreateStore(config, namespace);

        const results = await hybridSearch(query, embedding, store, {
          topK,
          minScore,
          sourceId: p.sourceId,
          config: { strategy },
        });

        const items: ResultItem[] = results.map((r) => ({
          sourceId: (r.chunk.metadata.sourceId as string) ?? '',
          chunkIndex: (r.chunk.metadata.chunkIndex as number) ?? -1,
          score: r.score,
          text: (r.chunk.metadata.text as string) ?? '',
          metadata: r.chunk.metadata,
        }));

        return successResult({
          query,
          strategy,
          namespace,
          total: items.length,
          results: items,
        });
      } catch (err) {
        return failedResult(`检索失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
