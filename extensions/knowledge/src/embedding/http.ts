import type { KnowledgeEmbeddingConfig } from '../types.js';
import { assertVector } from '../store/vector-validation.js';

export const DEFAULT_EMBEDDING_TIMEOUT_MS = 30_000;
export const DEFAULT_EMBEDDING_MAX_RETRIES = 2;
export const DEFAULT_EMBEDDING_BATCH_SIZE = 64;

export async function postEmbeddingJson<T>(
  url: string,
  init: RequestInit,
  config: KnowledgeEmbeddingConfig | undefined,
  provider: string,
): Promise<T> {
  const timeoutMs = config?.requestTimeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS;
  const maxRetries = config?.maxRetries ?? DEFAULT_EMBEDDING_MAX_RETRIES;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const message = (await response.text().catch(() => 'unknown')).slice(0, 2048);
        const error = new Error(`${provider} Embedding API error: ${response.status} ${response.statusText} — ${message}`);
        if (!isRetryableStatus(response.status) || attempt === maxRetries) throw error;
        lastError = error;
      } else {
        return await response.json() as T;
      }
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !isRetryableError(error)) throw normalizeError(error, provider, timeoutMs);
    } finally {
      clearTimeout(timer);
    }
    await delay(Math.min(250 * 2 ** attempt, 2_000));
  }

  throw normalizeError(lastError, provider, timeoutMs);
}

export async function inEmbeddingBatches<T>(
  texts: string[],
  config: KnowledgeEmbeddingConfig | undefined,
  operation: (batch: string[]) => Promise<T[]>,
): Promise<T[]> {
  const batchSize = config?.maxBatchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE;
  const results: T[] = [];
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    results.push(...await operation(texts.slice(offset, offset + batchSize)));
  }
  return results;
}

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

export async function withEmbeddingTimeout<T>(promise: Promise<T>, timeoutMs: number, provider: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${provider} Embedding request timed out after ${timeoutMs}ms`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && error.name === 'AbortError');
}

function normalizeError(error: unknown, provider: string, timeoutMs: number): Error {
  if (error instanceof Error && error.name === 'AbortError') {
    return new Error(`${provider} Embedding request timed out after ${timeoutMs}ms`);
  }
  return error instanceof Error ? error : new Error(`${provider} Embedding request failed: ${String(error)}`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
