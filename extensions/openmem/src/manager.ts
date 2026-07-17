/**
 * @fileoverview OpenMem 检索结果到 OpenClaw MemorySearchManager 契约的适配器。
 *
 * 搜索默认按会话连续性隔离，只有 `allowSharedRecall=true` 才允许混合共享知识；外部 source
 * 会转换成受控虚拟路径并进入有界内容缓存，`readFile` 只能读取允许的 archive/memory 来源。
 * 状态与探针明确标识当前使用 FTS/字符重排而非向量嵌入。
 */
import type {
  MemoryEmbeddingProbeResult,
  MemoryProviderStatus,
  MemorySearchManager,
  MemorySearchResult,
} from "openclaw/plugin-sdk/memory-core-host-engine-storage";

import { OpenMemClient } from "./client.js";
import type { OpenMemConfig } from "./config.js";
import { OpenMemCoordinator } from "./coordinator.js";

type SearchChunk = { text: string; score: number; source: string; recall_type: "continuity" | "knowledge" };
type SearchResponse = { chunks: SearchChunk[]; sources: string[] };

/** 实现 OpenClaw 记忆搜索、来源读取、健康状态和能力探针。 */
export class OpenMemSearchManager implements MemorySearchManager {
  private readonly contentCache = new Map<string, string>();
  private contentCacheBytes = 0;
  private lastHealth: { ok: boolean; checkedAt: number; error?: string } | undefined;

  constructor(
    private readonly client: OpenMemClient,
    private readonly coordinator: OpenMemCoordinator,
    private readonly config: OpenMemConfig,
  ) {}

  async search(query: string, opts?: {
    maxResults?: number;
    minScore?: number;
    sessionKey?: string;
    signal?: AbortSignal;
  }): Promise<MemorySearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const limit = Math.min(Math.max(opts?.maxResults ?? this.config.maxSearchResults, 1), this.config.maxSearchResults);
    const sessionId = opts?.sessionKey ? await this.coordinator.recallSessionId(opts.sessionKey) : undefined;
    if (!this.config.allowSharedRecall && !sessionId) return [];
    const data = await this.client.post<SearchResponse>("/inspect/search", {
      query: trimmed,
      mode: this.config.allowSharedRecall ? "hybrid" : "continuity",
      limit,
      ...(sessionId ? { sessionId } : {}),
    }, { retrySafe: true, signal: opts?.signal });
    if (!data || !Array.isArray(data.chunks)) throw new Error("OpenMem returned an invalid search response");
    const results: MemorySearchResult[] = [];
    for (const chunk of data.chunks) {
      if (!this.isChunk(chunk)) continue;
      if (!this.config.allowSharedRecall && chunk.recall_type !== "continuity") continue;
      if (opts?.minScore != null && chunk.score < opts.minScore) continue;
      const relPath = this.sourcePath(chunk.source);
      this.cache(relPath, chunk.text);
      results.push({
        path: relPath,
        startLine: 1,
        endLine: 1,
        score: chunk.score,
        textScore: chunk.score,
        snippet: chunk.text.slice(0, 500),
        source: "memory",
        citation: `${relPath}#L1`,
      });
    }
    return results.slice(0, limit);
  }

  async readFile({ relPath, from, lines }: { relPath: string; from?: number; lines?: number }) {
    let text = this.contentCache.get(relPath);
    if (text === undefined) {
      text = await this.fetchSource(relPath);
    } else {
      // Map 的插入顺序就是 LRU 顺序：命中后移到末尾，优先淘汰长期未访问的来源。
      this.contentCache.delete(relPath);
      this.contentCache.set(relPath, text);
    }
    const allLines = text.split("\n");
    const start = Math.max(0, from ?? 0);
    const selected = allLines.slice(start, lines == null ? allLines.length : start + Math.max(0, lines));
    return {
      text: selected.join("\n"),
      path: relPath,
      from: start,
      lines: selected.length,
      truncated: start + selected.length < allLines.length,
      ...(start + selected.length < allLines.length ? { nextFrom: start + selected.length } : {}),
    };
  }

  status(): MemoryProviderStatus {
    return {
      backend: "builtin",
      provider: "openmem",
      chunks: this.contentCache.size,
      workspaceDir: this.config.baseUrl,
      sources: ["memory"],
      fts: { enabled: true, available: this.lastHealth?.ok ?? false },
      vector: { enabled: false, semanticAvailable: false, available: false },
      custom: {
        agentId: this.config.agentId,
        allowSharedRecall: this.config.allowSharedRecall,
        cacheBytes: this.contentCacheBytes,
        maxCacheBytes: this.config.maxCacheBytes,
        health: this.lastHealth ?? { ok: false, checkedAt: null },
      },
    };
  }

  async sync(): Promise<void> {
    await this.checkHealth();
  }

  async probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult> {
    await this.checkHealth();
    return {
      ok: false,
      checked: true,
      checkedAtMs: Date.now(),
      error: "OpenMem currently uses FTS5 and character n-gram reranking, not embeddings",
    };
  }

  async probeVectorAvailability(): Promise<boolean> {
    await this.checkHealth();
    return false;
  }

  async close(): Promise<void> {
    this.contentCache.clear();
    this.contentCacheBytes = 0;
  }

  private async checkHealth(): Promise<void> {
    try {
      const data = await this.client.get<{ status?: unknown }>("/healthz");
      if (data?.status !== "ok") throw new Error("unexpected health response");
      this.lastHealth = { ok: true, checkedAt: Date.now() };
    } catch (error) {
      this.lastHealth = { ok: false, checkedAt: Date.now(), error: String(error) };
      throw error;
    }
  }

  private isChunk(value: unknown): value is SearchChunk {
    if (!value || typeof value !== "object") return false;
    const chunk = value as Partial<SearchChunk>;
    return typeof chunk.text === "string" && chunk.text.trim().length > 0 &&
      typeof chunk.score === "number" && Number.isFinite(chunk.score) &&
      typeof chunk.source === "string" && chunk.source.length > 0 && chunk.source.length <= 2_048 &&
      (chunk.recall_type === "continuity" || chunk.recall_type === "knowledge");
  }

  private sourcePath(source: string): string {
    const separator = source.indexOf(":");
    const kind = separator > 0 ? source.slice(0, separator) : "source";
    const id = separator > 0 ? source.slice(separator + 1) : source;
    const safeKind = ["archive", "memory", "event"].includes(kind) ? kind : "source";
    return `openmem/${safeKind}/${encodeURIComponent(id)}`;
  }

  private async fetchSource(relPath: string): Promise<string> {
    const match = /^openmem\/(archive|memory)\/([^/]+)$/.exec(relPath);
    if (!match) throw new Error("OpenMem source is unavailable or path is invalid");
    const id = decodeURIComponent(match[2]);
    const endpoint = match[1] === "archive" ? `/archives/${encodeURIComponent(id)}` : `/externalized-memories/${encodeURIComponent(id)}`;
    const data = await this.client.get<unknown>(endpoint);
    if (data === undefined || data === null) throw new Error("OpenMem returned an empty source response");
    const text = JSON.stringify(data, null, 2);
    this.cache(relPath, text);
    return text;
  }

  private cache(path: string, content: string): void {
    const bytes = Buffer.byteLength(content, "utf8");
    const previous = this.contentCache.get(path);
    if (previous !== undefined) {
      this.contentCacheBytes -= Buffer.byteLength(previous, "utf8");
      this.contentCache.delete(path);
    }
    // 单条内容超过总预算时仍可直接返回给当前调用方，但不进入长期缓存。
    if (bytes > this.config.maxCacheBytes) return;
    this.contentCache.set(path, content);
    this.contentCacheBytes += bytes;
    while (this.contentCache.size > 1_000 || this.contentCacheBytes > this.config.maxCacheBytes) {
      const oldest = this.contentCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const removed = this.contentCache.get(oldest);
      this.contentCache.delete(oldest);
      if (removed !== undefined) this.contentCacheBytes -= Buffer.byteLength(removed, "utf8");
    }
  }
}
