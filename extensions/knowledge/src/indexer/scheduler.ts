/**
 * 文档索引调度器
 *
 * 负责：
 * 1. 从文档来源（本地文件/企微文档/URL）读取原始文本
 * 2. 调用 chunker 切分
 * 3. 调用 embedding 生成向量
 * 4. 存入 VectorStore
 *
 * 可选流水线节点：
 * - parser: 解析非纯文本文件（PDF/图片等）为 Markdown 文本
 *
 * 第一版支持：本地文件索引（传入文件路径列表）
 * 后续支持：企微文档库 API 轮询、Webhook 增量更新
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { EmbeddingService, VectorStore, TextChunk, ScoredChunk, DocParserService, KnowledgeParserConfig } from '../types.js';
import { createParserService } from '../parser/factory.js';
import { chunkText } from './chunker.js';
import type { ChunkerConfig } from './chunker.js';

/** 文档索引结果 */
export type IndexResult = {
  /** 新增的块数 */
  chunksAdded: number;
  /** 处理的文档 ID */
  sourceId: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
};

// ===================================================================
// 文档加载（含可选 Parser 节点）
// ===================================================================

/** 支持的纯文本扩展名 */
const PLAIN_TEXT_EXTS = ['.md', '.txt', '.csv', '.json'];

/**
 * 创建 Parser 实例（可选）
 * 仅在配置了 parser.provider 时创建，否则返回 null
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
 * 文档加载器 — 从文件路径读取文本
 *
 * 流程：
 * 1. 如果是纯文本文件（.md/.txt/.csv/.json），直接读取
 * 2. 如果是其他文件（.pdf/.png/.jpg/.docx 等），检查是否有 parser 配置
 *    - 有 parser → 用 parser 解析后返回文本
 *    - 无 parser → 抛错误（不支持的文件类型）
 *
 * @param filePath - 文件路径
 * @param parserConfig - 可选的 Parser 配置（用于解析非纯文本文件）
 * @returns 解析后的文本内容
 */
export async function loadDocument(
  filePath: string,
  parserConfig?: KnowledgeParserConfig,
): Promise<string> {
  const ext = extname(filePath).toLowerCase();

  // 纯文本文件直接读取
  if (PLAIN_TEXT_EXTS.includes(ext)) {
    return await readFile(filePath, 'utf-8');
  }

  // 非纯文本文件：尝试用 parser 解析
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

  // 无 parser 配置且不是纯文本文件
  throw new Error(
    `Unsupported file type: ${ext} (supported: ${PLAIN_TEXT_EXTS.join(', ')}). ` +
    `To parse ${ext} files, configure knowledge.parser in your config.`
  );
}

/**
 * 索引单个文档
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

    // 批量生成嵌入
    const texts = chunks.map((c) => c.text);
    const vectors = await embedding.embedBatch(texts);

    // 组合为 VectorChunk
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

    // 先删除旧数据再写入
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
 * 批量索引多个文档
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
 * 从 VectorStore 检索上下文 - 供 before_prompt_build hook 使用
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
