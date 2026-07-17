/**
 * Embedding Provider 的可靠 HTTP 公共层。
 *
 * 每次尝试都有独立 AbortController；只对网络错误、限流和服务端瞬时故障退避重试。
 * 批量助手还会校验返回数量与向量维度，防止 Provider 契约漂移进入 Store。
 */
import type { KnowledgeEmbeddingConfig } from '../types.js';
import { assertVector } from '../store/vector-validation.js';
import {
  DEFAULT_PROVIDER_MAX_RETRIES,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  requestProviderJson,
  withProviderTimeout,
} from '../shared/provider-http.js';

/** Embedding 单次远程请求默认超时。 */
export const DEFAULT_EMBEDDING_TIMEOUT_MS = DEFAULT_PROVIDER_TIMEOUT_MS;
/** Embedding 瞬时失败默认最大重试次数。 */
export const DEFAULT_EMBEDDING_MAX_RETRIES = DEFAULT_PROVIDER_MAX_RETRIES;
/** Embedding 单次批处理默认最大文本数量。 */
export const DEFAULT_EMBEDDING_BATCH_SIZE = 64;
const MAX_EMBEDDING_BATCH_SIZE = 2_048;

/** 通过 Knowledge 共用有界 HTTP 层执行 Embedding JSON POST。 */
export async function postEmbeddingJson<T>(
  url: string,
  init: RequestInit,
  config: KnowledgeEmbeddingConfig | undefined,
  provider: string,
): Promise<T> {
  return requestProviderJson<T>(url, init, {
    timeoutMs: config?.requestTimeoutMs,
    maxRetries: config?.maxRetries,
    maxResponseBytes: config?.maxResponseBytes,
  }, provider, 'Embedding');
}

/** 将任意长度输入按 Provider 单次上限顺序切批，保持输出顺序。 */
export async function inEmbeddingBatches<T>(
  texts: string[],
  config: KnowledgeEmbeddingConfig | undefined,
  operation: (batch: string[]) => Promise<T[]>,
  providerMaximumBatchSize = DEFAULT_EMBEDDING_BATCH_SIZE,
): Promise<T[]> {
  // maxBatchSize 是调用方期望值，不能突破 Provider 的硬上限。取最小值可让同一份
  // Knowledge 配置安全迁移到不同供应商，而不会把默认 64 条直接发给只接受 10/16 条的接口。
  const configuredBatchSize = config?.maxBatchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE;
  assertBatchSize(configuredBatchSize, 'maxBatchSize');
  assertBatchSize(providerMaximumBatchSize, 'providerMaximumBatchSize');
  const batchSize = Math.min(configuredBatchSize, providerMaximumBatchSize);
  const results: T[] = [];
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    results.push(...await operation(texts.slice(offset, offset + batchSize)));
  }
  return results;
}

/** 批次必须能让 offset 单调前进；零或负数会造成永不结束的同步循环。 */
function assertBatchSize(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_EMBEDDING_BATCH_SIZE) {
    throw new Error(`Knowledge embedding ${name} must be an integer between 1 and ${MAX_EMBEDDING_BATCH_SIZE}`);
  }
}

/** 校验 Provider 返回数量、索引唯一性、顺序、维度和有限数值。 */
export function validateEmbeddingData(
  data: unknown,
  expectedCount: number,
  dimensions: number,
  provider: string,
): number[][] {
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new Error(`${provider} Embedding API returned ${Array.isArray(data) ? data.length : 'invalid'} vectors; expected ${expectedCount}`);
  }
  const indexed = data.map((item) => {
    if (!item || typeof item !== 'object') throw new Error(`${provider} Embedding API returned an invalid item`);
    const value = item as { index?: unknown; embedding?: unknown };
    if (!Number.isInteger(value.index) || (value.index as number) < 0 || (value.index as number) >= expectedCount) {
      throw new Error(`${provider} Embedding API returned an invalid vector index`);
    }
    if (!Array.isArray(value.embedding)) throw new Error(`${provider} Embedding API returned an invalid vector`);
    assertVector(value.embedding, dimensions, `${provider} response vector`);
    return { index: value.index as number, embedding: value.embedding };
  }).sort((left, right) => left.index - right.index);
  if (new Set(indexed.map((item) => item.index)).size !== expectedCount) {
    throw new Error(`${provider} Embedding API returned duplicate vector indexes`);
  }
  return indexed.map((item) => item.embedding);
}

/** 为无法注入 AbortSignal 的 SDK Promise 提供调用方超时上限。 */
export async function withEmbeddingTimeout<T>(promise: Promise<T>, timeoutMs: number, provider: string): Promise<T> {
  return withProviderTimeout(promise, timeoutMs, provider, 'Embedding');
}
