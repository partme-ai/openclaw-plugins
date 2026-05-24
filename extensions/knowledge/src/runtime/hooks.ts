/**
 * Knowledge 内核 — 配置合并 + 运行时管理
 *
 * 核心逻辑：
 * 1. deepMergeKnowledgeConfig — 全局配置 + account 级覆盖的深度合并
 * 2. getOrCreateStore — 按 accountId:mode 命名空间获取/创建 VectorStore 实例
 * 3. before_prompt_build hook — 注入 RAG 上下文
 *
 * 可选流水线节点：
 * - reranker: 检索后对 chunks 重排序（需配置 reranker.provider）
 * - tokenizer: 注入前对上下文做 token 截断（需配置 tokenizer.provider）
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type {
  KnowledgeConfig,
  DeepPartialKnowledgeConfig,
  BeforePromptBuildContext,
  BeforePromptBuildResult,
  EmbeddingService,
  VectorStore,
  RerankerService,
  TokenizerService,
} from '../types.js';
import { evaluateIntent } from './intent-gate.js';
import type { IntentGateConfig } from './intent-gate.js';
import { createEmbeddingService } from '../embedding/factory.js';
import { createVectorStore, getDefaultStoreConfig } from '../store/factory.js';
import { createRerankerService } from '../reranker/factory.js';
import { createTokenizerService } from '../tokenizer/factory.js';
import { retrieveContext } from '../indexer/scheduler.js';
import { hybridSearch } from '../retriever/hybrid.js';

// ===================================================================
// 运行时状态
// ===================================================================

/** Store 实例缓存（按 namespace） */
const storeCache = new Map<string, { store: VectorStore; embedding: EmbeddingService; config: KnowledgeConfig }>();

// ===================================================================
// 配置合并
// ===================================================================

/**
 * 深度合并知识库配置
 *
 * 规则：
 * - enabled: 继承全局（如果 account 级没配）
 * - embedding/store/retrieval/injection/moderation: 深度合并
 * - tokenizer/reranker/parser: 深度合并
 * - store.sources: 完全替换（不合并）
 */
export function deepMergeKnowledgeConfig(
  global?: KnowledgeConfig,
  accountOverride?: DeepPartialKnowledgeConfig,
): KnowledgeConfig | null {
  if (!global?.enabled) return null;

  const merged: KnowledgeConfig = {
    ...global,
    enabled: true,
  };

  if (!accountOverride) return merged;

  // 深度合并子配置
  const mergeFields = ['embedding', 'retrieval', 'injection', 'moderation', 'tokenizer', 'reranker', 'parser'] as const;
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
    const baseStore = { ...getDefaultStoreConfig('default'), ...(global.store ?? {}) };
    merged.store = accountOverride.store
      ? { ...baseStore, ...accountOverride.store, sources: accountOverride.store.sources ?? baseStore.sources }
      : baseStore;
  }

  return merged;
}

// ===================================================================
// Store 生命周期管理
// ===================================================================

/**
 * 获取或创建指定命名空间的 VectorStore 实例
 */
export async function getOrCreateStore(
  config: KnowledgeConfig,
  namespace: string,
): Promise<{ store: VectorStore; embedding: EmbeddingService }> {
  const cached = storeCache.get(namespace);
  if (cached) return { store: cached.store, embedding: cached.embedding };

  // 创建 EmbeddingService
  const embedding = createEmbeddingService(config.embedding);

  // 创建 VectorStore
  const storeConfig = { ...getDefaultStoreConfig(namespace), ...(config.store ?? {}), namespace };
  const dimensions = config.embedding?.dimensions ?? embedding.dimensions;
  const store = await createVectorStore(storeConfig, dimensions);

  // 缓存
  storeCache.set(namespace, { store, embedding, config });
  return { store, embedding };
}

/**
 * 清除指定命名空间的缓存
 */
export function invalidateStoreCache(namespace?: string): void {
  if (namespace) {
    storeCache.delete(namespace);
  } else {
    storeCache.clear();
  }
}

// ===================================================================
// 配置读取辅助（对接 OpenClaw 配置系统）
// ===================================================================

/**
 * 从 OpenClaw 配置中读取插件自身的 knowledge 配置
 *
 * 当作为独立插件运行时，配置路径由调用方传入。
 * 默认为直接读取 config 对象中的 knowledge 字段。
 */
export function extractKnowledgeConfig(
  config: any,
  configPath?: string,
): { global: KnowledgeConfig | undefined; accounts: Record<string, DeepPartialKnowledgeConfig> } {
  if (!config) return { global: undefined, accounts: {} };

  // 如果指定了配置路径（如 "channels.wecom.knowledge"），按路径查找
  const knowledgeSection = configPath
    ? configPath.split('.').reduce((obj: any, key: string) => obj?.[key], config)
    : (config as any)?.knowledge;

  if (!knowledgeSection) return { global: undefined, accounts: {} };

  const global = (knowledgeSection as KnowledgeConfig) ?? undefined;
  const accounts: Record<string, DeepPartialKnowledgeConfig> = {};

  if (knowledgeSection.accounts) {
    for (const [accountId, accountConfig] of Object.entries(knowledgeSection.accounts) as [string, any][]) {
      if (accountConfig?.knowledge) {
        accounts[accountId] = accountConfig.knowledge;
      }
    }
  }

  return { global, accounts };
}

// ===================================================================
// Reranker 节点（可选）
// ===================================================================

/**
 * 创建 Reranker 实例
 * 仅在配置了 reranker.provider 时创建，否则返回 null（跳过重排序）
 */
function createRerankerIfConfigured(config: KnowledgeConfig): RerankerService | null {
  if (!config.reranker?.provider) return null;
  try {
    return createRerankerService(config.reranker);
  } catch {
    return null;
  }
}

// ===================================================================
// Tokenizer 节点（可选）
// ===================================================================

/**
 * 创建 Tokenizer 实例
 * 仅在配置了 tokenizer.provider 时创建，否则返回 null（跳过截断）
 */
function createTokenizerIfConfigured(config: KnowledgeConfig): TokenizerService | null {
  if (!config.tokenizer?.provider) return null;
  try {
    return createTokenizerService(config.tokenizer);
  } catch {
    return null;
  }
}

// ===================================================================
// before_prompt_build Hook
// ===================================================================

/**
 * 注册知识库 hooks
 *
 * 直接从 api.pluginConfig 读取配置（与渠道无关，无需 configPath）。
 * 保留 configPath 参数用于向后兼容——渠道插件仍可指定独立配置路径。
 */
export function registerKnowledgeHooks(api: OpenClawPluginApi, configPath?: string): void {
  // 优先从 pluginConfig 读取（独立插件模式），fallback 到 configPath（库模式）
  const pluginConfig = (api.pluginConfig ?? {}) as Record<string, unknown>;

  const knowledgeConfig = configPath
    ? configPath.split('.').reduce((obj: any, key: string) => obj?.[key], (api.config as any))
    : pluginConfig;

  api.on('before_prompt_build', (_event, ctx) => {
    return handleBeforePromptBuild(ctx as unknown as BeforePromptBuildContext, knowledgeConfig ?? pluginConfig);
  });
}

/**
 * before_prompt_build 事件处理器
 *
 * 可选流水线（按配置决定是否执行每个节点）：
 * 1. 混合检索（hybridSearch） → 必需
 * 2. 重排序（reranker）      → 可选，配置 reranker.provider
 * 3. Token 截断（tokenizer） → 可选，配置 tokenizer.provider
 * 4. 注入 systemPrompt
 */
async function handleBeforePromptBuild(
  ctx: BeforePromptBuildContext,
  knowledgeConfig: any,
): Promise<BeforePromptBuildResult | undefined> {
  if (!ctx.message) return;

  // 从 ctx 中获取 accountId（OpenClaw 路由绑定传过来的）
  const accountId = ctx.accountId ?? 'default';
  const mode = ctx.agentId ? 'agent' : 'bot';
  const namespace = `${accountId}:${mode}`;

  // 通过闭包捕获的 knowledgeConfig 读取知识库配置
  const config = resolveKnowledgeConfig(knowledgeConfig, accountId);
  if (!config?.enabled) return;

  try {
    // ================================================================
    // 节点 0：Intent Gate（可选 — 默认只走 rule 模式）
    // ================================================================
    const intentGateConfig = config.intentGate as IntentGateConfig | undefined;
    const gateResult = evaluateIntent(ctx.message, intentGateConfig);
    if (gateResult === 'skip') {
      return; // 跳过 RAG 检索，直接走原有 prompt
    }

    const { store, embedding } = await getOrCreateStore(config, namespace);
    const retrieval = config.retrieval ?? {};
    const topK = retrieval.topK ?? 5;
    const minScore = retrieval.minScore ?? 0.0;
    const injection = config.injection ?? {};

    // ================================================================
    // 节点 1：混合检索（必需）
    // ================================================================
    const hybridConfig = { strategy: retrieval.strategy ?? 'hybrid' as const };
    let chunks = await hybridSearch(ctx.message, embedding, store, {
      topK: topK * 2, // 多召回一些，给 reranker 裁剪空间
      minScore,
      config: hybridConfig,
    });

    if (chunks.length === 0) return;

    // ================================================================
    // 节点 2：重排序（可选 — 配置 reranker.provider 后启用）
    // ================================================================
    const reranker = createRerankerIfConfigured(config);
    if (reranker) {
      try {
        const documents = chunks.map((c) => c.chunk.metadata.text);
        const reranked = await reranker.rerank(ctx.message, documents, topK);
        // 按重排序结果重新组织 chunks
        const chunkMap = new Map(chunks.map((c) => [c.chunk.metadata.text, c]));
        chunks = reranked
          .map((rd) => chunkMap.get(rd.text))
          .filter((c): c is NonNullable<typeof c> => c !== undefined);
      } catch (err) {
        console.error('[Knowledge] Reranker failed, using original order:', err);
        // reranker 失败不阻断，使用原始排序
        chunks = chunks.slice(0, topK);
      }
    } else {
      // 无 reranker，直接取 topK
      chunks = chunks.slice(0, topK);
    }

    if (chunks.length === 0) return;

    // ================================================================
    // 节点 3：构建上下文文本 + Token 截断（可选）
    // ================================================================
    let contextText = chunks
      .map((scored, i) => `[${i + 1}] (相似度: ${(scored.score * 100).toFixed(1)}%)\n${scored.chunk.metadata.text}`)
      .join('\n\n---\n\n');

    // 可选节点：tokenizer 上下文截断
    const tokenizer = createTokenizerIfConfigured(config);
    if (tokenizer) {
      try {
        const maxTokens = injection.maxTokens ?? 2048;
        contextText = await tokenizer.truncate(contextText, maxTokens);
      } catch (err) {
        console.error('[Knowledge] Tokenizer truncation failed, using original context:', err);
        // 截断失败不阻断
      }
    }

    // ================================================================
    // 节点 4：构建注入文本
    // ================================================================
    const template = injection.template ?? '以下是与当前话题可能相关的知识库内容，请选择性参考（如果不相关可忽略）：\n\n{context}';
    const injectedContext = template.replace('{context}', contextText);

    const position = injection.position ?? 'system';

    if (position === 'user') {
      return { userPrompt: injectedContext };
    }

    return { systemPrompt: injectedContext };
  } catch (error) {
    console.error('[Knowledge] Error in before_prompt_build:', error);
    return undefined;
  }
}

/**
 * 解析当前 account 的知识库配置
 *
 * 通过闭包传入的 knowledge 配置读取 knowledge 配置，
 * 替代了之前错误的 (ctx as any).config 方式。
 */
function resolveKnowledgeConfig(
  knowledgeConfig: any,
  accountId: string,
): KnowledgeConfig | null {
  if (!knowledgeConfig) return null;

  const global = knowledgeConfig as KnowledgeConfig | undefined;
  if (!global?.enabled) return null;

  const accounts = knowledgeConfig.accounts as Record<string, any> | undefined;
  const accountOverride = accounts?.[accountId]?.knowledge as DeepPartialKnowledgeConfig | undefined;
  return deepMergeKnowledgeConfig(global, accountOverride);
}
