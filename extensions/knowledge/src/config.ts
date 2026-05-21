/**
 * 知识库配置合并模块
 *
 * 提供从原始配置对象解析、校验、合并知识库配置的纯函数。
 * 供 hooks.ts 之外的模块独立使用，不依赖 Zod。
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
} from './types.js';

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

/** 完整默认知识库配置 */
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
 * 校验知识库配置，返回错误信息数组。
 * 空数组表示配置合法。
 *
 * 校验规则：
 * - enabled 必须是 boolean（如果存在）
 * - embedding.provider 如果有值必须是 string
 * - embedding.dimensions 如果有值必须是正整数
 * - store.provider 如果有值必须是 string
 * - retrieval.topK 如果有值必须是正整数
 * - retrieval.minScore 如果有值必须在 [0, 1] 区间
 * - retrieval.strategy 如果有值必须是 'hybrid' | 'vector' | 'keyword'
 * - injection.position 如果有值必须是 'system' | 'user'
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
 * 从原始配置对象解析并校验知识库配置。
 *
 * 行为：
 * - 如果 raw 为 null/undefined/非对象，返回 null
 * - 如果 raw.enabled 不为 true，返回 null（禁用态）
 * - 使用 DEFAULT_KNOWLEDGE_CONFIG 作为基础，用 raw 中的字段覆盖
 * - 返回的配置保证所有子字段都有值（未设置的使用默认值）
 *
 * @param raw - 原始配置对象（通常来自 JSON 反序列化）
 * @returns 解析后的 KnowledgeConfig，或 null（禁用/无效）
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
 * 深度合并知识库配置（全局 + account 覆盖）
 *
 * 规则与 hooks.ts 中的 deepMergeKnowledgeConfig 保持一致：
 * - enabled: 继承全局
 * - embedding/store/retrieval/injection/moderation: 浅层合并（cover）
 * - store.sources: 完全替换（不合并）
 *
 * @param global - 全局知识库配置
 * @param accountOverride - account 级覆盖配置（可选）
 * @returns 合并后的配置，或 null（全局未启用）
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
    const baseStore = { ...(global.store ?? {}) };
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
 * 合并 Embedding 配置（使用默认值填充缺失字段）
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
 * 合并 Store 配置（使用默认值填充缺失字段）
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
 * 合并检索配置（使用默认值填充缺失字段）
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
 * 合并注入配置（使用默认值填充缺失字段）
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
