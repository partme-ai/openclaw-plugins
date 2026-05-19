/**
 * 知识库模块核心类型定义
 *
 * 设计原则：
 * - Embedding 接口抽象化：仅定义 contract，后端可无缝切换
 * - VectorStore 接口抽象化：支持多种向量数据库
 * - 所有类型均为纯数据对象，不含业务逻辑
 */

// ===================================================================
// Embedding 相关
// ===================================================================

/** Embedding 请求 */
export type EmbeddingRequest = {
  /** 输入文本 */
  input: string | string[];
  /** 模型名称（可选，默认使用配置中的 embedding model） */
  model?: string;
};

/** Embedding 响应 */
export type EmbeddingResponse = {
  /** 向量数据 */
  data: { embedding: number[]; index: number }[];
  /** 使用的模型 */
  model: string;
  /** 消耗的 token 数 */
  usage: { promptTokens: number; totalTokens: number };
};

/** Embedding Service 接口 */
export interface EmbeddingService {
  /** 嵌入维度 */
  readonly dimensions: number;
  /** 模型名称 */
  readonly modelName: string;

  /** 单文本嵌入 */
  embed(text: string): Promise<number[]>;
  /** 批量文本嵌入 */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** 健康检查 */
  health(): Promise<boolean>;
}

// ===================================================================
// Vector Store 相关
// ===================================================================

/** 向量块元数据 */
export type VectorChunkMetadata = Record<string, unknown> & {
  /** 原始文档来源标识 */
  sourceId?: string;
  /** 块在文档中的序号 */
  chunkIndex?: number;
  /** 块文本 */
  text: string;
};

/** 存储的向量块 */
export type VectorChunk = {
  /** 唯一 ID（UUID） */
  id: string;
  /** 嵌入向量 */
  vector: number[];
  /** 元数据 */
  metadata: VectorChunkMetadata;
};

/** 检索选项 */
export type SearchOptions = {
  /** 返回 topK 结果（默认 5） */
  topK?: number;
  /** 相似度阈值（0-1，低于此值的结果不返回） */
  minScore?: number;
  /** 按 sourceId 过滤 */
  sourceId?: string;
};

/** 检索结果 */
export type ScoredChunk = {
  chunk: VectorChunk;
  score: number; // 0-1, 1=最相似
};

/** 存储统计 */
export type StoreStats = {
  /** 总块数 */
  totalChunks: number;
  /** 独立文档数 */
  totalDocuments: number;
  /** 当前提供者 */
  provider: string;
  /** 嵌入维度 */
  dimensions: number;
};

/** Vector Store 接口 */
export interface VectorStore {
  /** 初始化（连接、建表等） */
  initialize(): Promise<void>;
  /** 写入/更新向量块 */
  upsert(chunks: VectorChunk[]): Promise<void>;
  /** 批量写入（含自动分片） */
  upsertBatch(chunks: VectorChunk[], batchSize?: number): Promise<void>;
  /** 向量检索 */
  search(vector: number[], options?: SearchOptions): Promise<ScoredChunk[]>;
  /** 按 sourceId 删除 */
  deleteBySource(sourceId: string): Promise<void>;
  /** 清空所有数据 */
  clear(): Promise<void>;
  /** FTS5 关键词检索（可选，非向量存储无需实现） */
  keywordSearch?(query: string, topK?: number, sourceId?: string): Promise<ScoredChunk[]>;
  /** 统计信息 */
  stats(): Promise<StoreStats>;
}

/** Embedding 引擎接口
 *
 * embed() 使用函数重载统一处理单文本和多文本：
 * - embed('hello') → Promise<number[]>
 * - embed(['a', 'b']) → Promise<number[][]>
 */
export interface EmbeddingEngine {
  /** 嵌入向量维度 */
  readonly dimensions: number;
  /**
   * 生成嵌入向量
   * @param input - 单文本或文本数组
   * @returns 单文本返回一维向量，多文本返回二维数组
   */
  embed(input: string): Promise<number[]>;
  embed(input: string[]): Promise<number[][]>;
  embed(input: string | string[]): Promise<number[] | number[][]>;
}

// ===================================================================
// Configuration 相关
// ===================================================================

/** 支持的 Embedding Provider 列表 */
export const EMBEDDING_PROVIDERS = [
  'openai',
  'dashscope',
  'zhipu',
  'qianfan',
  'ollama',
] as const;
export type EmbeddingProvider = typeof EMBEDDING_PROVIDERS[number];

/** Embedding 配置 */
export type KnowledgeEmbeddingConfig = {
  /** API 提供商（默认复用 LLM 配置） */
  provider?: string;
  /** API Base URL */
  baseUrl?: string;
  /** API Key */
  apiKey?: string;
  /** 模型名称 */
  model?: string;
  /** 嵌入维度（仅某些 provider 需要） */
  dimensions?: number;
};

/** 支持的 Tokenizer Provider 列表 */
export const TOKENIZER_PROVIDERS = ['zhipu', 'tiktoken'] as const;
export type TokenizerProvider = typeof TOKENIZER_PROVIDERS[number];

/** Tokenizer 配置 */
export type KnowledgeTokenizerConfig = {
  /** API 提供商（zhipu / tiktoken） */
  provider?: string;
  /** API Base URL（zhipu 远程时使用） */
  baseUrl?: string;
  /** API Key（zhipu 远程时必需） */
  apiKey?: string;
  /** 模型名称（智谱：glm-4.6 等；tiktoken：o200k_base 等编码名） */
  model?: string;
};

/** Tokenizer Service 接口 */
export interface TokenizerService {
  /** 模型名称 */
  readonly modelName: string;
  /** 计算文本的 token 数量 */
  countTokens(text: string): Promise<number>;
  /** 将文本截断到指定 token 数 */
  truncate(text: string, maxTokens: number): Promise<string>;
  /** 健康检查 */
  health(): Promise<boolean>;
}

/** 支持的 Reranker Provider 列表 */
export const RERANKER_PROVIDERS = ['zhipu', 'jina', 'ollama'] as const;
export type RerankerProvider = typeof RERANKER_PROVIDERS[number];

/** 重排序后的文档 */
export type ScoredDocument = {
  /** 原始文本 */
  text: string;
  /** 在输入 documents 中的索引 */
  index: number;
  /** 相关性分数（0-1，越高越相关） */
  score: number;
};

/** Reranker 配置 */
export type KnowledgeRerankerConfig = {
  /** API 提供商（zhipu / jina / none） */
  provider?: string;
  /** API Base URL */
  baseUrl?: string;
  /** API Key */
  apiKey?: string;
  /** 模型名称 */
  model?: string;
  /** 返回得分最高的前 N 条（默认 0=返回所有） */
  topN?: number;
  /** 是否返回原始文本（默认 true） */
  returnDocuments?: boolean;
};

/** Reranker Service 接口 */
export interface RerankerService {
  /** 模型名称 */
  readonly modelName: string;
  /**
   * 对候选文档按与 query 的相关性进行重排序
   * @param query - 查询文本
   * @param documents - 候选文本列表
   * @param topN - 返回 topN 条（默认全部）
   */
  rerank(query: string, documents: string[], topN?: number): Promise<ScoredDocument[]>;
  /** 健康检查 */
  health(): Promise<boolean>;
}

/** 支持的 DocParser Provider 列表 */
export const PARSER_PROVIDERS = ['zhipu', 'ollama'] as const;
export type ParserProvider = typeof PARSER_PROVIDERS[number];

/** 文档解析结果 */
export type ParsedDocument = {
  /** Markdown 格式的文本内容 */
  text: string;
  /** 原始文件元数据 */
  metadata: {
    /** 原始文件名 */
    fileName: string;
    /** 文件 MIME 类型 */
    mimeType?: string;
    /** 文件大小（字节） */
    fileSize?: number;
    /** 总页数（PDF 场景） */
    totalPages?: number;
  };
  /** 布局详情（可选，仅智谱 layout_parsing 返回） */
  layout?: {
    /** 页面列表 */
    pages: {
      width: number;
      height: number;
      elements: {
        type: 'text' | 'image' | 'table' | 'formula';
        content: string;
        bbox: [number, number, number, number];
      }[];
    }[];
  };
};

/** DocParser 配置 */
export type KnowledgeParserConfig = {
  /** API 提供商（zhipu / ollama / local） */
  provider?: string;
  /** API Base URL（ollama/vLLM 时使用） */
  baseUrl?: string;
  /** API Key（智谱远程时必需） */
  apiKey?: string;
  /** 模型名称 */
  model?: string;
};

/** DocParser Service 接口 */
export interface DocParserService {
  /** 模型名称 */
  readonly modelName: string;
  /**
   * 解析文档文件为结构化文本
   * @param file - 文件路径或 URL 或 base64 数据
   * @returns 解析后的文档对象
   */
  parse(file: string): Promise<ParsedDocument>;
  /** 健康检查 */
  health(): Promise<boolean>;
}

/** 向量存储配置 */
export type KnowledgeStoreConfig = {
  /** 存储提供者 */
  provider: 'zvec' | 'sqlite-vec' | 'native-zvec' | 'redis' | 'pinecone' | 'chroma' | 'weaviate' | 'qdrant' | 'milvus' | 'pgvector' | 'elasticsearch' | 'opensearch' | string;
  /** 命名空间隔离前缀（自动生成，一般不需要手写） */
  namespace?: string;

  // --- 通用连接参数 ---
  /** URL 连接地址 */
  url?: string;
  /** 主机 */
  host?: string;
  /** 端口 */
  port?: number;

  // --- Redis ---
  /** Redis URI */
  redisUri?: string;

  // --- Pinecone ---
  pineconeApiKey?: string;
  pineconeEnvironment?: string;
  pineconeIndexName?: string;

  // --- Chroma ---
  chromaCollectionName?: string;

  // --- Weaviate ---
  weaviateCollectionName?: string;

  // --- PostgreSQL pgvector ---
  pgvectorIndexType?: 'ivfflat' | 'hnsw';
  pgvectorDistanceType?: 'cosine' | 'l2' | 'inner_product';
  pgvectorDimensions?: number;

  // --- Qdrant ---
  qdrantCollectionName?: string;

  // --- Milvus ---
  milvusCollectionName?: string;

  // --- Elasticsearch/OpenSearch ---
  esIndexName?: string;

  // --- ZVec / SQLite-Vec ---
  /** ZVec/SQLite-Vec 的数据库文件路径 */
  dbPath?: string;

  // --- 进阶参数 ---
  /** 索引关联的 source 来源配置（可选） */
  sources?: KnowledgeSourceConfig;

  /** 额外的连接参数（provider 特化） */
  extra?: Record<string, unknown>;
};

/** 来源配置 */
export type KnowledgeSourceConfig = {
  /** 文档来源 IDs */
  docIds?: string[];
  /** 文档目录（本地文件索引） */
  docDirs?: string[];
  /** 外部文档 URL 列表 */
  urls?: string[];
};

/** 检索配置 */
export type KnowledgeRetrievalConfig = {
  /** 检索策略：混合 | 仅向量 | 仅关键词 */
  strategy?: 'hybrid' | 'vector' | 'keyword';
  /** 返回 topK */
  topK?: number;
  /** 相似度阈值 */
  minScore?: number;
  /** 是否启用关键词增强 */
  keywordBoost?: boolean;
};

/** 注入配置 */
export type KnowledgeInjectionConfig = {
  /** 注入位置（默认 system） */
  position?: 'system' | 'user';
  /** 上下文格式模板 */
  template?: string;
  /** 最大上下文块数 */
  maxChunks?: number;
  /** 最大上下文 token 数 */
  maxTokens?: number;
};

/** 过滤配置 */
export type KnowledgeModerationConfig = {
  /** 是否启用内容审核 */
  enabled?: boolean;
  /** 驳回提示词 */
  rejectionMessage?: string;
};

/** Intent Gate 配置 */
export type KnowledgeIntentGateConfig = {
  /** 门控模式：'rule'（默认，规则+关键词） | 'strict'（更严格的规则门） */
  mode?: 'rule' | 'strict';
  /** 自定义触发词（不配则使用默认词表） */
  triggers?: string[];
  /** 自定义跳过词（不配则使用默认词表） */
  skips?: string[];
};

/** 完整知识库配置 */
export type KnowledgeConfig = {
  /** 是否启用 */
  enabled: boolean;
  /** Intent Gate 配置（默认只走 rule 模式） */
  intentGate?: KnowledgeIntentGateConfig;
  /** Embedding 配置 */
  embedding?: KnowledgeEmbeddingConfig;
  /** Tokenizer 配置 */
  tokenizer?: KnowledgeTokenizerConfig;
  /** Reranker 配置 */
  reranker?: KnowledgeRerankerConfig;
  /** DocParser 配置 */
  parser?: KnowledgeParserConfig;
  /** 向量存储配置 */
  store?: KnowledgeStoreConfig;
  /** 检索配置 */
  retrieval?: KnowledgeRetrievalConfig;
  /** 注入配置 */
  injection?: KnowledgeInjectionConfig;
  /** 过滤配置 */
  moderation?: KnowledgeModerationConfig;
};

/** DeepPartial — 递归可选，用于 account 级覆盖（排除 enabled 字段） */
export type DeepPartialKnowledgeConfig = {
  intentGate?: DeepPartial<KnowledgeIntentGateConfig>;
  embedding?: DeepPartial<KnowledgeEmbeddingConfig>;
  tokenizer?: DeepPartial<KnowledgeTokenizerConfig>;
  reranker?: DeepPartial<KnowledgeRerankerConfig>;
  parser?: DeepPartial<KnowledgeParserConfig>;
  store?: DeepPartial<KnowledgeStoreConfig> & { sources?: KnowledgeSourceConfig };
  retrieval?: DeepPartial<KnowledgeRetrievalConfig>;
  injection?: DeepPartial<KnowledgeInjectionConfig>;
  moderation?: DeepPartial<KnowledgeModerationConfig>;
};

// ===================================================================
// 内部辅助类型
// ===================================================================

type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

// ===================================================================
// Chunker 相关
// ===================================================================

/** 文本块 */
export type TextChunk = {
  /** 块文本 */
  text: string;
  /** 块在文档中的序号 */
  index: number;
  /** 原始文档 ID */
  sourceId: string;
  /** 字符偏移起始 */
  startOffset: number;
  /** 字符偏移结束 */
  endOffset: number;
};

// ===================================================================
// RAG 上下文结果
// ===================================================================

/** RAG 检索结果（已注入上下文的格式） */
export type RagContextResult = {
  /** 检索到的块列表 */
  chunks: ScoredChunk[];
  /** 格式化的上下文文本 */
  contextText: string;
  /** 注入位置 */
  position: 'system' | 'user';
};

// ===================================================================
// Hook 事件相关
// ===================================================================

/** before_prompt_build 事件的上下文（按 openclaw 规范） */
export type BeforePromptBuildContext = {
  channelId: string;
  agentId?: string;
  userId?: string;
  accountId?: string;
  message?: string;
  [key: string]: unknown;
};

/** before_prompt_build 事件的返回值 */
export type BeforePromptBuildResult = {
  systemPrompt?: string;
  userPrompt?: string;
};
