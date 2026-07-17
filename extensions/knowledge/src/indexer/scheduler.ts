/**
 * @fileoverview 文档索引调度器 — RAG 管道 **摄取（Ingest）** 编排层。
 *
 * @description
 * 负责将原始文档转为可检索向量块并写入 `VectorStore`：
 * 1. 从本地路径（后续可扩展企微文档/URL）加载文本；
 * 2. 可选 `DocParser` 将 PDF/图像等非纯文本转为 Markdown；
 * 3. `chunkText` 切分 → `embedBatch` 向量化 → 原子替换持久化。
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
import { safeKnowledgeError } from '../shared/safe-error.js';

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
const PLAIN_TEXT_EXTS = ['.md', '.txt', '.text', '.csv', '.json'];

const sourceWriteQueues = new WeakMap<VectorStore, Map<string, Promise<void>>>();
const storeMutationGates = new WeakMap<VectorStore, StoreMutationGate>();

type MutationWaiter = {
  kind: 'shared' | 'exclusive';
  resolve: (release: () => void) => void;
};

/**
 * Store 级公平读写门闩。
 *
 * 普通 source 更新取得 shared 租约，因此不同 source 仍可并行；namespace clear 取得
 * exclusive 租约，等待所有已登记更新完成，并阻止清空之后到达的新更新越过屏障。
 */
class StoreMutationGate {
  private activeShared = 0;
  private exclusiveActive = false;
  private readonly waiters: MutationWaiter[] = [];

  acquireShared(): Promise<() => void> {
    return new Promise((resolve) => {
      const waiter: MutationWaiter = { kind: 'shared', resolve };
      if (!this.exclusiveActive && this.waiters.length === 0) this.grantShared(waiter);
      else this.waiters.push(waiter);
    });
  }

  acquireExclusive(): Promise<() => void> {
    return new Promise((resolve) => {
      const waiter: MutationWaiter = { kind: 'exclusive', resolve };
      if (!this.exclusiveActive && this.activeShared === 0 && this.waiters.length === 0) {
        this.grantExclusive(waiter);
      } else {
        this.waiters.push(waiter);
      }
    });
  }

  private grantShared(waiter: MutationWaiter): void {
    this.activeShared += 1;
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      this.activeShared -= 1;
      this.drain();
    });
  }

  private grantExclusive(waiter: MutationWaiter): void {
    this.exclusiveActive = true;
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      this.exclusiveActive = false;
      this.drain();
    });
  }

  private drain(): void {
    if (this.exclusiveActive) return;
    const first = this.waiters[0];
    if (!first) return;
    if (first.kind === 'exclusive') {
      if (this.activeShared > 0) return;
      this.waiters.shift();
      this.grantExclusive(first);
      return;
    }
    while (this.waiters[0]?.kind === 'shared' && !this.exclusiveActive) {
      this.grantShared(this.waiters.shift()!);
    }
  }
}

function mutationGate(store: VectorStore): StoreMutationGate {
  let gate = storeMutationGates.get(store);
  if (!gate) {
    gate = new StoreMutationGate();
    storeMutationGates.set(store, gate);
  }
  return gate;
}

/**
 * 对同一 Store、同一 `sourceId` 的完整重建流程加串行写锁。
 *
 * 锁覆盖“读取→切块→向量化→替换”，防止较早请求后完成并覆盖较新的索引；不同
 * sourceId 仍可并行。队尾完成后会清理 WeakMap，避免长期运行时积累锁条目。
 */
export async function withSourceWriteLock<T>(
  store: VectorStore,
  sourceId: string,
  operation: () => Promise<T>,
): Promise<T> {
  // shared 租约在等待 source 队列前登记，使稍后到达的 clear 必须等待本次调用，
  // 不会出现“旧更新排队中、clear 先执行、旧更新随后把数据写回来”的顺序反转。
  const releaseShared = await mutationGate(store).acquireShared();
  let queue = sourceWriteQueues.get(store);
  if (!queue) {
    queue = new Map<string, Promise<void>>();
    sourceWriteQueues.set(store, queue);
  }

  const previous = queue.get(sourceId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  queue.set(sourceId, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (queue.get(sourceId) === tail) queue.delete(sourceId);
    if (queue.size === 0) sourceWriteQueues.delete(store);
    releaseShared();
  }
}

/**
 * 在 namespace 级破坏性变更周围建立独占屏障；目前用于 clear。
 * 屏障按调用顺序等待此前 source 更新，并让此后更新在清空完成后再开始。
 */
export async function withStoreExclusiveWriteLock<T>(
  store: VectorStore,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await mutationGate(store).acquireExclusive();
  try {
    return await operation();
  } finally {
    release();
  }
}

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
      // 不在库层直接打印 owner 文件路径；宿主若需要审计，应在具备脱敏与访问控制的
      // Tool/Hook 日志边界记录 sourceId。这里仅返回解析文本，避免路径泄露到 stdout。
      return result.text;
    } catch (err) {
      // filePath 已由受控摄取边界校验，这里仍不能把宿主路径或 Provider 凭据带回 Tool。
      throw new Error(`Parser failed: ${safeKnowledgeError(err)}`);
    }
  }

  throw new Error(
    `Unsupported file type: ${ext} (supported: ${PLAIN_TEXT_EXTS.join(', ')}). ` +
    `To parse ${ext} files, configure knowledge.parser in your config.`
  );
}

/**
 * @description 索引单个文档：同 sourceId 串行执行 load → chunk → embed → 原子替换。
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
  return withSourceWriteLock(store, sourceId, async () => {
    try {
      const text = await loadDocument(filePath, parserConfig);
      if (!text.trim()) throw new Error(`Document ${sourceId} is empty; existing index was preserved`);
      const chunks = chunkText(text, sourceId, chunkerConfig);

      const texts = chunks.map((c) => c.text);
      const vectors = texts.length > 0 ? await embedding.embedBatch(texts) : [];

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

      await store.replaceBySource(sourceId, vectorChunks);

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
        error: safeKnowledgeError(error, '文档索引失败'),
      };
    }
  });
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
