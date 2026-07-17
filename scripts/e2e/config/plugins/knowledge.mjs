import { join } from "node:path";

import { E2E_PORTS, STATE_DIR } from "../../lib/utils.mjs";

/**
 * Knowledge E2E 的持久化根路径。
 *
 * Store 会在该路径上按 namespace 派生实际 SQLite 文件；Gateway 重启保留文件，
 * 整轮 E2E 开始时仍由专用 profile reset 清理，避免跨运行污染。
 */
export const KNOWLEDGE_E2E_DB_PATH = join(STATE_DIR, "knowledge-e2e", "knowledge.db");

/**
 * 与 Gateway 插件配置共用的知识库参数。
 *
 * Embedding 指向本地 OpenAI-compatible fixture，既验证真实 HTTP 协议，又不要求
 * 商业 API 凭据。8 维仅用于缩短测试数据；生产环境应按实际模型维度配置。
 */
export const KNOWLEDGE_E2E_CONFIG = {
  enabled: true,
  embedding: {
    provider: "openai",
    baseUrl: `http://127.0.0.1:${E2E_PORTS.modelFixture}/v1`,
    apiKey: "openclaw-e2e-embedding-key",
    model: "fixture-embedding",
    dimensions: 8,
    requestTimeoutMs: 5_000,
    maxRetries: 0,
    maxBatchSize: 16,
  },
  store: {
    provider: "sqlite-vec",
    dbPath: KNOWLEDGE_E2E_DB_PATH,
  },
  retrieval: {
    strategy: "hybrid",
    topK: 5,
    minScore: 0,
    vectorWeight: 0.7,
    keywordWeight: 0.3,
  },
  injection: {
    position: "system",
    template: "[E2E KNOWLEDGE]\n{context}",
    maxChunks: 5,
    maxTokens: 512,
  },
  intentGate: { mode: "rule" },
  tools: { maxInputChars: 10_000 },
};

/** 安装态配置片段：Knowledge 是 capability，不注册 channel 或独占 slot。 */
export function knowledgeConfig() {
  return {
    pluginEntry: {
      knowledge: {
        enabled: true,
        config: KNOWLEDGE_E2E_CONFIG,
      },
    },
    channelEntry: {},
  };
}
