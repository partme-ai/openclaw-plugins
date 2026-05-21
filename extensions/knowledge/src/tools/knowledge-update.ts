/**
 * knowledge_update — 知识库更新 Tool
 *
 * 按 sourceId 更新已有知识条目：删除旧 chunks → 重新切分、嵌入、写入。
 * Update = deleteBySource(sourceId) + store_text / store_file / store_summary
 */

import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenClawPluginToolContext = any;

import { getOrCreateStore } from '../hooks.js';
import { indexDocument } from '../indexer/scheduler.js';
import { chunkText } from '../indexer/chunker.js';

// ===================================================================
// 类型定义
// ===================================================================

interface KnowledgeUpdateParams {
  /** 要更新的来源标识（必填，用于定位旧数据） */
  sourceId: string;
  /** 更新方式 */
  updateType: 'text' | 'file' | 'summary';
  /** 新的文本内容（updateType=text / summary 时需使用） */
  content?: string;
  /** 新的文件路径（updateType=file 时必填） */
  filePath?: string;
  /** 新的对话主题（updateType=summary 时使用） */
  topic?: string;
  /** 知识库命名空间（默认对话级别） */
  namespace?: string;
}

// ===================================================================
// 命名空间校验
// ===================================================================

const SESSION_NS_PATTERN = /^[^:]+:(bot|agent)$/;

function isSessionNamespace(namespace: string): boolean {
  return SESSION_NS_PATTERN.test(namespace);
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
 * 创建 wecom_knowledge_update Tool 定义
 */
export function createKnowledgeUpdateTool(ctx: OpenClawPluginToolContext) {
  return {
    name: 'knowledge_update',
    label: '知识库更新',
    description: [
      '按 sourceId 更新知识库中已有的条目。',
      '流程：删除该 sourceId 的所有旧 chunks → 重新切分、嵌入、写入新内容。',
      '',
      '参数说明：',
      '  sourceId（必填）：要更新的来源标识，用于定位旧数据',
      '  updateType（必填）：更新类型',
      '    - text  — 更新为纯文本内容（需提供 content）',
      '    - file  — 更新为文件内容（需提供 filePath，支持 .md/.txt/.csv/.json）',
      '    - summary — 更新为对话总结（需提供 topic + content）',
      '  content（按需）：新的文本内容',
      '  filePath（按需）：新的文件路径',
      '  topic（按需）：新的对话主题',
      '  namespace（可选）：知识库命名空间，默认对话级别',
      '',
      '权限规则：非对话级 namespace 只有 owner 才能操作。',
    ].join('\n'),
    parameters: {
      type: 'object' as const,
      properties: {
        sourceId: {
          type: 'string',
          description: '要更新的来源标识（必填）',
        },
        updateType: {
          type: 'string',
          enum: ['text', 'file', 'summary'],
          description: '更新类型：text（文本）、file（文件）、summary（总结）',
        },
        content: {
          type: 'string',
          description: '新的文本内容（updateType=text 或 summary 时使用）',
        },
        filePath: {
          type: 'string',
          description: '新的文件路径（updateType=file 时必填，支持 .md, .txt, .csv, .json）',
        },
        topic: {
          type: 'string',
          description: '新的对话主题（updateType=summary 时使用）',
        },
        namespace: {
          type: 'string',
          description: '知识库命名空间，默认当前对话命名空间（{accountId}:{mode}）',
        },
      },
      required: ['sourceId', 'updateType'],
    },
    async execute(_toolCallId: string, params: unknown) {
      const p = params as KnowledgeUpdateParams;

      if (!p.sourceId || typeof p.sourceId !== 'string' || p.sourceId.trim().length === 0) {
        return failedResult('缺少必填参数 sourceId');
      }

      const sourceId = p.sourceId.trim();

      let namespace = p.namespace;
      if (!namespace) {
        const accountId = ctx.agentAccountId ?? 'default';
        const mode = ctx.agentId ? 'agent' : 'bot';
        namespace = `${accountId}:${mode}`;
      }

      // 权限校验
      if (!isSessionNamespace(namespace) && !ctx.senderIsOwner) {
        return failedResult('只有 owner 才能更新非对话级 namespace 的知识库');
      }

      const config = buildBaseConfig(ctx);

      try {
        // 第一步：删除旧数据
        const { store, embedding } = await getOrCreateStore(config, namespace);
        await store.deleteBySource(sourceId);

        // 第二步：根据 updateType 写入新数据
        switch (p.updateType) {
          case 'text': {
            if (!p.content || typeof p.content !== 'string' || p.content.trim().length === 0) {
              return failedResult('updateType=text 时必须提供非空的 content 参数');
            }
            const text = p.content.trim();
            const chunks = chunkText(text, sourceId);
            if (chunks.length === 0) {
              return successResult({ sourceId, chunksUpdated: 0 });
            }
            const texts = chunks.map((c) => c.text);
            const vectors = await embedding.embedBatch(texts);
            const vectorChunks = chunks.map((chunk, i) => ({
              id: `doc:${sourceId}:${chunk.index}`,
              vector: vectors[i],
              metadata: {
                sourceId: chunk.sourceId,
                chunkIndex: chunk.index,
                text: chunk.text,
                source: 'knowledge_update',
              },
            }));
            await store.upsert(vectorChunks);
            return successResult({ sourceId, chunksUpdated: vectorChunks.length });
          }

          case 'file': {
            if (!p.filePath || typeof p.filePath !== 'string') {
              return failedResult('updateType=file 时必须提供 filePath 参数');
            }
            try {
              const fileStat = await stat(p.filePath);
              if (!fileStat.isFile()) {
                return failedResult(`路径不是文件: ${p.filePath}`);
              }
            } catch (err) {
              return failedResult(`无法读取文件: ${p.filePath}（${err instanceof Error ? err.message : String(err)}）`);
            }
            const ext = extname(p.filePath).toLowerCase();
            const supportedExts = new Set(['.md', '.txt', '.csv', '.json']);
            if (!supportedExts.has(ext)) {
              return failedResult(`不支持的文件类型: ${ext}（支持: ${[...supportedExts].join(', ')}）`);
            }
            const result = await indexDocument(p.filePath, sourceId, embedding, store);
            if (!result.success) {
              return failedResult(result.error ?? '索引文件失败');
            }
            return successResult({ sourceId, chunksUpdated: result.chunksAdded });
          }

          case 'summary': {
            if (!p.topic || typeof p.topic !== 'string' || p.topic.trim().length === 0) {
              return failedResult('updateType=summary 时必须提供 topic 参数');
            }
            if (!p.content || typeof p.content !== 'string' || p.content.trim().length === 0) {
              return failedResult('updateType=summary 时必须提供非空的 content 参数');
            }
            if (!isSessionNamespace(namespace)) {
              return failedResult('summary 更新只支持对话级 namespace（{accountId}:{mode}）');
            }
            const topic = p.topic.trim();
            const summaryContent = `对话主题：${topic}\n\n总结内容：${p.content.trim()}`;
            const chunks = chunkText(summaryContent, sourceId);
            if (chunks.length === 0) {
              return successResult({ sourceId, chunksUpdated: 0 });
            }
            const texts = chunks.map((c) => c.text);
            const vectors = await embedding.embedBatch(texts);
            const vectorChunks = chunks.map((chunk, i) => ({
              id: `summary:${sourceId}:${chunk.index}`,
              vector: vectors[i],
              metadata: {
                sourceId: chunk.sourceId,
                chunkIndex: chunk.index,
                text: chunk.text,
                source: 'knowledge_update',
                type: 'summary',
                topic,
              },
            }));
            await store.upsert(vectorChunks);
            return successResult({ sourceId, chunksUpdated: vectorChunks.length });
          }

          default:
            return failedResult(`未知更新类型: ${String(p.updateType)}，支持 text、file、summary`);
        }
      } catch (err) {
        return failedResult(`更新失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
