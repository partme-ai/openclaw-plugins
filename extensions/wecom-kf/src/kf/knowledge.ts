/**
 * KF 知识库配置与检索集成
 *
 * 整合 OpenClaw 内置 knowledge 插件进行 RAG 增强。
 * 在 Agent 调度前检索相关知识，注入到消息上下文中。
 */

export type KfKnowledgeConfig = {
  enabled: boolean;
  /** 知识库搜索的最大结果数 */
  topK: number;
  /** 相关性分数阈值 (0-1) */
  scoreThreshold: number;
  /** 知识库搜索来源 */
  source: "openclaw-knowledge" | "local-files" | "external";
  /** 本地文件路径（source=local-files 时使用） */
  localPaths?: string[];
  /** 外部 API 端点（source=external 时使用） */
  externalEndpoint?: string;
  /** 搜索重排序 */
  rerankEnabled: boolean;
};

export type KnowledgeResult = {
  title: string;
  content: string;
  score: number;
  source: string;
  path?: string;
};

export const DEFAULT_KNOWLEDGE_CONFIG: KfKnowledgeConfig = {
  enabled: false,
  topK: 5,
  scoreThreshold: 0.3,
  source: "openclaw-knowledge",
  rerankEnabled: false,
};

/**
 * 检索知识库内容
 *
 * 优先使用 OpenClaw 内置 memory_search/knowledge 插件，
 * 回退到本地文件搜索。
 */
export async function searchKnowledge(
  query: string,
  config: KfKnowledgeConfig,
  runtime?: {
    channel?: Record<string, unknown>;
    memorySearch?: (params: { query: string; limit: number }) => Promise<KnowledgeResult[]>;
    [key: string]: unknown;
  },
): Promise<KnowledgeResult[]> {
  if (!config.enabled) return [];
  if (!query.trim()) return [];

  try {
    if (config.source === "openclaw-knowledge" && runtime?.memorySearch) {
      const results = await runtime.memorySearch({
        query: query.trim(),
        limit: config.topK,
      });
      return results.filter((r) => r.score >= config.scoreThreshold);
    }

    if (config.source === "local-files" && config.localPaths) {
      // Local file search via keyword matching (fallback)
      return searchLocalFiles(query, config);
    }

    if (config.source === "external" && config.externalEndpoint) {
      return searchExternalApi(query, config);
    }
  } catch (err) {
    console.warn("[wecom_kf] Knowledge search error (non-blocking):", err);
  }

  return [];
}

/**
 * 构建知识库上下文文本
 */
export function buildKnowledgeContext(results: KnowledgeResult[]): string {
  if (results.length === 0) return "";

  const sections = results.map((r, i) => {
    const title = r.title || `知识条目 ${i + 1}`;
    const source = r.source ? ` (来源: ${r.source})` : "";
    return `【${title}${source}】\n${r.content}`;
  });

  return [
    "【知识库参考】",
    "以下内容来自知识库，请参考使用（按相关性排序）：",
    "",
    sections.join("\n\n"),
    "",
    "注意：以上内容仅供参考，请结合具体场景进行判断和回答。",
  ].join("\n");
}

async function searchLocalFiles(
  query: string,
  config: KfKnowledgeConfig,
): Promise<KnowledgeResult[]> {
  // Basic keyword matching against known file paths
  // For production, use a proper text search or embedding approach
  const keywords = query.toLowerCase().split(/\s+/);
  const results: KnowledgeResult[] = [];

  for (const filePath of config.localPaths ?? []) {
    try {
      const content = await readLocalFile(filePath);
      const score = keywords.reduce((s, kw) => s + (content.toLowerCase().includes(kw) ? 1 : 0), 0) / keywords.length;
      if (score >= config.scoreThreshold) {
        results.push({
          title: filePath.split("/").pop() ?? filePath,
          content: content.slice(0, 2000),
          score,
          source: "local",
          path: filePath,
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, config.topK);
}

async function searchExternalApi(
  query: string,
  config: KfKnowledgeConfig,
): Promise<KnowledgeResult[]> {
  if (!config.externalEndpoint) return [];

  try {
    const res = await fetch(config.externalEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, topK: config.topK }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: KnowledgeResult[] };
    return (data.results ?? []).filter((r) => r.score >= config.scoreThreshold);
  } catch {
    return [];
  }
}

async function readLocalFile(filePath: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Resolve knowledge config from account config.
 */
export function resolveKfKnowledgeConfig(
  accountConfig: Record<string, unknown>,
): KfKnowledgeConfig {
  const kf = (accountConfig.kf ?? {}) as Record<string, unknown>;
  const knowledge = (kf.knowledge ?? {}) as Partial<KfKnowledgeConfig>;

  return {
    ...DEFAULT_KNOWLEDGE_CONFIG,
    enabled: (knowledge.enabled ?? accountConfig.knowledgeEnabled ?? false) as boolean,
    topK: (knowledge.topK ?? DEFAULT_KNOWLEDGE_CONFIG.topK) as number,
    scoreThreshold: (knowledge.scoreThreshold ?? DEFAULT_KNOWLEDGE_CONFIG.scoreThreshold) as number,
    source: (knowledge.source ?? DEFAULT_KNOWLEDGE_CONFIG.source) as KfKnowledgeConfig["source"],
    localPaths: knowledge.localPaths as string[] | undefined,
    externalEndpoint: knowledge.externalEndpoint as string | undefined,
    rerankEnabled: (knowledge.rerankEnabled ?? false) as boolean,
  };
}
