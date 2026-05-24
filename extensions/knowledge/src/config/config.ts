/**
 * @fileoverview 知识库配置的 **解析、校验与深度合并**。
 *
 * @description
 * - 运行于 **编排层上游**：把原始 JSON/YAML 片段转化为可用的冻结默认值骨架；
 * - **不涉及运行时 Side‑effect**：纯函数实现（不依运行时钩子）。
 *
 * @module knowledge/config
 */

import type {
  KnowledgeConfig,
  KnowledgeEmbeddingConfig,
  KnowledgeStoreConfig,
  KnowledgeRetrievalConfig,
  KnowledgeInjectionConfig,
  KnowledgeModerationConfig,
  DeepPartialKnowledgeConfig,
} from '../types.js';

// ===================================================================
// 默认值常量
// ===================================================================

/** 默认 Embedding 配置 */
const DEFAULT_EMBEDDING: KnowledgeEmbeddingConfig = {
  provider: 'openai',
  model: 'text-embedding-ada-002',
  dimensions: 1536,
};

/** 默认向量存储配置 */
const DEFAULT_STORE: KnowledgeStoreConfig = {
  provider: 'sqlite-vec',
  dbPath: './data/knowledge.db',
};

/** 默认检索配置 */
const DEFAULT_RETRIEVAL: KnowledgeRetrievalConfig = {
  strategy: 'hybrid',
  topK: 5,
  minScore: 0.3,
};

/** 默认注入配置 */
const DEFAULT_INJECTION: KnowledgeInjectionConfig = {
  position: 'system',
  template: '以下是相关知识库内容，请据此回答用户问题：\n\n{context}',
};

/** @description 插件禁用时仍可作为合并基线的冻结默认知识库配置快照。 */
export const DEFAULT_KNOWLEDGE_CONFIG: KnowledgeConfig = Object.freeze({
  enabled: false,
  embedding: { ...DEFAULT_EMBEDDING },
  store: { ...DEFAULT_STORE },
  retrieval: { ...DEFAULT_RETRIEVAL },
  injection: { ...DEFAULT_INJECTION },
});

// ===================================================================
// 校验函数
// ===================================================================

/**
 * @description 逐项校验 `KnowledgeConfig` 字段类型与取值范围，生成人类可读错误列表。
 *
 * @param config - 候选配置（通常来自合并后的对象）
 * @returns 若为空数组则表示通过；否则每项为一条中文错误说明
 */
export function validateKnowledgeConfig(config: KnowledgeConfig): string[] {
  const errors: string[] = [];

  if (typeof config.enabled !== 'boolean') {
    errors.push('enabled 必须是布尔值');
  }

  // --- embedding ---
  if (config.embedding) {
    const emb = config.embedding;
    if (emb.provider !== undefined && typeof emb.provider !== 'string') {
      errors.push('embedding.provider 必须是字符串');
    }
    if (emb.model !== undefined && typeof emb.model !== 'string') {
      errors.push('embedding.model 必须是字符串');
    }
    if (emb.dimensions !== undefined) {
      if (!Number.isInteger(emb.dimensions) || emb.dimensions <= 0) {
        errors.push('embedding.dimensions 必须是正整数');
      }
    }
    if (emb.baseUrl !== undefined && typeof emb.baseUrl !== 'string') {
      errors.push('embedding.baseUrl 必须是字符串');
    }
    if (emb.apiKey !== undefined && typeof emb.apiKey !== 'string') {
      errors.push('embedding.apiKey 必须是字符串');
    }
  }

  // --- store ---
  if (config.store) {
    const st = config.store;
    if (st.provider !== undefined && typeof st.provider !== 'string') {
      errors.push('store.provider 必须是字符串');
    }
    if (st.dbPath !== undefined && typeof st.dbPath !== 'string') {
      errors.push('store.dbPath 必须是字符串');
    }
    if (st.port !== undefined && (!Number.isInteger(st.port) || st.port < 1 || st.port > 65535)) {
      errors.push('store.port 必须是 1-65535 之间的整数');
    }
  }

  // --- retrieval ---
  if (config.retrieval) {
    const ret = config.retrieval;
    if (ret.topK !== undefined) {
      if (!Number.isInteger(ret.topK) || ret.topK < 1) {
        errors.push('retrieval.topK 必须是不小于 1 的整数');
      }
    }
    if (ret.minScore !== undefined) {
      if (typeof ret.minScore !== 'number' || ret.minScore < 0 || ret.minScore > 1) {
        errors.push('retrieval.minScore 必须是 0-1 之间的数字');
      }
    }
    if (ret.strategy !== undefined) {
      const validStrategies = ['hybrid', 'vector', 'keyword'];
      if (!validStrategies.includes(ret.strategy)) {
        errors.push(`retrieval.strategy 必须是 ${validStrategies.join(' | ')}`);
      }
    }
    if (ret.keywordBoost !== undefined && typeof ret.keywordBoost !== 'boolean') {
      errors.push('retrieval.keywordBoost 必须是布尔值');
    }
  }

  // --- injection ---
  if (config.injection) {
    const inj = config.injection;
    if (inj.position !== undefined) {
      const validPositions = ['system', 'user'];
      if (!validPositions.includes(inj.position)) {
        errors.push(`injection.position 必须是 ${validPositions.join(' | ')}`);
      }
    }
    if (inj.template !== undefined && typeof inj.template !== 'string') {
      errors.push('injection.template 必须是字符串');
    }
    if (inj.maxChunks !== undefined) {
      if (!Number.isInteger(inj.maxChunks) || inj.maxChunks < 1) {
        errors.push('injection.maxChunks 必须是不小于 1 的整数');
      }
    }
    if (inj.maxTokens !== undefined) {
      if (!Number.isInteger(inj.maxTokens) || inj.maxTokens < 1) {
        errors.push('injection.maxTokens 必须是不小于 1 的整数');
      }
    }
  }

  // --- moderation ---
  if (config.moderation) {
    const mod = config.moderation;
    if (mod.enabled !== undefined && typeof mod.enabled !== 'boolean') {
      errors.push('moderation.enabled 必须是布尔值');
    }
    if (mod.rejectionMessage !== undefined && typeof mod.rejectionMessage !== 'string') {
      errors.push('moderation.rejectionMessage 必须是字符串');
    }
  }

  return errors;
}

// ===================================================================
// 配置创建与合并
// ===================================================================

/**
 * @description 将外部「松散对象」提升为强类型 `KnowledgeConfig`。仅当 `enabled===true` 时才返回实体；
 *              否则返回 `null`（表示功能关闭）。
 *
 * @param raw - 反序列化后的插件配置节点（可能缺字段或类型不完备）
 * @returns 结构完整的启用配置，或 `null`
 */
export function createKnowledgeConfig(raw: any): KnowledgeConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  if (raw.enabled !== true) {
    return null;
  }

  const config: KnowledgeConfig = {
    enabled: true,
    embedding: mergeEmbeddingConfig(raw.embedding),
    store: mergeStoreConfig(raw.store),
    retrieval: mergeRetrievalConfig(raw.retrieval),
    injection: mergeInjectionConfig(raw.injection),
  };

  // moderation: 可选，只有显式配置才设置
  if (raw.moderation && typeof raw.moderation === 'object') {
    config.moderation = {
      ...(raw.moderation as KnowledgeModerationConfig),
    };
  }

  return config;
}

/**
 * @description 在不触碰运行时状态的前提下合并全局模板与账号覆盖层：
 *              `store.sources` **整体替换**，其余嵌套字段走浅合并。
 *
 * @param global - 租户级默认配置（必须 `enabled===true` 才有意义）
 * @param accountOverride - account 粒度补丁（递归可选）
 * @returns 合并产物；若全局未启用则返回 `null`
 */
export function mergeKnowledgeConfig(
  global?: KnowledgeConfig | null,
  accountOverride?: DeepPartialKnowledgeConfig | null,
): KnowledgeConfig | null {
  if (!global?.enabled) return null;

  const merged: KnowledgeConfig = {
    ...global,
    enabled: true,
  };

  if (!accountOverride) return merged;

  // 深度合并子配置（浅层合并）
  const mergeFields = ['embedding', 'retrieval', 'injection', 'moderation'] as const;
  for (const field of mergeFields) {
    const globalField = global[field];
    const overrideField = (accountOverride as any)[field];
    if (overrideField && globalField) {
      (merged as any)[field] = { ...globalField, ...overrideField };
    } else if (overrideField) {
      (merged as any)[field] = overrideField;
    }
  }

  // store 配置：深度合并，但 sources 完全替换
  if (accountOverride.store || global.store) {
    const baseStore: KnowledgeStoreConfig = { ...DEFAULT_STORE, ...(global.store ?? {}) };
    merged.store = accountOverride.store
      ? { ...baseStore, ...accountOverride.store, sources: accountOverride.store.sources ?? baseStore.sources }
      : baseStore;
  }

  return merged;
}

// ===================================================================
// 内部辅助函数
// ===================================================================

/**
 * @description 将以 Partial 形式给出的 embedding 片段与默认值表对齐。
 *
 * @param raw - 任意来源的配置片段
 * @returns 具备默认模型/provider/dimensions 的结构体
 */
function mergeEmbeddingConfig(raw: any): KnowledgeEmbeddingConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_EMBEDDING };
  }
  return {
    ...DEFAULT_EMBEDDING,
    ...raw,
  };
}

/**
 * @description 合并向量存储连接参数并保留扩展字段（`sources`、`extra`）。
 *
 * @param raw - `store` 段落原始对象
 * @returns 规范化后的 {@link KnowledgeStoreConfig}
 */
function mergeStoreConfig(raw: any): KnowledgeStoreConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_STORE };
  }

  const result: KnowledgeStoreConfig = {
    provider: raw.provider ?? DEFAULT_STORE.provider,
  };

  // 只复制 undefined 之外的字段
  for (const key of Object.keys(DEFAULT_STORE) as (keyof KnowledgeStoreConfig)[]) {
    if (raw[key] !== undefined) {
      (result as any)[key] = raw[key];
    } else if (!(key in result)) {
      (result as any)[key] = (DEFAULT_STORE as any)[key];
    }
  }

  // 复制额外字段
  for (const key of Object.keys(raw)) {
    if (!(key in result)) {
      (result as any)[key] = raw[key];
    }
  }

  if (raw.sources && typeof raw.sources === 'object') {
    result.sources = raw.sources;
  }

  if (raw.extra && typeof raw.extra === 'object') {
    result.extra = { ...raw.extra };
  }

  return result;
}

/**
 * @description 对齐检索默认策略/topK/minScore。
 *
 * @param raw - `retrieval` 段落
 */
function mergeRetrievalConfig(raw: any): KnowledgeRetrievalConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_RETRIEVAL };
  }
  return {
    ...DEFAULT_RETRIEVAL,
    ...raw,
  };
}

/**
 * @description 对齐 Prompt 注入模板位置与占位符骨架。
 *
 * @param raw - `injection` 段落
 */
function mergeInjectionConfig(raw: any): KnowledgeInjectionConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_INJECTION };
  }
  return {
    ...DEFAULT_INJECTION,
    ...raw,
  };
}
