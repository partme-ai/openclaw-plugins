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
import { mergeKnowledgeConfig, validateKnowledgeConfig } from '../config/config.js';
import { resolveConversationNamespace } from './namespace.js';

// ===================================================================
// 运行时状态
// ===================================================================

/** Store 实例缓存（按 namespace） */
type StoreCacheEntry = { store: VectorStore; embedding: EmbeddingService; configFingerprint: string };
const storeCache = new Map<string, StoreCacheEntry>();
const storeInitPromises = new Map<string, Promise<StoreCacheEntry>>();

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
  // 合并规则必须只有一个事实来源。运行时若复制一份字段清单，新增 tools、intentGate
  // 等配置时极易出现“启动配置生效、账号覆盖失效”的隐蔽漂移。
  return mergeKnowledgeConfig(global, accountOverride);
}

// ===================================================================
// Store 生命周期管理
// ===================================================================

/**
 * @description Lazy‑initialize：`namespace` 粒度的 `{store,embedding}` 双实例；
 *              命中内存缓存则直接返回引用。
 *
 * @param config - 已合并的最终配置（含维度/provider）
 * @param namespace - 隔离键（默认由 sessionKey 摘要与 bot/agent 模式派生）
 * @returns 可用于检索/写入的 Store 与其配套的 Embedding 服务
 */
export async function getOrCreateStore(
  config: KnowledgeConfig,
  namespace: string,
): Promise<{ store: VectorStore; embedding: EmbeddingService }> {
  const configFingerprint = JSON.stringify(config);
  // 同 namespace 的配置切换也必须串行。旧实现等待到一个不同 fingerprint 的初始化后，
  // 会在旧 Promise 尚占据 Map 时直接覆盖它；三个并发调用可各自发布 Store，并关闭另一个
  // 调用仍在使用的句柄。循环只允许当前 Map owner 创建下一代实例。
  for (;;) {
    const cached = storeCache.get(namespace);
    if (cached?.configFingerprint === configFingerprint) {
      return { store: cached.store, embedding: cached.embedding };
    }
    const pending = storeInitPromises.get(namespace);
    if (pending) {
      await pending;
      continue;
    }

    const initialization = (async (): Promise<StoreCacheEntry> => {
      const previous = storeCache.get(namespace);
      if (previous) {
        // 先撤销缓存可见性，再关闭旧句柄。若 close 或新 Store 初始化失败，下一次调用会
        // 重新构建，而不会命中一个已经关闭、但仍残留在 Map 中的“僵尸实例”。同一
        // namespace 的初始化由 storeInitPromises 串行化，因此这里不存在并发发布窗口。
        if (storeCache.get(namespace) === previous) storeCache.delete(namespace);
        await disposeStore(previous.store);
      }
      const embedding = createEmbeddingService(config.embedding);
      const storeConfig = { ...getDefaultStoreConfig(namespace), ...(config.store ?? {}), namespace };
      const dimensions = config.embedding?.dimensions ?? embedding.dimensions;
      const store = await createVectorStore(storeConfig, dimensions);
      const entry = { store, embedding, configFingerprint };
      storeCache.set(namespace, entry);
      return entry;
    })();
    storeInitPromises.set(namespace, initialization);
    try {
      const entry = await initialization;
      return { store: entry.store, embedding: entry.embedding };
    } finally {
      if (storeInitPromises.get(namespace) === initialization) storeInitPromises.delete(namespace);
    }
  }
}

/**
 * @description 在 Store 物理清空或后端重建后调用，以避免陈旧客户端句柄。
 *
 * @param namespace - 若传入则删除单个条目；省略则清空整张缓存 Map
 */
export async function invalidateStoreCache(namespace?: string): Promise<void> {
  if (namespace) {
    await Promise.allSettled([storeInitPromises.get(namespace)].filter((value): value is Promise<StoreCacheEntry> => Boolean(value)));
    const entry = storeCache.get(namespace);
    storeCache.delete(namespace);
    if (entry) await disposeStore(entry.store);
  } else {
    await Promise.allSettled([...storeInitPromises.values()]);
    const entries = [...storeCache.values()];
    storeCache.clear();
    await Promise.allSettled(entries.map((entry) => disposeStore(entry.store)));
  }
}

async function disposeStore(store: VectorStore): Promise<void> {
  if (typeof store.close === 'function') await store.close();
  else if (typeof store.dispose === 'function') await store.dispose();
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
export function registerKnowledgeHooks(
  api: OpenClawPluginApi,
  configPath?: string,
  configOverride?: KnowledgeConfig,
): void {
  // 优先从 pluginConfig 读取（独立插件模式），fallback 到 configPath（库模式）
  const pluginConfig = (configOverride ?? api.pluginConfig ?? {}) as Record<string, unknown>;

  const knowledgeConfig = configPath
    ? configPath.split('.').reduce((obj: any, key: string) => obj?.[key], (api.config as any))
    : pluginConfig;

  api.on('before_prompt_build', (event, ctx) => {
    // OpenClaw 2026.7.1 将用户正文放在第一个参数 event.prompt，第二个参数只承载
    // agent/account/session 路由上下文。显式合并可避免 Hook 被调用却因 message 缺失静默跳过。
    const hookContext: BeforePromptBuildContext = {
      ...(ctx as unknown as BeforePromptBuildContext),
      message: event.prompt,
    };
    return handleBeforePromptBuild(hookContext, knowledgeConfig ?? pluginConfig, api.logger);
  });
}

/**
 * @description Hook 回调体：串联意图门控 → 向量/混合检索 → 精排 → token 裁剪 → Prompt 拼装。
 *
 * @param ctx - 已把 `event.prompt` 合并为 `message` 的会话上下文
 * @param knowledgeConfig - 通过闭包捕获的原始配置节点（含 `accounts` 子树时参与合并）
 * @returns 若需改写 system/user Prompt 则返回对应字段；跳过或失败时返回 `undefined`
 */
async function handleBeforePromptBuild(
  ctx: BeforePromptBuildContext,
  knowledgeConfig: any,
  logger: OpenClawPluginApi['logger'],
): Promise<BeforePromptBuildResult | undefined> {
  if (!ctx.message) return;

  // OpenClaw 2026.7.1 的 before_prompt_build 不提供 accountId。Hook 与 Tool 必须
  // 共同使用官方 sessionKey，否则多账号环境会出现“写入成功但自动检索永远查不到”。
  const namespace = resolveConversationNamespace(ctx);

  try {
    // 通过闭包捕获的 knowledgeConfig 读取知识库配置。账号覆盖也在此处校验；非法覆盖
    // 只关闭本次 RAG 辅助路径，不应让 before_prompt_build 阻断 Agent 主流程。
    const config = resolveKnowledgeConfig(knowledgeConfig, 'default');
    if (!config?.enabled) return;
    const maxInputChars = config.tools?.maxInputChars ?? 100_000;
    if (ctx.message.length > maxInputChars) {
      logger.warn(`[knowledge] skipped retrieval because message exceeds ${maxInputChars} characters`);
      return;
    }

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
    const injection = config.injection ?? {};
    const topK = Math.min(retrieval.topK ?? 5, injection.maxChunks ?? 5);
    const minScore = retrieval.minScore ?? 0.0;

    // ================================================================
    // 节点 1：混合检索（必需）
    // ================================================================
    const hybridConfig = {
      strategy: retrieval.strategy ?? 'hybrid' as const,
      vectorWeight: retrieval.vectorWeight ?? 0.7,
      keywordWeight: retrieval.keywordWeight ?? 0.3,
    };
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
        logger.warn(`[knowledge] reranker failed; using original order: ${err instanceof Error ? err.message : String(err)}`);
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
        logger.warn(`[knowledge] tokenizer truncation failed; using original context: ${err instanceof Error ? err.message : String(err)}`);
        // 截断失败不阻断
      }
    } else {
      const maxCharacters = (injection.maxTokens ?? 2048) * 4;
      if (contextText.length > maxCharacters) contextText = contextText.slice(0, maxCharacters);
    }

    // ================================================================
    // 节点 4：构建注入文本
    // ================================================================
    const template = injection.template ?? '以下是与当前话题可能相关的知识库内容，请选择性参考（如果不相关可忽略）：\n\n{context}';
    const injectedContext = template.replace('{context}', contextText);

    const position = injection.position ?? 'system';

    if (position === 'user') {
      return { prependContext: injectedContext };
    }

    return { prependSystemContext: injectedContext };
  } catch (error) {
    logger.error(`[knowledge] before_prompt_build failed: ${error instanceof Error ? error.message : String(error)}`);
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
  const merged = deepMergeKnowledgeConfig(global, accountOverride);
  if (!merged) return null;

  // 账号覆盖发生在插件启动之后，因此必须对最终合并结果再次校验；否则非法的
  // timeout、provider 或文件边界配置会绕过启动校验，直到实际请求才产生副作用。
  const errors = validateKnowledgeConfig(merged);
  if (errors.length > 0) {
    throw new Error(`账号 ${accountId} 的知识库配置无效: ${errors.join('; ')}`);
  }
  return merged;
}
