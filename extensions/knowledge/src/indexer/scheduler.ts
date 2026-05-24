/**
 * @fileoverview 文档索引调度器 — RAG 管道 **摄取（Ingest）** 编排层。
 *
 * @description
 * 负责将原始文档转为可检索向量块并写入 `VectorStore`：
 * 1. 从本地路径（后续可扩展企微文档/URL）加载文本；
 * 2. 可选 `DocParser` 将 PDF/图像等非纯文本转为 Markdown；
 * 3. `chunkText` 切分 → `embedBatch` 向量化 → `upsert` 持久化。
 *
 * **模块角色**：Knowledge Plugin · Indexing orchestrator。
 * **关键依赖**：`chunker`、`embedding/factory`、`parser/factory`、`store`（由调用方注入实例）。
 *
 * @module knowledge/indexer/scheduler
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { EmbeddingService, VectorStore, ScoredChunk, DocParserService, KnowledgeParserConfig } from '../types.js';
import { createParserService } from '../parser/factory.js';
import { chunkText } from './chunker.js';
import type { ChunkerConfig } from './chunker.js';

/** 单文档索引结果摘要。 */
export type IndexResult = {
  /** 本次成功写入的向量块数量。 */
  chunksAdded: number;
  /** 业务侧文档标识（与 VectorStore metadata.sourceId 对齐）。 */
  sourceId: string;
  /** 索引流程是否整体成功。 */
  success: boolean;
  /** 失败时的可读错误信息。 */
  error?: string;
};

// ===================================================================
// 文档加载（含可选 Parser 节点）
// ===================================================================

/** 无需 Parser 即可直接读取的纯文本扩展名。 */
const PLAIN_TEXT_EXTS = ['.md', '.txt', '.csv', '.json'];

/**
 * @description 仅在配置了 `parser.provider` 时惰性构造 `DocParserService`。
 *
 * @param parserConfig - 可选 Parser 配置片段。
 * @returns 解析器实例；未配置或构造失败时返回 `null`。
 */
function createParserIfConfigured(parserConfig?: KnowledgeParserConfig): DocParserService | null {
  if (!parserConfig?.provider) return null;
  try {
    return createParserService(parserConfig);
  } catch {
    return null;
  }
}

/**
 * @description 从磁盘路径加载文档正文：纯文本直读，二进制/Office 走 Parser 分支。
 *
 * @param filePath - 本地文件绝对或相对路径。
 * @param parserConfig - 非纯文本扩展名时使用的 Parser 配置。
 * @returns UTF-8 文本内容（Parser 输出 Markdown 字符串）。
 * @throws 不支持的扩展名且未配置 Parser；或 Parser 调用失败。
 */
export async function loadDocument(
  filePath: string,
  parserConfig?: KnowledgeParserConfig,
): Promise<string> {
  const ext = extname(filePath).toLowerCase();

  // 纯文本：跳过 Parser，直接 fs 读取
  if (PLAIN_TEXT_EXTS.includes(ext)) {
    return await readFile(filePath, 'utf-8');
  }

  // 非纯文本：尝试 Parser 流水线
  const parser = createParserIfConfigured(parserConfig);
  if (parser) {
    try {
      const result = await parser.parse(filePath);
      console.log(`[Knowledge] Parser succeeded for ${filePath}: ${result.metadata.fileName}, ${result.text.length} chars`);
      return result.text;
    } catch (err) {
      throw new Error(
        `Parser failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  throw new Error(
    `Unsupported file type: ${ext} (supported: ${PLAIN_TEXT_EXTS.join(', ')}). ` +
    `To parse ${ext} files, configure knowledge.parser in your config.`
  );
}

/**
 * @description 索引单个文档：**deleteBySource → chunk → embed → upsert** 幂等覆盖语义。
 *
 * @param filePath - 源文件路径。
 * @param sourceId - 稳定文档键，重复索引会替换同 source 的全部块。
 * @param embedding - 已初始化的嵌入服务。
 * @param store - 目标向量库。
 * @param chunkerConfig - 可选切分参数覆盖。
 * @param parserConfig - 可选非纯文本解析配置。
 * @returns {@link IndexResult}；捕获异常并写入 `error` 字段而非抛出。
 */
export async function indexDocument(
  filePath: string,
  sourceId: string,
  embedding: EmbeddingService,
  store: VectorStore,
  chunkerConfig?: Partial<ChunkerConfig>,
  parserConfig?: KnowledgeParserConfig,
): Promise<IndexResult> {
  try {
    const text = await loadDocument(filePath, parserConfig);
    const chunks = chunkText(text, sourceId, chunkerConfig);

    if (chunks.length === 0) {
      return { chunksAdded: 0, sourceId, success: true };
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
        filePath,
      },
    }));

    // 先删后写，保证同 sourceId 重索引不产生孤儿块
    await store.deleteBySource(sourceId);
    await store.upsert(vectorChunks);

    return {
      chunksAdded: vectorChunks.length,
      sourceId,
      success: true,
    };
  } catch (error) {
    return {
      chunksAdded: 0,
      sourceId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @description 顺序批量索引多个 `{ filePath, sourceId }` 条目（无并行，便于控制 API 速率）。
 *
 * @param sources - 待索引文件列表。
 * @param embedding - 嵌入服务。
 * @param store - 向量库。
 * @param chunkerConfig - 可选切分覆盖。
 * @param parserConfig - 可选 Parser 配置。
 * @returns 与输入顺序一致的 {@link IndexResult} 数组。
 */
export async function indexDocuments(
  sources: { filePath: string; sourceId: string }[],
  embedding: EmbeddingService,
  store: VectorStore,
  chunkerConfig?: Partial<ChunkerConfig>,
  parserConfig?: KnowledgeParserConfig,
): Promise<IndexResult[]> {
  const results: IndexResult[] = [];

  for (const { filePath, sourceId } of sources) {
    const result = await indexDocument(filePath, sourceId, embedding, store, chunkerConfig, parserConfig);
    results.push(result);
  }

  return results;
}

/**
 * @description 面向 Hook/Tool 的轻量检索封装：单 query 嵌入 + `store.search` + 上下文文本拼装。
 *
 * @param query - 用户自然语言查询。
 * @param embedding - 嵌入服务。
 * @param store - 向量库。
 * @param topK - 返回条数上限，默认 5。
 * @param minScore - 相似度阈值，默认 0。
 * @param sourceId - 可选按来源过滤。
 * @returns 打分块列表与带序号/相似度的可读 `contextText`。
 */
export async function retrieveContext(
  query: string,
  embedding: EmbeddingService,
  store: VectorStore,
  topK: number = 5,
  minScore: number = 0.0,
  sourceId?: string,
): Promise<{ chunks: ScoredChunk[]; contextText: string }> {
  const vector = await embedding.embed(query);
  const chunks = await store.search(vector, { topK, minScore, sourceId });

  const contextText = chunks
    .map((scored, i) => `[${i + 1}] (相似度: ${(scored.score * 100).toFixed(1)}%)\n${scored.chunk.metadata.text}`)
    .join('\n\n---\n\n');

  return { chunks, contextText };
}
