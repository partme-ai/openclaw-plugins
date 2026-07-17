/**
 * @fileoverview SQLite-Vec 持久化向量存储 — 生产默认后端。
 *
 * @description Node.js 内置 SQLite + BLOB 向量 + FTS5 双通道检索；按 namespace 分表隔离。
 * **模块角色**：Knowledge Plugin · VectorStore (sqlite-vec)。
 * **关键依赖**：`node:sqlite`（OpenClaw Node.js 22+ 运行时内置）。
 *
 * @module knowledge/store/sqlite-vec
 */

import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { VectorStore, VectorChunk, VectorChunkMetadata, SearchOptions, ScoredChunk, StoreStats } from '../types.js';
import { cosineSimilarity } from './math.js';
import { DatabaseSync, type DatabaseSyncInstance } from './sqlite-runtime.js';
import { assertVector } from './vector-validation.js';

/** SQLite-Vec 配置 */
export type SqliteVecConfig = {
  /** 数据库文件路径 */
  dbPath: string;
  /** 命名空间（用于多租户隔离） */
  namespace: string;
  /** 嵌入维度 */
  dimensions: number;
};

/** 内部表结构行（不含 BLOB 向量字段） */
type ChunkRow = {
  id: string;
  source_id: string;
  chunk_index: number;
  text: string;
  metadata_json: string;
};

/** FTS5 搜索结果行 */
type FtsRow = {
  id: string;
  text: string;
  rank: number;
};

/** SQLite 查询结果行（含 BLOB 向量） */
type ChunkRowWithVector = ChunkRow & { vector: Uint8Array };

/**
 * Knowledge 默认的持久化向量 Store。
 *
 * 每个 namespace 使用独立向量表和 FTS5 表；`replaceBySource` 在一个 SQLite 事务
 * 中同步替换两张表，失败时保留旧索引。WAL 与 busy timeout 用于提升单机并发稳定性。
 */
export class SqliteVecStore implements VectorStore {
  private config: SqliteVecConfig;
  private db: DatabaseSyncInstance | null = null;
  private namespaceTable: string;
  private ftsTable: string;

  constructor(config: SqliteVecConfig) {
    this.config = config;
    // 命名空间作为表名一部分，自动转义防止注入
    this.namespaceTable = `vec_${this.sanitizeName(config.namespace)}`;
    this.ftsTable = `fts_${this.sanitizeName(config.namespace)}`;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.config.dbPath), { recursive: true });

    const db = new DatabaseSync(this.config.dbPath);
    this.db = db;

    // 启用 WAL 模式提升并发性能
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');

    // 创建向量表（每行一个 chunk，向量存为 BLOB）
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.namespaceTable} (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL DEFAULT '',
        chunk_index INTEGER NOT NULL DEFAULT 0,
        vector BLOB NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // 创建 source_id 索引以加速按来源删除
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.namespaceTable}_source_id
      ON ${this.namespaceTable}(source_id);
    `);

    // 创建 FTS5 全文搜索虚拟表
    // 使用独立 FTS 表并手动同步，避免 external-content 触发器漂移。
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${this.ftsTable} USING fts5(
        id UNINDEXED,
        text,
        source_id UNINDEXED,
        tokenize='unicode61'
      );
    `);

    // 同步已存在的数据到 FTS（首次创建时）
    db.exec(`
      INSERT INTO ${this.ftsTable}(id, text, source_id)
      SELECT source.id, source.text, source.source_id FROM ${this.namespaceTable} AS source
      WHERE NOT EXISTS (SELECT 1 FROM ${this.ftsTable} AS search WHERE search.id = source.id);
    `);
  }

  async upsert(chunks: VectorChunk[]): Promise<void> {
    if (!this.db) throw new Error('SqliteVecStore not initialized');
    for (const chunk of chunks) assertVector(chunk.vector, this.config.dimensions, `chunk ${chunk.id}`);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ${this.namespaceTable} (id, source_id, chunk_index, vector, text, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const deleteFtsStmt = this.db.prepare(`DELETE FROM ${this.ftsTable} WHERE id = ?`);
    const ftsStmt = this.db.prepare(`
      INSERT INTO ${this.ftsTable}(id, text, source_id)
      VALUES (?, ?, ?)
    `);

    this.withTransaction(() => {
      for (const chunk of chunks) {
        deleteFtsStmt.run(chunk.id);
        stmt.run(
          chunk.id,
          chunk.metadata.sourceId ?? '',
          chunk.metadata.chunkIndex ?? 0,
          Buffer.from(new Float32Array(chunk.vector).buffer),
          chunk.metadata.text,
          JSON.stringify(chunk.metadata),
        );
        // 同步 FTS5
        ftsStmt.run(
          chunk.id,
          chunk.metadata.text,
          chunk.metadata.sourceId ?? '',
        );
      }
    });
  }

  async replaceBySource(sourceId: string, chunks: VectorChunk[]): Promise<void> {
    if (!this.db) throw new Error('SqliteVecStore not initialized');
    for (const chunk of chunks) {
      assertVector(chunk.vector, this.config.dimensions, `chunk ${chunk.id}`);
      if ((chunk.metadata.sourceId ?? '') !== sourceId) {
        throw new Error(`chunk ${chunk.id} sourceId does not match replacement source ${sourceId}`);
      }
    }

    const db = this.db;
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO ${this.namespaceTable} (id, source_id, chunk_index, vector, text, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertFtsStmt = db.prepare(`
      INSERT INTO ${this.ftsTable}(id, text, source_id)
      VALUES (?, ?, ?)
    `);

    this.withTransaction(() => {
      db.prepare(`DELETE FROM ${this.ftsTable} WHERE source_id = ?`).run(sourceId);
      db.prepare(`DELETE FROM ${this.namespaceTable} WHERE source_id = ?`).run(sourceId);
      for (const chunk of chunks) {
        insertStmt.run(
          chunk.id,
          sourceId,
          chunk.metadata.chunkIndex ?? 0,
          Buffer.from(new Float32Array(chunk.vector).buffer),
          chunk.metadata.text,
          JSON.stringify(chunk.metadata),
        );
        insertFtsStmt.run(chunk.id, chunk.metadata.text, sourceId);
      }
    });
  }

  async upsertBatch(chunks: VectorChunk[], batchSize = 100): Promise<void> {
    // SQLite transaction 已包含批量语义
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      await this.upsert(batch);
    }
  }

  /**
   * 向量语义检索 — 全表扫描 + 余弦相似度计算
   *
   * 从 SQLite 中读取所有行（或按 sourceId 过滤），
   * 逐个计算余弦相似度，按分数排序取 topK。
   */
  async search(vector: number[], options?: SearchOptions): Promise<ScoredChunk[]> {
    if (!this.db) throw new Error('SqliteVecStore not initialized');
    assertVector(vector, this.config.dimensions, 'query vector');

    const topK = options?.topK ?? 5;
    const minScore = options?.minScore ?? 0.0;
    const filterSourceId = options?.sourceId;

    // 全表扫描（或按 sourceId 过滤）
    let rows: ChunkRowWithVector[];
    if (filterSourceId) {
      rows = this.db.prepare(
        `SELECT id, source_id, chunk_index, vector, text, metadata_json FROM ${this.namespaceTable} WHERE source_id = ?`
      ).all(filterSourceId) as ChunkRowWithVector[];
    } else {
      rows = this.db.prepare(
        `SELECT id, source_id, chunk_index, vector, text, metadata_json FROM ${this.namespaceTable}`
      ).all() as ChunkRowWithVector[];
    }

    const scored: ScoredChunk[] = [];

    for (const row of rows) {
      const bytes = row.vector;
      const storedVec = Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT));
      const score = cosineSimilarity(vector, storedVec);

      if (score < minScore) continue;

      const metadata = JSON.parse(row.metadata_json) as VectorChunkMetadata;

      scored.push({
        chunk: {
          id: row.id,
          vector: storedVec,
          metadata: {
            ...metadata,
            sourceId: row.source_id,
            chunkIndex: row.chunk_index,
            text: row.text,
          },
        },
        score,
      });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * FTS5 关键词检索 — 供 Hybrid Retriever 调用
   * 比全表扫描 keyword 检索快几个数量级
   */
  async keywordSearch(query: string, topK: number = 5, sourceId?: string): Promise<ScoredChunk[]> {
    if (!this.db) throw new Error('SqliteVecStore not initialized');

    // 对中文查询进行格式化为 FTS5 短语搜索
    // FTS5 的 unicode61 tokenizer 支持 CJK 字符
    const ftsQuery = this.buildFtsQuery(query);
    if (!ftsQuery) return [];

    let rows: FtsRow[];
    if (sourceId) {
      rows = this.db.prepare(
        `SELECT id, text, rank FROM ${this.ftsTable}
         WHERE ${this.ftsTable} MATCH ?
         AND source_id = ?
         ORDER BY rank
         LIMIT ?`
      ).all(ftsQuery, sourceId, topK) as FtsRow[];
    } else {
      rows = this.db.prepare(
        `SELECT id, text, rank FROM ${this.ftsTable}
         WHERE ${this.ftsTable} MATCH ?
         ORDER BY rank
         LIMIT ?`
      ).all(ftsQuery, topK) as FtsRow[];
    }

    if (rows.length === 0) return [];

    // 通过 chunk id 查找对应的完整数据
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const chunks = this.db.prepare(
      `SELECT id, source_id, chunk_index, vector, text, metadata_json
       FROM ${this.namespaceTable}
       WHERE id IN (${placeholders})`
    ).all(...ids) as ChunkRowWithVector[];

    // 用 id 索引查询结果
    const chunksById = new Map(chunks.map(c => [c.id, c]));

    const results: ScoredChunk[] = [];
    for (const ftsRow of rows) {
      const chunk = chunksById.get(ftsRow.id);
      if (!chunk) continue;

      // FTS5 rank 是负的 bm25 分数（越小越相关），转换为 0-1 分数
      // bm25_score = 1 / (1 + |rank|)，范围 0-1
      const bm25Score = 1 / (1 + Math.abs(ftsRow.rank));

      const metadata = JSON.parse(chunk.metadata_json) as VectorChunkMetadata;
      const bytes = chunk.vector;
      const storedVector = Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT));

      results.push({
        chunk: {
          id: chunk.id,
          vector: storedVector,
          metadata: {
            ...metadata,
            sourceId: chunk.source_id,
            chunkIndex: chunk.chunk_index,
            text: chunk.text,
          },
        },
        score: bm25Score,
      });
    }

    return results;
  }

  async deleteBySource(sourceId: string): Promise<void> {
    if (!this.db) throw new Error('SqliteVecStore not initialized');
    const db = this.db;

    this.withTransaction(() => {
      // 删除该 source 的所有 id
      const ids = db.prepare(
        `SELECT id FROM ${this.namespaceTable} WHERE source_id = ?`
      ).all(sourceId) as { id: string }[];

      // 从 FTS5 删除
      for (const row of ids) {
        db.prepare(
          `DELETE FROM ${this.ftsTable} WHERE id = ?`
        ).run(row.id);
      }

      // 从向量表删除
      db.prepare(`DELETE FROM ${this.namespaceTable} WHERE source_id = ?`).run(sourceId);
    });
  }

  async clear(): Promise<void> {
    if (!this.db) throw new Error('SqliteVecStore not initialized');
    const db = this.db;

    this.withTransaction(() => {
      // 清空 FTS5
      db.exec(`DELETE FROM ${this.ftsTable}`);
      // 清空向量表
      db.exec(`DELETE FROM ${this.namespaceTable}`);
    });
  }

  stats(): Promise<StoreStats> {
    if (!this.db) throw new Error('SqliteVecStore not initialized');

    const { count: totalChunks } = this.db.prepare(
      `SELECT COUNT(*) as count FROM ${this.namespaceTable}`
    ).get() as { count: number };

    const { count: totalDocuments } = this.db.prepare(
      `SELECT COUNT(DISTINCT source_id) as count FROM ${this.namespaceTable} WHERE source_id != ''`
    ).get() as { count: number };

    return Promise.resolve({
      totalChunks,
      totalDocuments,
      provider: 'sqlite-vec',
      dimensions: this.config.dimensions,
    });
  }

  /** 生成 chunk ID */
  static generateId(namespace: string, sourceId: string, chunkIndex: number): string {
    return `${namespace}:${sourceId}:${chunkIndex}:${randomUUID().slice(0, 8)}`;
  }

  /** 关闭数据库连接 */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private withTransaction(operation: () => void): void {
    if (!this.db) throw new Error('SqliteVecStore not initialized');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      operation();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * 构建 FTS5 查询字符串
   * - 英文单词用 NEAR/AND 组合
   * - 中文字符直接传入（unicode61 自动识别）
   * - 空查询返回空字符串
   */
  private buildFtsQuery(query: string): string {
    const trimmed = query.trim();
    if (!trimmed) return '';

    // 提取英文单词
    const englishWords = trimmed.match(/[a-zA-Z0-9]+/g) || [];
    // 提取中文字符（连续的汉字序列）
    const chineseBlocks = trimmed.match(/[\u4e00-\u9fff\u3400-\u4dbf]+/g) || [];

    const parts: string[] = [];

    // 英文单词：用 AND 连接
    if (englishWords.length > 0) {
      if (englishWords.length === 1) {
        parts.push(`"${englishWords[0].toLowerCase()}"`);
      } else {
        parts.push(englishWords.map(w => `"${w.toLowerCase()}"`).join(' AND '));
      }
    }

    // 中文字块：FTS5 unicode61 自动按字符切分，直接传
    for (const block of chineseBlocks) {
      parts.push(`"${block}"`);
    }

    // 如果既有英文又有中文，用 AND 连接
    if (parts.length === 0) return '';
    return parts.join(' AND ');
  }

  /** 清理命名空间名（仅允许字母数字下划线） */
  private sanitizeName(name: string): string {
    const sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    if (name === sanitized) return sanitized;
    const suffix = createHash('sha256').update(name).digest('hex').slice(0, 12);
    return `${sanitized.slice(0, 48)}_${suffix}`;
  }
}
