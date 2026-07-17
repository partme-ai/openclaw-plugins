/**
 * @fileoverview `knowledge_update` — 按 sourceId **覆盖式更新** 知识条目 Tool。
 *
 * @description Update = 同 sourceId 串行重新 ingest + 存储层原子替换（text/file/summary 三路径）。
 * **模块角色**：Knowledge Plugin · Agent tool (write/update path)。
 *
 * @module knowledge/tools/knowledge-update
 */

import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { OpenClawPluginToolContext } from 'openclaw/plugin-sdk/plugin-entry';
import type { KnowledgeConfig } from '../types.js';
type AgentToolResult<T = unknown> = {
  content: { type: 'text'; text: string }[];
  details: T | undefined;
};

import { getOrCreateStore } from '../runtime/hooks.js';
import { indexDocument, withSourceWriteLock } from '../indexer/scheduler.js';
import { chunkText } from '../indexer/chunker.js';
import { authorizeFilePath, authorizeNamespace, defaultNamespace, validateSourceId, validateTextSize } from './policy.js';

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

// ===================================================================
// 工具定义
// ===================================================================

/**
 * 创建 wecom_knowledge_update Tool 定义
 */
/**
 * @description 注册 `knowledge_update` Tool — 按 sourceId 覆盖 text/file/summary。
 *
 * @param ctx - OpenClaw Tool 上下文。
 * @returns Agent Tool 描述对象。
 */
export function createKnowledgeUpdateTool(ctx: OpenClawPluginToolContext, config: KnowledgeConfig) {
  return {
    name: 'knowledge_update',
    label: '知识库更新',
    description: [
      '按 sourceId 更新知识库中已有的条目。',
      '流程：重新切分、嵌入，并原子替换该 sourceId 的全部 chunks；失败时保留旧内容。',
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
          description: '知识库命名空间，默认由当前 OpenClaw sessionKey 派生',
        },
      },
      required: ['sourceId', 'updateType'],
    },
    async execute(_toolCallId: string, params: unknown) {
      const p = params as KnowledgeUpdateParams;

      if (!p.sourceId || typeof p.sourceId !== 'string' || p.sourceId.trim().length === 0) {
        return failedResult('缺少必填参数 sourceId');
      }

      const source = validateSourceId(p.sourceId, '');
      if (!source.ok) return failedResult(source.error);
      const sourceId = source.sourceId;
      const access = authorizeNamespace(ctx, p.namespace, config);
      if (!access.ok) return failedResult(access.error);

      try {
        const { store, embedding } = await getOrCreateStore(config, access.namespace);

        switch (p.updateType) {
          case 'text': {
            if (!p.content || typeof p.content !== 'string' || p.content.trim().length === 0) {
              return failedResult('updateType=text 时必须提供非空的 content 参数');
            }
            const text = p.content.trim();
            const sizeError = validateTextSize(text, config, 'content');
            if (sizeError) return failedResult(sizeError);
            return withSourceWriteLock(store, sourceId, async () => {
              const chunks = chunkText(text, sourceId);
              const vectors = await embedding.embedBatch(chunks.map((chunk) => chunk.text));
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
              await store.replaceBySource(sourceId, vectorChunks);
              return successResult({ sourceId, chunksUpdated: vectorChunks.length });
            });
          }

          case 'file': {
            if (!p.filePath || typeof p.filePath !== 'string') {
              return failedResult('updateType=file 时必须提供 filePath 参数');
            }
            const fileAccess = await authorizeFilePath(ctx, p.filePath, config);
            if (!fileAccess.ok) return failedResult(fileAccess.error);
            try {
              const fileStat = await stat(fileAccess.filePath);
              if (!fileStat.isFile()) {
                return failedResult(`路径不是文件: ${fileAccess.filePath}`);
              }
              if (fileStat.size === 0) return failedResult(`文件为空: ${fileAccess.filePath}`);
              if (fileStat.size > fileAccess.maxFileBytes) return failedResult(`文件超过最大大小 ${fileAccess.maxFileBytes} bytes`);
            } catch (err) {
              return failedResult(`无法读取文件: ${fileAccess.filePath}（${err instanceof Error ? err.message : String(err)}）`);
            }
            const ext = extname(fileAccess.filePath).toLowerCase();
            const supportedExts = new Set(['.md', '.txt', '.csv', '.json']);
            if (!supportedExts.has(ext)) {
              return failedResult(`不支持的文件类型: ${ext}（支持: ${[...supportedExts].join(', ')}）`);
            }
            const result = await indexDocument(fileAccess.filePath, sourceId, embedding, store);
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
            if (access.namespace !== defaultNamespace(ctx)) {
              return failedResult('summary 更新只支持当前 sessionKey 派生的私有 namespace');
            }
            const topic = p.topic.trim();
            const content = p.content.trim();
            const sizeError = validateTextSize(`${topic}\n${content}`, config, 'summary');
            if (sizeError) return failedResult(sizeError);
            const summaryContent = `对话主题：${topic}\n\n总结内容：${content}`;
            return withSourceWriteLock(store, sourceId, async () => {
              const chunks = chunkText(summaryContent, sourceId);
              const vectors = await embedding.embedBatch(chunks.map((chunk) => chunk.text));
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
              await store.replaceBySource(sourceId, vectorChunks);
              return successResult({ sourceId, chunksUpdated: vectorChunks.length });
            });
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
