/**
 * VectorStore 工厂 — 按 provider 名路由到对应后端
 *
 * 当前支持的 provider：
 * - sqlite-vec: 基于 better-sqlite3 的持久化向量存储（默认）— 推荐轻量生产
 * - zvec: 纯 JS 内存向量引擎（零依赖）— 推荐开发/演示
 * - native-zvec: 阿里 ZVec (@zvec/zvec) C++ 原生引擎 — 备选，需安装依赖
 *
 * 后续扩展：
 * - redis/pinecone/chroma/weaviate/qdrant/milvus/pgvector 等
 */

import type { VectorStore, KnowledgeStoreConfig } from '../types.js';
import { ZVecStore } from './zvec.js';
// 注意：SqliteVecStore / NativeZVecStore 是动态 import，仅在使用时加载

/** 创建 VectorStore 实例 */
export async function createVectorStore(
  config: Required<Pick<KnowledgeStoreConfig, 'provider' | 'namespace'>> & KnowledgeStoreConfig,
  dimensions: number,
): Promise<VectorStore> {
  const { provider, namespace } = config;

  switch (provider) {
    case 'zvec': {
      const store = new ZVecStore({
        namespace,
        dimensions,
        dbPath: config.dbPath,
      });
      await store.initialize();
      return store;
    }

    case 'sqlite-vec': {
      // 动态导入以避免启动时强依赖 better-sqlite3
      const { SqliteVecStore } = await import('./sqlite-vec.js');
      const dbPath = config.dbPath ?? `./data/wecom-kb-${namespace}.db`;
      const store = new SqliteVecStore({
        dbPath,
        namespace,
        dimensions,
      });
      await store.initialize();
      return store;
    }

    case 'native-zvec': {
      // 动态导入以避免启动时强依赖 @zvec/zvec
      const { NativeZVecStore } = await import('./native-zvec.js');
      const store = new NativeZVecStore({
        namespace,
        dimensions,
        dataDir: config.extra?.dataDir as string | undefined,
        indexType: (config.extra?.indexType as 'hnsw' | 'flat') ?? 'hnsw',
        hnswM: (config.extra?.hnswM as number) ?? 16,
        hnswEfConstruction: (config.extra?.hnswEfConstruction as number) ?? 200,
        hnswEf: (config.extra?.hnswEf as number) ?? 100,
      });
      await store.initialize();
      return store;
    }

    default:
      throw new Error(
        `Unsupported vector store provider: "${provider}". ` +
        `Supported: zvec, sqlite-vec, native-zvec. ` +
        `For external databases (redis, pinecone, etc.), see future releases.`
      );
  }
}

/** 获取默认 store 配置（用于未配置时自动选择） */
export function getDefaultStoreConfig(namespace: string): KnowledgeStoreConfig {
  return {
    provider: 'sqlite-vec',
    namespace,
    dbPath: `./data/wecom-kb-${namespace}.db`,
  };
}
