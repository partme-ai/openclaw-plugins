/**
 * @fileoverview ZVec — 纯 JS 内存向量引擎（零 npm 依赖）。
 *
 * @description 开发/轻量场景；可选 JSON 文件异步持久化。生产推荐 `sqlite-vec`。
 * **模块角色**：Knowledge Plugin · VectorStore (in-memory)。
 * **关键依赖**：`./math` 余弦相似度。
 *
 * @module knowledge/store/zvec
 */

import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { VectorStore, VectorChunk, VectorChunkMetadata, SearchOptions, ScoredChunk, StoreStats } from '../types.js';
import { cosineSimilarity } from './math.js';
import { assertVector } from './vector-validation.js';
import { safeKnowledgeError } from '../shared/safe-error.js';

/** ZVec 配置 */
export type ZVecConfig = {
  /** 命名空间（用于多租户隔离） */
  namespace: string;
  /** 嵌入维度 */
  dimensions: number;
  /** 持久化文件路径（可选，设置后自动持久化） */
  dbPath?: string;
  /** 自动保存间隔（毫秒，默认 5000） */
  autoSaveIntervalMs?: number;
};

/** 内部存储格式 */
type ZVecRecord = {
  id: string;
  vector: number[];
  metadata: VectorChunkMetadata;
};

/**
 * 轻量级内存向量库，面向本地开发和小规模单进程部署。
 *
 * 检索始终在内存中完成；配置 `dbPath` 后，以临时文件写入再原子重命名的方式
 * 保存 JSON 快照。它不提供跨进程锁、WAL 或事务隔离，生产多实例场景应使用
 * {@link SqliteVecStore} 等具备事务能力的后端。
 */
export class ZVecStore implements VectorStore {
  private records: ZVecRecord[] = [];
  private config: ZVecConfig;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private mutationVersion = 0;
  private flushPromise: Promise<void> | null = null;

  constructor(config: ZVecConfig) {
    this.config = {
      autoSaveIntervalMs: 5000,
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (this.config.dbPath) {
      try {
        const raw = await readFile(this.config.dbPath, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('持久化快照根节点必须是数组');

        // 不能过滤坏记录后继续启动：静默丢弃会让“部分索引损坏”伪装成正常空库。
        for (const [index, record] of parsed.entries()) {
          if (!isZVecRecord(record)) throw new Error(`持久化快照第 ${index} 条记录结构无效`);
          assertVector(record.vector, this.config.dimensions, `persisted record ${record.id}`);
        }
        this.records = parsed;
      } catch (error) {
        if (isFileNotFound(error)) {
          this.records = [];
          return;
        }
        throw new Error(`无法加载 ZVec 持久化快照 ${this.config.dbPath}`, { cause: error });
      }
    }
  }

  async upsert(chunks: VectorChunk[]): Promise<void> {
    for (const chunk of chunks) assertVector(chunk.vector, this.config.dimensions, `chunk ${chunk.id}`);
    for (const chunk of chunks) {
      const existing = this.records.findIndex((r) => r.id === chunk.id);
      const record: ZVecRecord = {
        id: chunk.id,
        vector: chunk.vector,
        metadata: chunk.metadata,
      };
      if (existing >= 0) {
        this.records[existing] = record;
      } else {
        this.records.push(record);
      }
    }
    this.dirty = true;
    this.mutationVersion += 1;
    this.scheduleSave();
  }

  async replaceBySource(sourceId: string, chunks: VectorChunk[]): Promise<void> {
    for (const chunk of chunks) {
      assertVector(chunk.vector, this.config.dimensions, `chunk ${chunk.id}`);
      if ((chunk.metadata.sourceId ?? '') !== sourceId) {
        throw new Error(`chunk ${chunk.id} sourceId does not match replacement source ${sourceId}`);
      }
    }

    const replacements = chunks.map((chunk) => ({
      id: chunk.id,
      vector: chunk.vector,
      metadata: chunk.metadata,
    }));
    this.records = [
      ...this.records.filter((record) => record.metadata.sourceId !== sourceId),
      ...replacements,
    ];
    this.dirty = true;
    this.mutationVersion += 1;
    this.scheduleSave();
  }

  async upsertBatch(chunks: VectorChunk[], batchSize = 100): Promise<void> {
    for (const chunk of chunks) assertVector(chunk.vector, this.config.dimensions, `chunk ${chunk.id}`);
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      // 批量处理（sync 但避免大数组一次性写入的 stack 问题）
      for (const chunk of batch) {
        const existing = this.records.findIndex((r) => r.id === chunk.id);
        const record: ZVecRecord = {
          id: chunk.id,
          vector: chunk.vector,
          metadata: chunk.metadata,
        };
        if (existing >= 0) {
          this.records[existing] = record;
        } else {
          this.records.push(record);
        }
      }
      // 中间批次手动让出事件循环
      if (i + batchSize < chunks.length) {
        await new Promise((r) => setImmediate(r));
      }
    }
    this.dirty = true;
    this.mutationVersion += 1;
    this.scheduleSave();
  }

  async search(vector: number[], options?: SearchOptions): Promise<ScoredChunk[]> {
    assertVector(vector, this.config.dimensions, 'query vector');
    const topK = options?.topK ?? 5;
    const minScore = options?.minScore ?? 0.0;

    let candidates = this.records;

    // 按 sourceId 过滤
    if (options?.sourceId) {
      candidates = candidates.filter((r) => r.metadata.sourceId === options.sourceId);
    }

    // 计算相似度
    const scored: ScoredChunk[] = candidates.map((record) => ({
      chunk: {
        id: record.id,
        vector: record.vector,
        metadata: record.metadata,
      },
      score: cosineSimilarity(vector, record.vector),
    }));

    // 阈值过滤
    const filtered = scored.filter((s) => s.score >= minScore);

    // 按相似度降序排序 + 截取 topK
    filtered.sort((a, b) => b.score - a.score);

    return filtered.slice(0, topK);
  }

  async deleteBySource(sourceId: string): Promise<void> {
    this.records = this.records.filter((r) => r.metadata.sourceId !== sourceId);
    this.dirty = true;
    this.mutationVersion += 1;
    this.scheduleSave();
  }

  async clear(): Promise<void> {
    this.records = [];
    this.dirty = true;
    this.mutationVersion += 1;
    this.scheduleSave();
  }

  stats(): Promise<StoreStats> {
    const sourceIds = new Set(this.records.map((r) => r.metadata.sourceId).filter(Boolean));
    return Promise.resolve({
      totalChunks: this.records.length,
      totalDocuments: sourceIds.size,
      provider: 'zvec',
      dimensions: this.config.dimensions,
    });
  }

  /** 立即持久化 */
  async flush(): Promise<void> {
    if (!this.config.dbPath || !this.dirty) return;
    if (this.flushPromise) {
      await this.flushPromise;
      if (this.dirty) await this.flush();
      return;
    }

    const dbPath = this.config.dbPath;
    const version = this.mutationVersion;
    const payload = JSON.stringify(this.records, null, 2);
    const tempPath = `${dbPath}.${process.pid}.${randomUUID()}.tmp`;
    this.flushPromise = (async () => {
      await mkdir(dirname(dbPath), { recursive: true });
      try {
        await writeFile(tempPath, payload, { encoding: 'utf-8', mode: 0o600 });
        await rename(tempPath, dbPath);
        if (this.mutationVersion === version) this.dirty = false;
      } finally {
        await rm(tempPath, { force: true }).catch(() => undefined);
      }
    })();
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  /** 获取命名空间 */
  getNamespace(): string {
    return this.config.namespace;
  }

  /** 生成带命名空间的 chunk ID */
  static generateId(namespace: string, sourceId: string, chunkIndex: number): string {
    return `${namespace}:${sourceId}:${chunkIndex}:${randomUUID().slice(0, 8)}`;
  }

  private scheduleSave(): void {
    if (!this.config.dbPath) return;
    if (this.saveTimer) return;

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush().catch((err) => {
        // 定时器没有上层 await 调用者；必须留下诊断，但不能输出包含持久化路径的原始 Error。
        console.error(`[knowledge] ZVec auto-save failed: ${safeKnowledgeError(err)}`);
      });
    }, this.config.autoSaveIntervalMs);
    this.saveTimer.unref?.();
  }

  /** 释放资源 */
  async dispose(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.flush();
  }
}

function isZVecRecord(value: unknown): value is ZVecRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ZVecRecord>;
  return typeof record.id === 'string'
    && Array.isArray(record.vector)
    && record.metadata !== null
    && typeof record.metadata === 'object'
    && typeof record.metadata.text === 'string';
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
