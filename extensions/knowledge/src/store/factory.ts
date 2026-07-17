/**
 * @fileoverview VectorStore 工厂 — 按 `store.provider` 实例化向量后端。
 *
 * @description
 * 当前内置：
 * - `sqlite-vec` — Node.js 内置 SQLite 持久化 + FTS5（默认生产推荐）；
 * - `zvec` — 纯 JS 内存引擎（开发/演示）；
 *
 * **模块角色**：Knowledge Plugin · Vector storage adapter registry。
 * **关键依赖**：`zvec.js`（静态）、`sqlite-vec`（动态 import）。
 *
 * @module knowledge/store/factory
 */

import type { VectorStore, KnowledgeStoreConfig } from '../types.js';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, join } from 'node:path';
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
        dbPath: config.dbPath ? namespaceDataPath(config.dbPath, namespace) : undefined,
      });
      await store.initialize();
      return store;
    }

    case 'sqlite-vec': {
      // 动态导入以减少未启用插件时的 node:sqlite 初始化成本
      const { SqliteVecStore } = await import('./sqlite-vec.js');
      const dbPath = config.dbPath ?? './data/knowledge.db';
      const store = new SqliteVecStore({
        dbPath,
        namespace,
        dimensions,
      });
      await store.initialize();
      return store;
    }

    default:
      throw new Error(
        `Unsupported vector store provider: "${provider}". ` +
        'Supported: zvec, sqlite-vec.'
      );
  }
}

/**
 * 为命名空间派生互不冲突的持久化文件路径。
 *
 * namespace 仅参与 SHA-256 摘要，不直接拼入文件名，既隔离租户数据，也避免路径
 * 分隔符、超长账号名或业务标识泄漏到宿主文件系统。
 */
export function namespaceDataPath(dbPath: string, namespace: string): string {
  const extension = extname(dbPath);
  const stem = basename(dbPath, extension);
  const suffix = createHash('sha256').update(namespace).digest('hex').slice(0, 12);
  return join(dirname(dbPath), `${stem}-${suffix}${extension || '.json'}`);
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
    dbPath: './data/knowledge.db',
  };
}
