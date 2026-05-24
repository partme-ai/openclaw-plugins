/**
 * @fileoverview VectorStore 工厂 — 按 `store.provider` 实例化向量后端。
 *
 * @description
 * 当前内置：
 * - `sqlite-vec` — better-sqlite3 持久化 + FTS5（默认生产推荐）；
 * - `zvec` — 纯 JS 内存引擎（开发/演示）；
 * - `native-zvec` — `@zvec/zvec` 原生 HNSW（可选重依赖）。
 *
 * **模块角色**：Knowledge Plugin · Vector storage adapter registry。
 * **关键依赖**：`zvec.js`（静态）、`sqlite-vec`/`native-zvec`（动态 import）。
 *
 * @module knowledge/store/factory
 */

import type { VectorStore, KnowledgeStoreConfig } from '../types.js';
import { ZVecStore } from './zvec.js';
// 注意：SqliteVecStore / NativeZVecStore 是动态 import，仅在使用时加载

/**
 * @description 异步构造并 `initialize()` 目标 {@link VectorStore}。
 *
 * @param config - 必须含 `provider` 与 `namespace`；其余字段 provider 特化。
 * @param dimensions - 嵌入向量维度，写入表结构/索引。
 * @returns 已初始化的 Store 实例。
 * @throws 不支持的 provider 或可选依赖未安装。
 */
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

/**
 * @description 未显式配置 `store` 时的 sqlite-vec 默认连接参数。
 *
 * @param namespace - 租户/会话隔离键，参与 db 文件名。
 * @returns 含 `provider`、`namespace`、`dbPath` 的默认配置。
 */
export function getDefaultStoreConfig(namespace: string): KnowledgeStoreConfig {
  return {
    provider: 'sqlite-vec',
    namespace,
    dbPath: `./data/wecom-kb-${namespace}.db`,
  };
}
