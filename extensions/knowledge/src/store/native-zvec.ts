/**
 * NativeZVecStore — 阿里 ZVec (@zvec/zvec) 原生 C++ 向量引擎包装
 *
 * 阿里 ZVec 是阿里云开源的 C++ 向量检索引擎，提供 HNSW/IVF/FLAT 索引，
 * 支持 FP32/INT8/INT4 量化。本包装将其适配为 VectorStore 接口。
 *
 * 特性：
 * - 高性能：C++ 原生，HNSW 索引 + SIMD 加速
 * - 持久化：文件级持久化，不是内存引擎
 * - 命名空间隔离：每个 namespace 使用独立集合目录
 *
 * 依赖：@zvec/zvec（运行时动态 import，非强依赖）
 *
 * @packageDocumentation
 * @module knowledge/store/native-zvec
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type {
  VectorStore,
  VectorChunk,
  VectorChunkMetadata,
  SearchOptions,
  ScoredChunk,
  StoreStats,
} from '../types.js';

// ===================================================================
// 阿里 ZVec 类型声明（动态 import，不生成编译时依赖）
// ===================================================================

/** NativeZVecStore 配置 */
export type NativeZVecConfig = {
  /** 命名空间（用于多租户隔离） */
  namespace: string;
  /** 嵌入维度 */
  dimensions: number;
  /** 数据存储根目录（默认 ./data/zvec） */
  dataDir?: string;
  /** 索引类型：'hnsw' | 'flat'（默认 'hnsw'） */
  indexType?: 'hnsw' | 'flat';
  /** HNSW M 参数（默认 16） */
  hnswM?: number;
  /** HNSW efConstruction 参数（默认 200） */
  hnswEfConstruction?: number;
  /** 查询时 HNSW ef 参数（默认 100） */
  hnswEf?: number;
};

/** 查询时的动态参数 */
type ZVecQueryParams = {
  ef?: number;
  nprobe?: number;
  isLinear?: boolean;
};

// 缓存动态加载的 ZVec 模块（单例模式）
let _zvecMod: ZvecModule | null = null;
const require = createRequire(import.meta.url);

type ZvecModule = {
  ZVecInitialize: (opts?: { logLevel?: number }) => void;
  ZVecCreateAndOpen: (path: string, schema: unknown, options?: unknown) => ZVecCollection;
  ZVecOpen: (path: string, options?: unknown) => ZVecCollection;
  ZVecDataType: Record<string, number>;
  ZVecIndexType: Record<string, number>;
  ZVecMetricType: Record<string, number>;
  ZVecCollectionSchema: new (params: {
    name: string;
    vectors: unknown[];
    fields?: unknown[];
  }) => ZVecCollectionSchema;
};

type ZVecCollectionSchema = {
  name: string;
};

type ZVecCollection = {
  path: string;
  schema: ZVecCollectionSchema;
  stats: { docCount: number; indexCompleteness: Record<string, number> };
  insertSync(doc: ZVecDocInput): ZVecStatus;
  insertSync(docs: ZVecDocInput[]): ZVecStatus[];
  upsertSync(doc: ZVecDocInput): ZVecStatus;
  upsertSync(docs: ZVecDocInput[]): ZVecStatus[];
  deleteSync(ids: string): ZVecStatus;
  deleteSync(ids: string[]): ZVecStatus[];
  deleteByFilterSync(filter: string): ZVecStatus;
  querySync(params: ZVecQueryNative): ZVecDoc[];
  fetchSync(id: string): Record<string, ZVecDoc>;
  fetchSync(ids: string[]): Record<string, ZVecDoc>;
  closeSync(): void;
  destroySync(): void;
  createIndexSync(params: {
    fieldName: string;
    indexParams: unknown;
    indexOptions?: { concurrency?: number };
  }): void;
};

type ZVecDocInput = {
  id: string;
  vectors?: Record<string, number[] | Float32Array>;
  fields?: Record<string, unknown>;
};

type ZVecDoc = {
  id: string;
  vectors: Record<string, number[]>;
  fields: Record<string, unknown>;
  score: number;
};

type ZVecStatus = {
  ok: boolean;
  code: string;
  message: string;
};

type ZVecQueryNative = {
  fieldName?: string;
  topk?: number;
  vector?: number[];
  filter?: string;
  includeVector?: boolean;
  queryParams?: ZVecQueryParams;
};

// ===================================================================
// 元数据存储 —— 阿里 ZVec 仅存 fields，我们把元数据编码进 fields
// ===================================================================

/** 内部存储格式：嵌入向量 + scalar 元数据 */
type InternalDoc = {
  id: string;
  embedding: number[];
  sourceId: string;
  text: string;
  metadataJson: string; // 完整 metadata 的 JSON 序列化
};

/** 集合名（每个 namespace 一个独立集合目录） */
function collectionDir(dataDir: string, namespace: string): string {
  return join(dataDir, sanitize(namespace));
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// ===================================================================
// NativeZVecStore
// ===================================================================

export class NativeZVecStore implements VectorStore {
  private config: NativeZVecConfig;
  private coll: ZVecCollection | null = null;
  private initialized = false;

  constructor(config: NativeZVecConfig) {
    this.config = {
      indexType: 'hnsw',
      hnswM: 16,
      hnswEfConstruction: 200,
      hnswEf: 100,
      dataDir: './data/zvec',
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const zvec = await loadZvecModule();
    const {
      namespace,
      dimensions,
      dataDir,
      indexType,
      hnswM,
      hnswEfConstruction,
    } = this.config;

    const dir = collectionDir(dataDir!, namespace);
    await mkdir(dir, { recursive: true });

    const collDir = join(dir, 'knowledge-store');
    const isNew = !existsSync(collDir);

    // Schema: 一个 FP32 向量字段 + 3 个 scalar 字段
    const { ZVecDataType, ZVecIndexType, ZVecMetricType, ZVecCollectionSchema } = zvec;

    const vectorSchema = {
      name: 'embedding',
      dataType: ZVecDataType.VECTOR_FP32,
      dimension: dimensions,
    };

    // 如果已有集合，则直接打开（跳过创建索引步骤）
    if (!isNew) {
      const coll = zvec.ZVecOpen(collDir);
      this.coll = coll;
      this.initialized = true;
      return;
    }

    // 创建新集合
    const fieldsSchemas = [
      { name: 'sourceId', dataType: ZVecDataType.STRING },
      { name: 'text', dataType: ZVecDataType.STRING },
      { name: 'metadataJson', dataType: ZVecDataType.STRING },
    ];

    const schema = new ZVecCollectionSchema({
      name: 'knowledge',
      vectors: [vectorSchema],
      fields: fieldsSchemas,
    });

    const coll = zvec.ZVecCreateAndOpen(collDir, schema);
    this.coll = coll;

    // 创建向量索引
    const indexParams =
      indexType === 'flat'
        ? {
            indexType: ZVecIndexType.FLAT,
            metricType: ZVecMetricType.COSINE,
          }
        : {
            indexType: ZVecIndexType.HNSW,
            metricType: ZVecMetricType.COSINE,
            m: hnswM,
            efConstruction: hnswEfConstruction,
          };

    // HNSW 索引创建可能较慢，放在 initialize 内完成
    coll.createIndexSync({
      fieldName: 'embedding',
      indexParams,
    });

    // 为 sourceId 创建倒排索引（用于按文档过滤和删除）
    coll.createIndexSync({
      fieldName: 'sourceId',
      indexParams: {
        indexType: ZVecIndexType.INVERT,
      },
    });

    this.initialized = true;
  }

  async upsert(chunks: VectorChunk[]): Promise<void> {
    if (!this.coll) throw new NativeZVecError('Store not initialized');

    const docs: ZVecDocInput[] = chunks.map((chunk) =>
      this.toInternalDoc(chunk)
    );

    this.coll.upsertSync(docs);
  }

  async upsertBatch(chunks: VectorChunk[], batchSize = 100): Promise<void> {
    if (!this.coll) throw new NativeZVecError('Store not initialized');

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const docs = batch.map((chunk) => this.toInternalDoc(chunk));
      this.coll!.upsertSync(docs);

      // 定期让出事件循环，避免阻塞
      if (i + batchSize < chunks.length) {
        await new Promise((r) => setImmediate(r));
      }
    }
  }

  async search(
    vector: number[],
    options?: SearchOptions,
  ): Promise<ScoredChunk[]> {
    if (!this.coll) throw new NativeZVecError('Store not initialized');

    const topK = options?.topK ?? 5;

    const query: ZVecQueryNative = {
      fieldName: 'embedding',
      vector,
      topk: topK,
      includeVector: false,
      queryParams: {
        ef: this.config.hnswEf,
      },
    };

    // 按 sourceId 过滤
    if (options?.sourceId) {
      query.filter = `sourceId == "${escapeFilterString(options.sourceId)}"`;
    }

    const results = this.coll.querySync(query);

    // 阈值过滤后转换
    const minScore = options?.minScore ?? 0.0;
    const scored: ScoredChunk[] = [];

    for (const doc of results) {
      // 阿里 ZVec COSINE 距离返回 0~2 范围，归一化到 0~1
      // COSINE 距离 = 1 - cosine_similarity → score range [0, 2]
      // 转换：similarity = 1 - distance/2 → range [0, 1]
      const rawScore = doc.score;
      const normalizedScore = typeof rawScore === 'number' ? 1 - rawScore / 2 : rawScore;

      if (normalizedScore < minScore) continue;

      const metadata = this.fromFields(doc.fields);
      scored.push({
        chunk: {
          id: doc.id,
          vector: Array.isArray(doc.vectors?.embedding) ? doc.vectors.embedding : [],
          metadata,
        },
        score: normalizedScore,
      });
    }

    // 按分数降序（ZVec 默认也是降序，这里显式保证）
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  async deleteBySource(sourceId: string): Promise<void> {
    if (!this.coll) throw new NativeZVecError('Store not initialized');

    const filter = `sourceId == "${escapeFilterString(sourceId)}"`;
    this.coll.deleteByFilterSync(filter);
  }

  async clear(): Promise<void> {
    // 清空：关闭并重新创建集合
    const zvec = await loadZvecModule();
    const dir = collectionDir(this.config.dataDir!, this.config.namespace);
    const collDir = join(dir, 'knowledge-store');

    this.coll?.closeSync();

    // 删除目录后重建
    await rmRecursive(dir);

    this.coll = null;
    this.initialized = false;

    // 重新初始化
    await this.initialize();
  }

  async stats(): Promise<StoreStats> {
    if (!this.coll) throw new NativeZVecError('Store not initialized');

    return {
      totalChunks: this.coll.stats.docCount,
      totalDocuments: 0, // 阿里 ZVec 不直接支持去重统计
      provider: 'native-zvec',
      dimensions: this.config.dimensions,
    };
  }

  /** 获取命名空间 */
  getNamespace(): string {
    return this.config.namespace;
  }

  /** 生成带命名空间的 chunk ID */
  static generateId(namespace: string, sourceId: string, chunkIndex: number): string {
    return `${namespace}:${sourceId}:${chunkIndex}:${randomUUID().slice(0, 8)}`;
  }

  // ===================================================================
  // 内部工具方法
  // ===================================================================

  private toInternalDoc(chunk: VectorChunk): ZVecDocInput {
    return {
      id: chunk.id,
      vectors: {
        embedding: chunk.vector,
      },
      fields: {
        sourceId: chunk.metadata.sourceId ?? '',
        text: chunk.metadata.text ?? '',
        metadataJson: JSON.stringify(chunk.metadata),
      },
    };
  }

  private fromFields(fields: Record<string, unknown>): VectorChunkMetadata {
    try {
      const raw = fields.metadataJson;
      if (typeof raw === 'string') {
        return JSON.parse(raw) as VectorChunkMetadata;
      }
    } catch {
      // 降级用 fields 拼装
    }

    return {
      sourceId: String(fields.sourceId ?? ''),
      text: String(fields.text ?? ''),
    };
  }
}

// ===================================================================
// 模块级静态工具
// ===================================================================

function escapeFilterString(s: string): string {
  // ZVec filter 中双引号需要转义
  return s.replace(/"/g, '\\"');
}

/** 递归删除目录（Node 18+ fs.rm recursive） */
async function rmRecursive(dir: string): Promise<void> {
  try {
    if (existsSync(dir)) {
      const { rm } = await import('node:fs/promises');
      await rm(dir, { recursive: true, force: true });
    }
  } catch {
    // 不存在则跳过
  }
}

/** 加载 @zvec/zvec 模块（动态导入 + 缓存） */
async function loadZvecModule(): Promise<ZvecModule> {
  if (_zvecMod) return _zvecMod;

  try {
    const zvec = require('@zvec/zvec') as ZvecModule;

    // 全局初始化（仅一次）
    if (zvec.ZVecInitialize) {
      zvec.ZVecInitialize({ logLevel: 3 }); // ERROR level only
    }

    _zvecMod = zvec;
    return zvec;
  } catch (cause) {
    const msg =
      'Failed to load @zvec/zvec. ' +
      'Install it: npm install @zvec/zvec';
    throw new NativeZVecError(msg, { cause, code: 'ZVEC_MODULE_NOT_FOUND' });
  }
}

// ===================================================================
// 错误类型
// ===================================================================

export class NativeZVecError extends Error {
  code?: string;

  constructor(
    message: string,
    options?: { cause?: unknown; code?: string },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'NativeZVecError';
    this.code = options?.code;
  }
}
