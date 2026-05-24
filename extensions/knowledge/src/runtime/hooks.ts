/**
 * @fileoverview Knowledge 运行时核心 — **配置合并 / Store 缓存 / before_prompt_build 编排**。
 *
 * @description
 * 在典型 RAG 流水线中的位置：**Intent Gate → Hybrid Search → （可选）Rerank → （可选）Tokenizer 截断
 * → System/User Prompt 注入**。
 * 本模块同时承担 **跨请求复用** 的 `VectorStore`+`EmbeddingService` 实例缓存，降低冷启动成本。
 *
 * @module knowledge/runtime/hooks
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
 * @description 将全局 `KnowledgeConfig` 与 account 专属覆盖进行浅层合并：
 *              `tokenizer`/`reranker`/`parser` 等可选扩展字段一并纳入；
 *              **store.sources** 若出现在覆盖层则完全替换全局定义。
 *
 * @param global - 顶层启用配置（需 `enabled===true`）
 * @param accountOverride - Account 补丁对象（递归 Partial）
 * @returns 可用于运行时的合成配置；全局禁用时返回 `null`
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
 * @description Lazy‑initialize：`namespace` 粒度的 `{store,embedding}` 双实例；
 *              命中内存缓存则直接返回引用。
 *
 * @param config - 已合并的最终配置（含维度/provider）
 * @param namespace - 隔离键（惯例：`accountId:bot|agent`）
 * @returns 可用于检索/写入的 Store 与其配套的 Embedding 服务
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
 * @description 在 Store 物理清空或后端重建后调用，以避免陈旧客户端句柄。
 *
 * @param namespace - 若传入则删除单个条目；省略则清空整张缓存 Map
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
 * @description 从宿主配置树裁剪 `knowledge` 段落：可选点路径穿透（例如渠道私有命名空间）。
 *
 * @param config - OpenClaw 根配置对象
 * @param configPath - 以 `.` 分隔的路径；缺省时读取顶层 `config.knowledge`
 * @returns `global` 为聚合模板，`accounts` 为账号 ID→补丁映射
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
 * @description 当 `reranker.provider` 可用且工厂构造成功时返回实例；任何异常均被吞并以 `null` 表示跳过。
 *
 * @param config - 运行时知识配置
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
 * @description 与 {@link createRerankerIfConfigured} 对称：为可选上下文截断准备 `TokenizerService`。
 *
 * @param config - 运行时知识配置
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
 * @description 向 `OpenClawPluginApi` 订阅 `before_prompt_build`：
 *              - **独立插件模式**：读取 `api.pluginConfig`；
 *              - **嵌入式库模式**：可通过 `configPath` 穿透宿主配置。
 *
 * @param api - OpenClaw 插件宿主对象
 * @param configPath - 可选的点分路径覆盖层
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
 * @description Hook 回调体：串联意图门控 → 向量/混合检索 → 精排 → token 裁剪 → Prompt 拼装。
 *
 * @param ctx - OpenClaw 传入的会话上下文（需含 `message` 与账号路由键）
 * @param knowledgeConfig - 通过闭包捕获的原始配置节点（含 `accounts` 子树时参与合并）
 * @returns 若需改写 system/user Prompt 则返回对应字段；跳过或失败时返回 `undefined`
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
 * @description 依据 `accountId` 选取 `accounts[accountId].knowledge` 并执行 {@link deepMergeKnowledgeConfig}。
 *
 * @param knowledgeConfig - 原始 knowledge 节点
 * @param accountId - 当前路由到的业务账号标识
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
