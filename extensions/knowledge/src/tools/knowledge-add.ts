/**
 * @fileoverview `knowledge_add` — OpenClaw 侧的 **向量写入 Tool**。
 *
 * @description
 * RAG 管道的 **写入（Ingest）** 分支：文本直写 / 结构化文件 ingest / 对话摘要固化。
 * 每条路径均复用 `chunkText`→`embedBatch`→`upsert` 范式，并在进入前完成 **命名空间 ACL** 判定。
 *
 * @module knowledge/tools/knowledge-add
 */

import { basename, extname } from 'node:path';
import { stat } from 'node:fs/promises';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenClawPluginToolContext = any;
type AgentToolResult<T = unknown> = {
  content: { type: 'text'; text: string }[];
  details: T | undefined;
};

import { getOrCreateStore } from '../runtime/hooks.js';
import { indexDocument } from '../indexer/scheduler.js';
import { chunkText } from '../indexer/chunker.js';

// ===================================================================
// 类型定义
// ===================================================================

/** knowledge_add 入参 */
interface KnowledgeAddParams {
  action: 'store_text' | 'store_file' | 'store_summary';
  content?: string;
  filePath?: string;
  topic?: string;
  text?: string;
  namespace?: string;
  sourceId?: string;
}

// ===================================================================
// 命名空间校验
// ===================================================================

/** 对话级 namespace 格式：{accountId}:{mode} */
const SESSION_NS_PATTERN = /^[^:]+:(bot|agent)$/;

/**
 * @description 判断 `namespace` 是否符合 `{account}:(bot|agent)` 会话私有格式。
 *
 * @param namespace - 目标库隔离键
 */
function isSessionNamespace(namespace: string): boolean {
  return SESSION_NS_PATTERN.test(namespace);
}

// ===================================================================
// 响应构造
// ===================================================================

/** @description 将结构化负载封装成 Agent Tool 文本响应骨架。 */
function toolResult(data: Record<string, unknown>): AgentToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    details: undefined,
  };
}

/** @description `success:true` 变体 — 额外字段扁平 merge 进 JSON。 */
function successResult(data: Record<string, unknown>): AgentToolResult {
  return toolResult({ success: true, ...data });
}

/** @description 统一错误出口 — 仍保持 HTTP 200 + JSON 协议。 */
function failedResult(message: string): AgentToolResult {
  return toolResult({ success: false, error: message });
}

// ===================================================================
// 获取共享配置（通过 runtimeConfig 或合理默认值）
// ===================================================================

/**
 * @description 从 `ctx.pluginConfig` 组装最小可用 `KnowledgeConfig` — 缺省即视为强制开启知识能力。
 *
 * @param ctx - OpenClaw Tool 上下文
 */
function buildBaseConfig(ctx: OpenClawPluginToolContext): import('../types.js').KnowledgeConfig {
  const knowledgeConfig = (ctx.pluginConfig ?? {}) as import('../types.js').KnowledgeConfig;
  if (knowledgeConfig.enabled ?? true) {
    return knowledgeConfig;
  }
  return { enabled: true };
}

// ===================================================================
// 执行逻辑
// ===================================================================

/**
 * @description `store_text` 分支：幂等语义 — 先 `deleteBySource` 再批量写入向量。
 *
 * @param content - 纯文本正文
 * @param namespace - 向量隔离空间
 * @param sourceId - 文档键（重复写入覆盖）
 * @param ctx - Tool 上下文（读取插件配置）
 */
async function handleStoreText(
  content: string,
  namespace: string,
  sourceId: string,
  ctx: OpenClawPluginToolContext,
) {
  const config = buildBaseConfig(ctx);
  const { store, embedding } = await getOrCreateStore(config, namespace);

  const chunks = chunkText(content, sourceId);
  if (chunks.length === 0) {
    return successResult({ chunksAdded: 0, sourceId });
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
      source: 'knowledge_add',
    },
  }));

  await store.deleteBySource(sourceId);
  await store.upsert(vectorChunks);

  return successResult({ chunksAdded: vectorChunks.length, sourceId });
}

/**
 * @description `store_file` 分支：委托 {@link indexDocument} 完整 ingest（含 Parser 钩子预留）。
 *
 * @param filePath - 磁盘绝对/相对路径
 * @param namespace - 向量隔离空间
 * @param sourceId - 覆盖写入键
 * @param ctx - Tool 上下文
 */
async function handleStoreFile(
  filePath: string,
  namespace: string,
  sourceId: string,
  ctx: OpenClawPluginToolContext,
) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return failedResult(`路径不是文件: ${filePath}`);
    }
    if (fileStat.size === 0) {
      return failedResult(`文件为空: ${filePath}`);
    }
  } catch (err) {
    return failedResult(`无法读取文件: ${filePath}（${err instanceof Error ? err.message : String(err)}）`);
  }

  const ext = extname(filePath).toLowerCase();
  const supportedExts = new Set(['.md', '.txt', '.csv', '.json']);
  if (!supportedExts.has(ext)) {
    return failedResult(`不支持的文件类型: ${ext}（支持: ${[...supportedExts].join(', ')}）`);
  }

  const config = buildBaseConfig(ctx);
  const { store, embedding } = await getOrCreateStore(config, namespace);

  const result = await indexDocument(filePath, sourceId, embedding, store);
  if (!result.success) {
    return failedResult(result.error ?? '索引文件失败');
  }

  return successResult({ chunksAdded: result.chunksAdded, sourceId });
}

/**
 * @description `store_summary` 分支：模板化为固定 Markdown-ish 排版后再切块嵌入。
 *
 * @param topic - 会话主题标题
 * @param text - 摘要正文
 * @param namespace - 必须为会话 private NS（外层已校验）
 * @param sourceId - 摘要条目 ID
 * @param ctx - Tool 上下文
 */
async function handleStoreSummary(
  topic: string,
  text: string,
  namespace: string,
  sourceId: string,
  ctx: OpenClawPluginToolContext,
) {
  const summaryContent = `对话主题：${topic}\n\n总结内容：${text}`;

  const config = buildBaseConfig(ctx);
  const { store, embedding } = await getOrCreateStore(config, namespace);

  const chunks = chunkText(summaryContent, sourceId);
  if (chunks.length === 0) {
    return successResult({ chunksAdded: 0, sourceId });
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
      source: 'knowledge_add',
      type: 'summary',
      topic,
    },
  }));

  await store.deleteBySource(sourceId);
  await store.upsert(vectorChunks);

  return successResult({ chunksAdded: vectorChunks.length, sourceId });
}

// ===================================================================
// 工具定义
// ===================================================================

/**
 * @description OpenClaw `registerTool` 工厂：**knowledge_add** — 三类写入动作的参数路由器。
 *
 * @param ctx - 绑定账号/agent/bot 模式及插件配置的调用上下文
 * @returns Agent Tool 描述对象（含 JSON Schema parameters）
 */
export function createKnowledgeAddTool(ctx: OpenClawPluginToolContext) {
  return {
    name: 'knowledge_add',
    label: '知识库写入',
    description: [
      '将文本、文件或对话总结写入本地知识库（RAG 向量存储）。',
      '',
      '支持三种操作（由 action 参数区分）：',
      '',
      '1. store_text — 存入文字内容',
      '   - content（必填）：要存入知识库的文字内容',
      '   - namespace（可选）：知识库命名空间，默认对话级别（accountId:mode）',
      '   - sourceId（可选）：来源标识，默认取 content 前 30 字符',
      '',
      '2. store_file — 存入文件',
      '   - filePath（必填）：文件路径（支持 .md, .txt, .csv, .json）',
      '   - namespace（可选）：同上',
      '   - sourceId（可选）：来源标识，默认取文件名',
      '',
      '3. store_summary — 存入对话总结',
      '   - topic（必填）：对话主题',
      '   - text（必填）：总结内容',
      '   - namespace（可选）：同上，但只允许写入对话级 namespace',
      '   - sourceId（可选）：来源标识，默认取 topic',
      '',
      '权限规则：',
      '- 任何用户都可以写入自己的对话级 namespace（{accountId}:{mode}）',
      '- 只有 owner 才能写入非对话级 namespace（如 enterprise, global）',
      '- store_summary 强制限制只能写入对话级 namespace',
    ].join('\n'),
    parameters: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['store_text', 'store_file', 'store_summary'],
          description: '操作类型：store_text（存文本）、store_file（存文件）、store_summary（存总结）',
        },
        content: {
          type: 'string',
          description: '要存入知识库的文字内容（action=store_text 时必填）',
        },
        filePath: {
          type: 'string',
          description: '文件路径（action=store_file 时必填，支持 .md, .txt, .csv, .json）',
        },
        topic: {
          type: 'string',
          description: '对话主题（action=store_summary 时必填）',
        },
        text: {
          type: 'string',
          description: '总结内容（action=store_summary 时必填）',
        },
        namespace: {
          type: 'string',
          description:
            '知识库命名空间。默认对话级别（{accountId}:{mode}）。只有 owner 可写入 enterprise 等全局 namespace',
        },
        sourceId: {
          type: 'string',
          description:
            '来源标识。默认：store_text 取 content 前 30 字符，store_file 取文件名，store_summary 取 topic',
        },
      },
      required: ['action'],
    },
    async execute(_toolCallId: string, params: unknown) {
      const p = params as KnowledgeAddParams;

      if (!p.action) {
        return failedResult('缺少必填参数 action');
      }

      // === 1. store_text ===
      if (p.action === 'store_text') {
        if (!p.content || typeof p.content !== 'string' || p.content.trim().length === 0) {
          return failedResult('action=store_text 时必须提供非空的 content 参数');
        }
        const content = p.content.trim();
        const sourceId = p.sourceId || content.slice(0, 30);
        let namespace = p.namespace;

        if (!namespace) {
          const accountId = ctx.agentAccountId ?? 'default';
          const mode = ctx.agentId ? 'agent' : 'bot';
          namespace = `${accountId}:${mode}`;
        }

        if (!isSessionNamespace(namespace) && !ctx.senderIsOwner) {
          return failedResult('只有 owner 才能写入非对话级 namespace');
        }

        try {
          return await handleStoreText(content, namespace, sourceId, ctx);
        } catch (err) {
          return failedResult(`存储失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // === 2. store_file ===
      if (p.action === 'store_file') {
        if (!p.filePath || typeof p.filePath !== 'string') {
          return failedResult('action=store_file 时必须提供 filePath 参数');
        }
        const sourceId = p.sourceId || basename(p.filePath);
        let namespace = p.namespace;

        if (!namespace) {
          const accountId = ctx.agentAccountId ?? 'default';
          const mode = ctx.agentId ? 'agent' : 'bot';
          namespace = `${accountId}:${mode}`;
        }

        if (!isSessionNamespace(namespace) && !ctx.senderIsOwner) {
          return failedResult('只有 owner 才能写入非对话级 namespace');
        }

        try {
          return await handleStoreFile(p.filePath, namespace, sourceId, ctx);
        } catch (err) {
          return failedResult(`存储失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // === 3. store_summary ===
      if (p.action === 'store_summary') {
        if (!p.topic || typeof p.topic !== 'string' || p.topic.trim().length === 0) {
          return failedResult('action=store_summary 时必须提供非空的 topic 参数');
        }
        if (!p.text || typeof p.text !== 'string' || p.text.trim().length === 0) {
          return failedResult('action=store_summary 时必须提供非空的 text 参数');
        }

        let namespace = p.namespace;
        if (!namespace) {
          const accountId = ctx.agentAccountId ?? 'default';
          const mode = ctx.agentId ? 'agent' : 'bot';
          namespace = `${accountId}:${mode}`;
        }

        if (!isSessionNamespace(namespace)) {
          return failedResult('store_summary 只支持写入对话级 namespace（{accountId}:{mode}），不允许写入全局 namespace');
        }

        const sourceId = p.sourceId || p.topic.trim();

        try {
          return await handleStoreSummary(p.topic.trim(), p.text.trim(), namespace, sourceId, ctx);
        } catch (err) {
          return failedResult(`存储失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return failedResult(`未知操作类型: ${String(p.action)}，支持 store_text、store_file、store_summary`);
    },
  };
}
