# OpenClaw Knowledge RAG 引擎 — 开发指南

> 本指南面向希望在 `openclaw-knowledge` 知识库 RAG 模块上进行功能扩展、添加新向量存储后端或定制检索策略的开发者。

---

**前置阅读**：
- [OpenClaw-Knowledge-RAG-Architecture_CN.md](OpenClaw-Knowledge-RAG-Architecture_CN.md) — 架构与模块设计

---

## 目录

1. 本地开发环境搭建
2. 代码结构与核心类型
3. 扩展 Embedding 服务
4. 添加新的向量存储后端
5. 自定义文本切分策略
6. 定制检索策略
7. 测试指南
8. 开发规范与约定
9. 注册本地 Tool

---

## 0. 多渠道集成说明

`@partme.ai/openclaw-knowledge` 是独立于渠道插件的 RAG 引擎。各渠道通过 import + `onRegister` 方式集成，核心集成代码完全一致：

```typescript
import {
  registerKnowledgeHooks,
  createKnowledgeAddTool,
  createKnowledgeQueryTool,
  createKnowledgeUpdateTool,
  createKnowledgeDeleteTool,
} from '@partme.ai/openclaw-knowledge';

export function onRegister(api: PluginApi) {
  registerKnowledgeHooks(api, 'channels.{channel}.knowledge');
  api.registerTool(createKnowledgeAddTool);
  api.registerTool(createKnowledgeQueryTool);
  api.registerTool(createKnowledgeUpdateTool);
  api.registerTool(createKnowledgeDeleteTool);
}
```

各渠道差异仅在于：

| 渠道 | 插件包名 | 配置路径 | 建议注册的工具 | 特有文档 Skill |
|------|---------|---------|--------------|--------------|
| **企微** | `@mocrane/wecom` | `channels.wecom.knowledge` | 全部 4 个 | `wecom-doc` |
| **飞书** | `@partme.ai/openclaw-lark` | `channels.lark.knowledge` | add + query + update | `feishu-fetch-doc` |
| **钉钉** | `@partme.ai/openclaw-dingtalk` | `channels.dingtalk.knowledge` | add + query | 待实现 |
| **QQ 机器人** | `@partme.ai/openclaw-qqbot` | `channels.qqbot.knowledge` | add + query | 待实现 |
| **微信** | `@partme.ai/openclaw-weixin` | `channels.weixin.knowledge` | add + query | 待实现 |

开发者在扩展功能时无需关注具体渠道，所有知识库操作均通过 `@partme.ai/openclaw-knowledge` 的统一 API 完成。

---

## 1. 本地开发环境搭建

### 1.1 克隆与安装

```bash
git clone https://github.com/partme-ai/openclaw-knowledge
cd openclaw-knowledge

# 确认 Node.js 版本 ≥ 22
node -v

# 安装依赖
pnpm install

# 可选：SQLite-Vec 依赖（需要原生模块编译）
npm install better-sqlite3
```

### 1.2 类型检查

```bash
npx tsc --noEmit
```

### 1.3 运行测试

```bash
# 运行所有测试
npx vitest --config vitest.config.ts

# 仅运行知识库模块相关测试
npx vitest --config vitest.config.ts src/knowledge/

# 运行特定测试
npx vitest --config vitest.config.ts src/knowledge/zvec.test.ts
npx vitest --config vitest.config.ts src/knowledge/chunker.test.ts
npx vitest --config vitest.config.ts src/knowledge/config-merge.test.ts
```

### 1.4 调试输出

知识库模块的所有日志均以 `[KNOWLEDGE]` 前缀输出：

```typescript
// 在 hooks.ts 和 scheduler.ts 中使用
logger.info('[KNOWLEDGE] 索引文档: ' + filePath);
logger.warn('[KNOWLEDGE] 检索无结果: ' + query);
logger.error('[KNOWLEDGE] Embedding API 连接失败: ' + error);
```

---

## 2. 代码结构与核心类型

### 2.1 核心模块文件清单

```
src/knowledge/
├── types.ts                      ← 所有核心类型的单一源
├── hooks.ts                      ← 插件生命周期 + before_prompt_build hook
├── index.ts                      ← 公共导出
│
├── embedding/
│   ├── openai.ts                 ← OpenAI 兼容 Embedding 实现
│   └── [custom].ts               ← 你的自定义 Embedding 服务
│
├── store/
│   ├── factory.ts                ← VectorStore 工厂（创建/配置）
│   ├── zvec.ts                   ← 纯 JS 内存向量引擎
│   ├── sqlite-vec.ts             ← SQLite 持久化向量引擎
│   ├── math.ts                   ← 余弦相似度等数学工具
│   └── [custom].ts               ← 你的自定义 VectorStore
│
├── indexer/
│   ├── chunker.ts                ← 文本切分器
│   ├── scheduler.ts              ← 索引调度器
│   └── [custom-chunker].ts       ← 你的自定义切分策略
│
├── retriever/
│   ├── hybrid.ts                 ← 混合检索
│   └── [custom].ts               ← 你的自定义检索器
│
├── tools/
│   ├── knowledge-add.ts             ← 知识库写入 Tool（store_text / store_file / store_summary）
│   ├── knowledge-query.ts           ← 知识库检索 Tool（vector / keyword / hybrid）
│   ├── knowledge-update.ts          ← 知识库更新 Tool（按 sourceId 替换）
│   └── knowledge-delete.ts          ← 知识库删除 Tool（按 sourceId / 清空 namespace）
│
└── [扩展点]                      ← 你的新模块
```

### 2.2 核心类型树

```typescript
// === Embedding 接口 ===
export interface EmbeddingService {
  readonly dimensions: number;
  readonly modelName: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  health(): Promise<boolean>;
}

// === VectorStore 接口 ===
export interface VectorStore {
  initialize(): Promise<void>;
  upsert(chunks: VectorChunk[]): Promise<void>;
  upsertBatch(chunks: VectorChunk[], batchSize?: number): Promise<void>;
  search(vector: number[], options?: SearchOptions): Promise<ScoredChunk[]>;
  deleteBySource(sourceId: string): Promise<void>;
  clear(): Promise<void>;
  stats(): Promise<StoreStats>;
}

// === 数据模型 ===
export type VectorChunk = {
  id: string;
  vector: number[];
  metadata: VectorChunkMetadata;
};

export type ScoredChunk = {
  chunk: VectorChunk;
  score: number;
};

export type SearchOptions = {
  topK?: number;
  minScore?: number;
  sourceId?: string;
};
```

### 2.3 核心入口点（hooks.ts 调用链路）

```
插件注册（register）
  ├─ registerKnowledgeHooks(api)
  │    ├─ 存储 api 引用
  │    ├─ 注册 before_prompt_build hook → handleBeforePromptBuild
  │    └─ 注册 onUnload 清理 → storeCache 清除
  ├─ registerTool(createKnowledgeAddTool,    { name: "knowledge_add" })
  │    └─ OpenClaw 每次 Agent 会话构建时调用 → 返回 { name: 'knowledge_add', ... }
  │         └─ execute 根据 action 分发：
  │              ├─ store_text    → chunk → embed → upsert
  │              ├─ store_file    → 校验文件 → indexDocument
  │              └─ store_summary → 组合 topic+text → chunk → embed → upsert
  ├─ registerTool(createKnowledgeQueryTool,  { name: "knowledge_query" })
  │    └─ 返回 { name: 'knowledge_query', ... }
  │         └─ execute 根据 strategy 分发：
  │              ├─ vector  → store.search()
  │              ├─ keyword → store.keywordSearch()
  │              └─ hybrid  → store.hybridSearch()
  ├─ registerTool(createKnowledgeUpdateTool, { name: "knowledge_update" })
  │    └─ 返回 { name: 'knowledge_update', ... }
  │         └─ execute → deleteBySource(sourceId) + 重新写入
  └─ registerTool(createKnowledgeDeleteTool, { name: "knowledge_delete" })
       └─ 返回 { name: 'knowledge_delete', ... }
            └─ execute 根据 action 分发：
                 ├─ delete_by_source → store.deleteBySource(sourceId)
                 └─ clear           → 需用户确认 → store.clearNamespace()

before_prompt_build 事件
  └─ handleBeforePromptBuild(ctx)
       ├─ 跳过非当前渠道
       ├─ 解析配置（全局 + account 覆盖）
       ├─ getOrCreateStore(config, namespace)
       └─ retrieveContext(query, embedding, store, topK)
            └─ 返回 { systemPrompt: contextText }
```

---

## 3. 扩展 Embedding 服务

### 3.1 实现 EmbeddingService 接口

所有 Embedding 服务必须实现 `EmbeddingService` 接口。以自定义 `HuggingFaceEmbedding` 为例：

```typescript
// src/knowledge/embedding/huggingface.ts
import type { EmbeddingService, KnowledgeEmbeddingConfig } from '../types.js';

export class HuggingFaceEmbeddingService implements EmbeddingService {
  readonly dimensions: number;
  readonly modelName: string;
  private baseUrl: string;
  private apiKey?: string;

  constructor(config: KnowledgeEmbeddingConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api-inference.huggingface.co';
    this.apiKey = config.apiKey;
    this.modelName = config.model ?? 'sentence-transformers/all-MiniLM-L6-v2';
    // HuggingFace 模型的默认维度
    this.dimensions = config.dimensions ?? 384;
  }

  async embed(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text]);
    return vec;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/pipeline/feature-extraction/${this.modelName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
    });

    if (!response.ok) {
      throw new Error(`HuggingFace embedding API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result as number[][];
  }

  async health(): Promise<boolean> {
    try {
      await this.embed('health check');
      return true;
    } catch {
      return false;
    }
  }
}
```

### 3.2 注册到 Embedding 工厂

```typescript
// 在 hooks.ts 或 factory.ts 中：
function createEmbeddingService(config: KnowledgeEmbeddingConfig): EmbeddingService {
  const provider = config.provider ?? 'openai';

  switch (provider) {
    case 'openai':
      return new OpenAIEmbeddingService(config);
    case 'huggingface':
      return new HuggingFaceEmbeddingService(config);
    default:
      throw new Error(`不支持的 Embedding provider: ${provider}`);
  }
}
```

---

## 4. 添加新的向量存储后端

### 4.1 实现 VectorStore 接口

以自定义 `MemoryStore` 为例：

```typescript
// src/knowledge/store/memory.ts
import type { VectorStore, VectorChunk, ScoredChunk, SearchOptions, StoreStats } from '../types.js';
import { cosineSimilarity } from './math.js';

export class MemoryStore implements VectorStore {
  private chunks: VectorChunk[] = [];
  private dimensions: number;

  constructor(dimensions: number) {
    this.dimensions = dimensions;
  }

  async initialize(): Promise<void> {
    this.chunks = [];
  }

  async upsert(chunks: VectorChunk[]): Promise<void> {
    for (const chunk of chunks) {
      const idx = this.chunks.findIndex(c => c.id === chunk.id);
      if (idx >= 0) {
        this.chunks[idx] = chunk;
      } else {
        this.chunks.push(chunk);
      }
    }
  }

  async upsertBatch(chunks: VectorChunk[], batchSize = 100): Promise<void> {
    // 分片处理（大批量时避免内存抖动）
    for (let i = 0; i < chunks.length; i += batchSize) {
      await this.upsert(chunks.slice(i, i + batchSize));
    }
  }

  async search(vector: number[], options?: SearchOptions): Promise<ScoredChunk[]> {
    const { topK = 5, minScore = 0, sourceId } = options ?? {};

    const scored = this.chunks
      .filter(c => !sourceId || c.metadata.sourceId === sourceId)
      .map(chunk => ({
        chunk,
        score: cosineSimilarity(vector, chunk.vector),
      }))
      .filter(s => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }

  async deleteBySource(sourceId: string): Promise<void> {
    this.chunks = this.chunks.filter(c => c.metadata.sourceId !== sourceId);
  }

  async clear(): Promise<void> {
    this.chunks = [];
  }

  async stats(): Promise<StoreStats> {
    const sources = new Set(this.chunks.map(c => c.metadata.sourceId ?? ''));
    return {
      totalChunks: this.chunks.length,
      totalDocuments: sources.size,
      provider: 'memory',
      dimensions: this.dimensions,
    };
  }
}
```

### 4.2 注册到 Store 工厂

在 `src/knowledge/store/factory.ts` 中添加新分支：

```typescript
export async function createVectorStore(
  config: KnowledgeStoreConfig,
  dimensions: number,
): Promise<VectorStore> {
  switch (config.provider) {
    case 'zvec':
      return new ZVecStore(dimensions);
    case 'sqlite-vec':
      return new SqliteVecStore(config.dbPath!, dimensions);
    case 'memory':
      return new MemoryStore(dimensions);
    // ... 其他后端
    default:
      throw new Error(`不支持的向量存储提供者: ${config.provider}`);
  }
}
```

### 4.3 后端实现的注意事项

| 关注点 | 说明 |
|--------|------|
| **线程安全** | SQLite-Vec 等后端需使用 WAL 模式处理并发写入 |
| **批量写入** | 实现 `upsertBatch` 时考虑分片策略（默认每批 100 条） |
| **维度校验** | 写入前校验 `vector.length === dimensions`，不匹配时抛错 |
| **返回格式** | `search` 返回的 `score` 必须是 0-1 之间的数值，1 表示最相似 |
| **命名空间** | 工厂根据 `namespace` 创建独立的实例（或表/集合） |

---

## 5. 自定义文本切分策略

### 5.1 实现新的 Chunker

```typescript
// src/knowledge/indexer/code-chunker.ts
import type { TextChunk } from '../types.js';

/**
 * 代码文件专用切分器
 * - 按函数/类定义切分（而非行数）
 * - 保留函数签名作为前缀
 */
export function chunkCode(code: string, sourceId: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  // 按函数定义切分（简化示例）
  const funcRegex = /(?:function|async function|const \w+ =|class \w+)[^;{]*{(?:[^{}]*{[^{}]*}[^{}]*)*}/gs;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = funcRegex.exec(code)) !== null) {
    chunks.push({
      text: match[0],
      index,
      sourceId,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
    index++;
  }

  return chunks;
}
```

### 5.2 注册到 Chunker 调度器

```typescript
// 在 scheduler.ts 中或通过策略配置：
const chunkerStrategies: Record<string, (text: string, sourceId: string) => TextChunk[]> = {
  recursive: chunkText,        // 默认递归切分
  fixed: chunkFixed,           // 固定长度
  code: chunkCode,             // 代码专用
  markdown: chunkMarkdown,     // Markdown 标题切分
};
```

---

## 6. 定制检索策略

### 6.1 实现自定义 Retriever

```typescript
// src/knowledge/retriever/rrf.ts — 基于 Reciprocal Rank Fusion 的多路召回融合
import type { EmbeddingService, VectorStore, ScoredChunk, RagContextResult } from '../types.js';

export async function rrfRetrieval(
  query: string,
  embedding: EmbeddingService,
  store: VectorStore,
  options: {
    topK: number;
    minScore: number;
  },
): Promise<RagContextResult> {
  // 1. 向量检索
  const queryVec = await embedding.embed(query);
  const vectorResults = await store.search(queryVec, { topK: options.topK * 2 });

  // 2. 如果有关键词检索能力，再加一路
  // ...

  // 3. RRF 融合（简化版）
  const rrfScores = new Map<string, { chunk: ScoredChunk['chunk']; score: number }>();
  vectorResults.forEach((result, rank) => {
    const rrfScore = 1 / (60 + rank); // RRF 公式
    const existing = rrfScores.get(result.chunk.id);
    rrfScores.set(result.chunk.id, {
      chunk: result.chunk,
      score: (existing?.score ?? 0) + rrfScore,
    });
  });

  const sorted = Array.from(rrfScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, options.topK);

  const contextText = sorted
    .map((s, i) => `[${i + 1}] ${s.chunk.metadata.text}`)
    .join('\n\n---\n\n');

  return {
    chunks: sorted.map(s => ({ chunk: s.chunk, score: s.score })),
    contextText,
    position: 'system',
  };
}
```

### 6.2 注册到检索调度

```typescript
// 在 hooks.ts 的 handleBeforePromptBuild 中：
const retrievalStrategies = {
  vector: vectorRetrieval,
  keyword: keywordRetrieval,
  hybrid: hybridSearch,
  rrf: rrfRetrieval,      // 新增
};
```

---

## 7. 测试指南

### 7.1 测试策略

| 层次 | 测试内容 | 测试文件 |
|------|----------|----------|
| 单元测试 | VectorStore 基本操作（upsert/search/delete） | `zvec.test.ts` |
| 单元测试 | Chunker 切分逻辑 | `chunker.test.ts` |
| 单元测试 | 配置合并逻辑 | `config-merge.test.ts` |
| 集成测试 | Embedding + Store + Chunker 端到端 | `scheduler.test.ts` |
| 集成测试 | Hook 注入完整链路 | `hooks.test.ts` |

### 7.2 模拟 Embedding

为了在测试中避免真实的 API 调用，测试使用固定维度的随机向量：

```typescript
// test-utils/mock-embedding.ts
export class MockEmbeddingService implements EmbeddingService {
  readonly dimensions = 4;
  readonly modelName = 'mock';

  async embed(text: string): Promise<number[]> {
    return [0.1, 0.2, 0.3, 0.4]; // 固定向量，便于断言
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0.1, 0.2, 0.3, 0.4]);
  }

  async health(): Promise<boolean> {
    return true;
  }
}
```

### 7.3 ZVec 测试示例

```typescript
// src/knowledge/zvec.test.ts
import { describe, it, expect } from 'vitest';
import { ZVecStore } from './store/zvec.js';

describe('ZVecStore', () => {
  const store = new ZVecStore(4);

  it('should initialize empty', async () => {
    const stats = await store.stats();
    expect(stats.totalChunks).toBe(0);
  });

  it('should upsert and search', async () => {
    await store.upsert([{
      id: 'test-1',
      vector: [1, 0, 0, 0],
      metadata: { text: 'hello', sourceId: 'doc1' },
    }]);

    const results = await store.search([1, 0, 0, 0], { topK: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].chunk.metadata.text).toBe('hello');
    expect(results[0].score).toBeCloseTo(1, 3);
  });

  it('should delete by source', async () => {
    await store.deleteBySource('doc1');
    const stats = await store.stats();
    expect(stats.totalChunks).toBe(0);
  });
});
```

### 7.4 Chunker 测试示例

```typescript
// src/knowledge/chunker.test.ts
import { describe, it, expect } from 'vitest';
import { chunkText } from './indexer/chunker.js';

describe('chunkText', () => {
  it('should split long text into chunks', () => {
    const text = 'A'.repeat(3000); // 超过 chunkSize 默认 1000
    const chunks = chunkText(text, 'test-doc');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].sourceId).toBe('test-doc');
  });

  it('should preserve text content across chunks with overlap', () => {
    const text = 'Hello World! ' + 'B'.repeat(1000) + ' Goodbye!';
    const chunks = chunkText(text, 'test', { chunkSize: 200, chunkOverlap: 50 });
    // 验证重叠区域
    const overlap = chunks[0].text.slice(-50);
    expect(chunks[1].text.startsWith(overlap)).toBe(true);
  });

  it('should return single chunk for short text', () => {
    const chunks = chunkText('Short text', 'test');
    expect(chunks).toHaveLength(1);
  });

  it('should handle empty text', () => {
    const chunks = chunkText('', 'test');
    expect(chunks).toHaveLength(0);
  });
});
```

### 7.5 配置合并测试示例

```typescript
// src/knowledge/config-merge.test.ts
import { describe, it, expect } from 'vitest';
import { deepMergeKnowledgeConfig } from './hooks.js';

describe('deepMergeKnowledgeConfig', () => {
  it('should merge embedding configs', () => {
    const global = { enabled: true, embedding: { model: 'default-model', dimensions: 1536 } };
    const account = { embedding: { model: 'account-model' } };
    const merged = deepMergeKnowledgeConfig(global, account);
    expect(merged.embedding.model).toBe('account-model');
    expect(merged.embedding.dimensions).toBe(1536); // 继承全局
  });

  it('should completely replace sources in store config', () => {
    const global = { enabled: true, store: { provider: 'zvec', sources: { docIds: ['a', 'b'] } } };
    const account = { store: { sources: { docIds: ['c'] } } };
    const merged = deepMergeKnowledgeConfig(global, account);
    expect(merged.store.sources.docIds).toEqual(['c']); // 完全替换
  });

  it('should keep enabled from global', () => {
    const global = { enabled: true };
    const account = {} as any;
    const merged = deepMergeKnowledgeConfig(global, account);
    expect(merged.enabled).toBe(true);
  });
});
```

---

## 8. 开发规范与约定

### 8.1 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 接口 | `I` 前缀不强制，但接口名需清晰 | `VectorStore`, `EmbeddingService` |
| 实现类 | 以具体的后端/策略命名 | `ZVecStore`, `OpenAIEmbeddingService` |
| 类型 | PascalCase | `KnowledgeConfig`, `ScoredChunk` |
| 函数 | camelCase | `chunkText`, `indexDocument` |
| 文件 | kebab-case | `sqlite-vec.ts`, `config-merge.test.ts` |

### 8.2 错误处理规范

```typescript
// ✅ 正确：外层统一 try/catch，内层抛出具体错误
async function indexDocument(...) {
  const text = await loadDocument(filePath); // 可能抛 Error
  const chunks = chunkText(text, sourceId);  // 纯计算，不抛错
  const vectors = await embedding.embedBatch(texts); // 可能抛 Error
  await store.upsert(vectorChunks); // 可能抛 Error
}

// 调用方统一捕获
try {
  await indexDocument(...);
} catch (error) {
  logger.error('[KNOWLEDGE] 索引失败: ' + error.message);
  // 不重新抛出——知识库失败不影响对话
}
```

### 8.3 日志约定

| 级别 | 使用场景 | 示例 |
|------|----------|------|
| `info` | 索引成功、检索命中 | `[KNOWLEDGE] 索引成功: 12 chunks` |
| `warn` | 配置不完整、检索无结果 | `[KNOWLEDGE] 检索未命中：query="xxx"` |
| `error` | API 失败、存储异常 | `[KNOWLEDGE] Embedding API 连接失败: xxx` |

### 8.4 侵入式修改的规范

知识库 RAG 子模块在 `src/monitor.ts`、`src/agent/handler.ts` 和 `src/knowledge/indexer/scheduler.ts` 中有四处侵入点。修改时必须遵守基本原则（try/catch 包裹、纯加法、日志前缀），本节给出四处侵入点的详细实现方案。

#### 8.4.1 侵入点 1：Agent 模式 — 文件入库索引（通路 A）

> **数据来源说明**：本侵入点属于**通路 A（用户上传文件 → 对话级索引）**。用户发给 Agent 的文件索引到 `accountId:agent` 命名空间，仅影响该用户在当前 Agent 中的私有上下文，**不写入企业级全局知识库**。

**位置**：`src/agent/handler.ts`，`processAgentMessage()` 函数，约第 330–428 行（媒体文件处理块）。

**原始流程**：

```text
收到消息
  └─ msgType 是 image/voice/video/file？
      ├─ downloadMedia(mediaId)
      ├─ 保存到本地
      ├─ 构建 attachments
      └─ 继续流程 → 最终调用 dispatchReplyWithBufferedBlockDispatcher
```

**需要增加的流程**：

```text
收到消息
  └─ msgType 是 image/voice/video/file？
      ├─ downloadMedia(mediaId)
      ├─ 保存到本地
      ├─ 构建 attachments
**    ├─ [NEW] 如果 knowledge 已配置 → 触发文件索引
**    │     判断：文件类型是否可索引（text/markdown/json/csv/pdf）
**    │     如果是：
**    │       读取文件内容
**    │       计算 chunk、embedding
**    │       写入 VectorStore（命名空间 agent.accountId:agent）
**    │     如果不是：跳过（不支持二进制文件索引）
**    │     异常处理：索引失败不影响主流程（try/catch，只打 log）
**    └─ 继续流程 → dispatchReplyWithBufferedBlockDispatcher
```

**侵入代码量**：约 +15 行（一个小型 check + index 调用块）。

```typescript
// 在 downloadMedia 成功后插入
// ◄ 通路 A：用户上传文件 → accountId:agent 对话级命名空间
try {
  const knowledgeCfg = resolveKnowledgeConfigForAgent(config, agent.accountId);
  if (knowledgeCfg?.enabled && looksText) {
    const content = await fs.readFile(savedPath, 'utf-8');
    // 获取 embedding + store 实例
    const namespace = `${agent.accountId}:agent`;
    const { embedding, store } = await getOrCreateStore(knowledgeCfg, namespace);
    // 索引文档
    await indexDocument(filePath, sourceId, embedding, store, chunkerConfig);
  }
} catch (e) {
  error?.(`[knowledge] file indexing failed: ${String(e)}`);
}
```

**依赖**：
- `indexDocument()` — 从 `src/knowledge/index.ts` 导出（内部从 `src/knowledge/indexer/scheduler.ts` 转发）
- `resolveKnowledgeConfigForAgent()` — 需要从 `src/knowledge/hooks.ts` 导出（当前已有 `extractKnowledgeConfig`）
- `getOrCreateStore()` — 从 `src/knowledge/index.ts` 导出

#### 8.4.2 侵入点 2：Bot 模式 — 消息触发索引（通路 A）

> **数据来源说明**：本侵入点同样属于**通路 A（用户上传文件 → 对话级索引）**。用户发给 Bot 的文件索引到 `accountId:bot` 命名空间，仅为当前对话提供上下文，**不沉淀为企业知识**。

**位置**：`src/monitor.ts`，`startAgentForStream()` 函数，约第 1262 行（`processInboundMessage` 调用后）。

**原始流程**：

```text
startAgentForStream
  ├─ processInboundMessage(target, msg) → { body, media }
  ├─ ...（路由、鉴权、构建 ctxPayload）
  └─ dispatchReplyWithBufferedBlockDispatcher({ ctx, cfg, ... })
```

**需要增加的流程**：

```text
startAgentForStream
  ├─ processInboundMessage(target, msg) → { body, media }
**├─ [NEW] 如果 knowledge 已配置且本次消息有媒体文件
**│     判断：文件类型是否可索引
**│     如果是 → indexDocument(...)
  ├─ ...（路由、鉴权、构建 ctxPayload）
  └─ dispatchReplyWithBufferedBlockDispatcher({ ctx, cfg, ... })
```

**注意**：Bot 模式的媒体处理与 Agent 模式不同：
- Bot 模式通过 `processInboundMessage()` 处理媒体文件
- 企微 Bot 回调中收到的文件/图片是**加密的 media URL**，需要解密后下载
- 解密逻辑在 `src/media.ts` 中
- 索引逻辑需要在**解密下载完成之后**插入

**侵入代码量**：约 +20 行（比 Agent 多一个 `processInboundMessage` 返回值检查）。

```typescript
// 在 processInboundMessage 返回后插入
const { body, media } = processInboundMessage(target, msg);

// [NEW] 知识库索引
if (media && knowledgeConfig?.enabled) {
  try {
    const indexableTypes = ['text', 'markdown', 'json', 'csv', 'pdf'];
    const fileExt = getFileExtension(media.filename);
    if (indexableTypes.includes(fileExt)) {
      const content = await readFileContent(media.localPath);
      // 获取 embedding + store 实例
      const namespace = `${accountId}:bot`;
      const { embedding, store } = await getOrCreateStore(knowledgeConfig, namespace);
      // 索引文档（先写本地临时文件，再调用 indexDocument）
      await indexDocument(media.localPath, media.mediaId, embedding, store);
      logger.info('[KNOWLEDGE] Bot 模式索引成功: ' + media.filename);
    }
  } catch (e) {
    logger.error('[KNOWLEDGE] Bot 模式索引失败: ' + String(e));
  }
}
```

#### 8.4.3 侵入点 3：hooks.ts 配置读取 — 对接 OpenClaw 运行时

**位置**：`src/knowledge/hooks.ts`，`handleBeforePromptBuild()` 和 `resolveConfigForAccount()`。

**实现方案**：闭包捕获配置引用

代码实际通过 **闭包捕获** 而非 `(ctx as any).config` 获取配置：

```typescript
export function registerKnowledgeHooks(api: OpenClawPluginApi): void {
  // 在 register() 阶段通过闭包捕获配置
  const wecomConfig = api.config?.channels?.wecom;

  api.on('before_prompt_build', (event, ctx) => {
    return handleBeforePromptBuild(ctx, wecomConfig);
  });
}
```

`handleBeforePromptBuild()` 使用闭包捕获的 `wecomConfig` 参数：

```typescript
async function handleBeforePromptBuild(
  ctx: BeforePromptBuildContext,
  wecomConfig: any,
): Promise<BeforePromptBuildResult | undefined> {
  if (ctx.channelId !== 'wecom') return;
  if (!ctx.message) return;

  const accountId = ctx.accountId ?? 'default';
  const mode = ctx.agentId ? 'agent' : 'bot';
  const namespace = `${accountId}:${mode}`;

  const config = resolveConfigForAccount(wecomConfig, accountId);
  if (!config?.enabled) return;
  // ... 创建 store → 检索 → 注入 ...
}
```

**`resolveConfigForAccount()` 实现**：

```typescript
function resolveConfigForAccount(
  wecomConfig: any,
  accountId: string,
): KnowledgeConfig | null {
  if (!wecomConfig) return null;

  const global = wecomConfig.knowledge as KnowledgeConfig | undefined;
  if (!global?.enabled) return null;

  const accounts = wecomConfig.accounts as Record<string, any> | undefined;
  const accountOverride = accounts?.[accountId]?.knowledge;
  return deepMergeKnowledgeConfig(global, accountOverride);
}
```

**关键要点**：
1. 配置路径 `channels.wecom.knowledge` — 通过 `api.config?.channels?.wecom` 在注册时捕获
2. 不需要在 hook 事件中实时读取配置——闭包持有引用
3. 通过 `ctx.accountId` 区分 account（OpenClaw 路由绑定传入）
4. 通过 `ctx.agentId` 判断模式：有 agentId → mode=agent，否则 mode=bot
5. 命名空间 `{accountId}:{mode}` 确保 Bot/Agent 数据隔离

#### 8.4.4 侵入总结表

| # | 文件 | 侵入类型 | 代码量 | 风险 | 数据通路 |
|---|------|---------|--------|------|----------|
| 1 | `src/agent/handler.ts` | +1 个 if 块（文件下载后索引） | ~15 行 | 低 — 纯加法，try/catch 包裹 | 通路 A |
| 2 | `src/monitor.ts` | +1 个 if 块（消息处理后索引） | ~20 行 | 低 — 纯加法，try/catch 包裹 | 通路 A |
| 3 | `src/knowledge/hooks.ts` | 重写 `resolveConfigForAccount` | ~30 行 | **中** — 依赖 OpenClaw Plugin SDK 的运行时 API | 通路 A + 通路 B 共用 |
| 4 | `src/knowledge/indexer/scheduler.ts` | 新增定时调度 + 渠道文档 API 调用 | ~60 行 | **中** — 依赖企微 MCP 权限和配置 | **通路 B** |
| **合计** | **4 个文件** | | **~125 行** | | |

#### 8.4.5 通路 B：渠道文档拉取 → 企业级知识库（新增侵入点 4）

> **数据来源说明**：本侵入点属于**通路 B（渠道文档拉取 → 企业级知识库）**。由管理员指定 `accountId` 的授权账户，通过渠道文档 API 主动拉取，索引到该 `accountId` 的全局知识空间。这是平台层面操作，不依赖用户上传，而是依赖管理员对 `accountId` 的授权。

**位置**：`src/knowledge/indexer/scheduler.ts`，新增定时调度任务。

**流程**：

```text
定时调度触发
  └─ [NEW] 如果知识库已启用 且 store.sources 配置了 documentLibrary
       ├─ 获取渠道文档 API 凭据（基于 accountId 的 AccessToken）
       ├─ 调用 wecom_mcp.call doc get_doc_content { docId, folderId }
       ├─ 获取文档内容（Markdown/HTML）
       ├─ 计算 chunk、embedding
       ├─ 写入 VectorStore（命名空间 accountId:enterprise）
       ├─ 记录同步状态（lastSyncTime / etag，避免重复拉取）
       └─ 异常处理：同步失败不影响其他 account 的索引（try/catch）
```

**所需企微 API 权限**：

| API | 用途 | 所需 MCP Skill |
|-----|------|-----------------|
| `doc/get_doc_content` | 获取文档内容 | `wecom-doc` |
| `doc/list_by_folder` | 获取文件夹下文档列表 | `wecom-doc` / `wecom-doc-manager` |

**配置示例**：

```json
{
  "channels": {
    "wecom": {
      "knowledge": {
        "enabled": true,
        "store": {
          "sources": {
            "documentLibrary": {
              "enabled": true,
              "folderId": "FOLDER_ID_XXX",
              "syncInterval": 3600
            }
          }
        }
      }
    }
  }
}
```

**关键约束**：
1. 配置文件必须显式指定 `folderId`/`docId`，不能对所有文档库做全量扫描
2. 写入 `namespace = accountId:enterprise`，与通路 A 的 `accountId:bot/agent` 严格隔离
3. 需要管理员对目标 `accountId` 进行授权——企微 MCP 的 AccessToken 需具有对应文档库的读取权限

**关键技术风险**：侵入点 3（配置读取）依赖 OpenClaw Plugin SDK 是否暴露了配置 API。如果 `api.config.get?.()` 不存在，需要：
1. 在 `registerKnowledgeHooks()` 时主动读取一次完整配置（文件系统），缓存引用
2. 或要求 OpenClaw 核心暴露该 API

#### 8.4.6 验证步骤

1. **先验证侵入点 3** 可行——在 has Node env 的机器上确认 `api.config` 是否存在
2. **再实现侵入点 1、2**——文件索引（通路 A）
3. **再实现侵入点 4**——渠道文档拉取（通路 B）
4. **全流程测试**：发文件 → 通路 A 索引 → 问问题 → 命中对话级 RAG
5. **全流程测试**：配置通路 B → 触发定时同步 → 问问题 → 命中企业级 RAG
| 7. **验证隔离性**：通路 A 的数据不会出现在通路 B 的检索结果中，反之亦然
| 8. **验证 Bot 和 Agent** 两种模式各自的工作流

## 9. 注册本地 Tool：4 个分立知识库 Tool

### 9.1 AnyAgentTool 接口

OpenClaw 的 `AnyAgentTool` 接口定义了 Tool 的基本结构：

```typescript
interface AnyAgentTool {
  name: string;                    // Tool 名称（唯一标识）
  label?: string;                  // 显示名称
  description: string;             // 功能描述（LLM 理解用）
  parameters: {                    // Tool 入参 JSON Schema
    type: 'object';
    properties: Record<string, object>;
    required?: string[];
  };
  execute(toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>>;
}
```

### 9.2 工厂函数模式

每个知识库 Tool 采用**工厂函数模式**，接收 `OpenClawPluginToolContext` 返回 `AnyAgentTool`：

```typescript
// src/knowledge/tools/knowledge-add.ts
export function createKnowledgeAddTool(ctx: OpenClawPluginToolContext) {
  // ctx 包含当前会话的上下文
  // ctx.senderIsOwner  — 发送者是否为插件 owner
  // ctx.agentAccountId  — 当前 Agent 账户 ID
  // ctx.agentId         — 当前 Agent ID（有值=agent 模式，无值=bot 模式）
  // ctx.runtimeConfig   — 运行时配置（含 knowledge 配置）
  //
  // 闭包中持有 ctx，每次 execute 调用均可访问

  return {
    name: 'knowledge_add',
    label: '知识库存储',
    description: '将内容写入知识库。支持三种写入模式：store_text（存入文字）、store_file（存入文件）、store_summary（存入对话总结）。',
    parameters: { /* schema: { action, content?, filePath?, topic?, text? } */ },
    async execute(_toolCallId: string, params: unknown) {
      const isOwner = ctx.senderIsOwner;
      // ... 根据 action 分发
    },
  };
}
```

另外三个工厂函数模式相同，仅工具名、description、parameters 和 execute 内部逻辑不同：

| 文件 | 工厂函数 | 工具名 | 描述 |
|------|----------|--------|------|
| `knowledge-add.ts` | `createKnowledgeAddTool` | `knowledge_add` | 写入（store_text / store_file / store_summary） |
| `knowledge-query.ts` | `createKnowledgeQueryTool` | `knowledge_query` | 检索（vector / keyword / hybrid） |
| `knowledge-update.ts` | `createKnowledgeUpdateTool` | `knowledge_update` | 更新（按 sourceId 替换） |
| `knowledge-delete.ts` | `createKnowledgeDeleteTool` | `knowledge_delete` | 删除（delete_by_source / clear） |

**在 `index.ts` 中集中注册**：

```typescript
import {
  createKnowledgeAddTool,
  createKnowledgeQueryTool,
  createKnowledgeUpdateTool,
  createKnowledgeDeleteTool,
} from "./src/knowledge/tools/index.js";

api.registerTool(createKnowledgeAddTool,    { name: "knowledge_add" });
api.registerTool(createKnowledgeQueryTool,  { name: "knowledge_query" });
api.registerTool(createKnowledgeUpdateTool, { name: "knowledge_update" });
api.registerTool(createKnowledgeDeleteTool, { name: "knowledge_delete" });
```

> OpenClaw 在每次 Agent 会话构建时，依次调用已注册的 Tool 工厂函数。因此每次工厂函数被调用时，`ctx` 都绑定到当前会话上下文。

### 9.3 工具详解

#### 9.3.1 knowledge_add — 写入

```typescript
async function handleStoreText(
  content: string,   // 要存入的文字
  namespace: string, // 命名空间
  sourceId: string,  // 来源标识
  ctx: OpenClawPluginToolContext,
): Promise<AgentToolResult<unknown>> {
  const config = buildBaseConfig(ctx);          // 从 runtimeConfig 读取 knowledge 配置
  const { store, embedding } = await getOrCreateStore(config, namespace);
  const chunks = chunkText(content, sourceId);  // 切分
  const vectors = await embedding.embedBatch(texts); // 嵌入
  await store.deleteBySource(sourceId);          // 去重
  await store.upsert(vectorChunks);              // 写入
}
```

**支持 action**：

| Action | 参数 | 逻辑 | 元数据 |
|--------|------|------|--------|
| `store_text` | `content` | 切分 → 嵌入 → upsert，先 `deleteBySource` 去重 | `source: 'wecom_knowledge'` |
| `store_file` | `filePath` | 校验文件存在 + 扩展名（`.md/.txt/.csv/.json`），走 `indexDocument` | 同上 |
| `store_summary` | `topic`, `text` | 组合 `topic+text` → 切分 → 嵌入 → upsert | 同上 + `type: 'summary'`, `topic` |

#### 9.3.2 knowledge_query — 检索

```typescript
async function handleQuery(
  query: string,      // 查询文本
  strategy: string,   // 检索策略：vector | keyword | hybrid
  topK: number,       // 返回条数（默认 5）
  namespace: string,
  ctx: OpenClawPluginToolContext,
): Promise<AgentToolResult<unknown>> {
  const config = buildBaseConfig(ctx);
  const { store, embedding } = await getOrCreateStore(config, namespace);
  const queryVec = await embedding.embed(query);
  const results = await store.hybridSearch(query, topK, filters);
  return { success: true, results };
}
```

| 参数 | 类型 | 必需 | 默认 | 说明 |
|------|------|------|------|------|
| `query` | string | 是 | — | 查询文本 |
| `strategy` | string | 否 | `"hybrid"` | 检索策略：`vector` / `keyword` / `hybrid` |
| `topK` | number | 否 | `5` | 返回 topK 结果 |
| `filters` | object | 否 | — | 可选过滤条件 |

#### 9.3.3 knowledge_update — 更新

```typescript
async function handleUpdate(
  sourceId: string,   // 要更新的来源标识
  content: string,    // 新内容
  namespace: string,
  ctx: OpenClawPluginToolContext,
): Promise<AgentToolResult<unknown>> {
  const config = buildBaseConfig(ctx);
  const { store, embedding } = await getOrCreateStore(config, namespace);
  await store.deleteBySource(sourceId);          // 删除旧数据
  const chunks = chunkText(content, sourceId);   // 重新切分
  const vectors = await embedding.embedBatch(texts); // 重新嵌入
  await store.upsert(vectorChunks);              // 重新写入
}
```

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `sourceId` | string | 是 | 要更新的来源标识 |
| `content` | string | 是 | 更新后的内容 |

#### 9.3.4 knowledge_delete — 删除

```typescript
async function handleDeleteBySource(
  sourceId: string,
  namespace: string,
  ctx: OpenClawPluginToolContext,
): Promise<AgentToolResult<unknown>> {
  const { store } = await getOrCreateStore(config, namespace);
  await store.deleteBySource(sourceId);
  return { success: true, message: `已删除 sourceId=${sourceId} 的数据` };
}
```

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `action` | string | 是 | `delete_by_source`（按来源删除）或 `clear`（清空命名空间） |
| `sourceId` | string | 仅 `delete_by_source` | 要删除的来源标识 |

> **安全机制**：`clear` 操作要求 AI 先向用户发送确认消息（`clear 将清空当前命名空间的所有知识库数据，请确认是否继续？`），用户确认后再执行。防止误清除操作。

### 9.4 权限控制

四个 Tool 的 `ownerOnly` 均为 `false`，权限在各自 `execute` 内部通过 `ctx.senderIsOwner` 判断：

| namespace 类型 | 非 owner | owner | 说明 |
|---------------|---------|-------|------|
| 对话级（`{accountId}:{mode}`） | ✅ 允许 | ✅ 允许 | 默认 namespace |
| 非对话级（`enterprise`/`global`） | ❌ 拒绝 | ✅ 允许 | 需显式指定 namespace 参数 |
| `knowledge_add` 的 `store_summary` | ✅ 仅对话级 | ✅ 仅对话级 | 硬限制，防止总结误写入全局空间 |

**代码中的权限校验逻辑**（以 `knowledge-add.ts` 为例）：

```typescript
// 非对话级 namespace 需 owner
if (!isSessionNamespace(namespace) && !ctx.senderIsOwner) {
  return failedResult('只有 owner 才能写入非对话级 namespace');
}

// store_summary 强制对话级 namespace
if (p.action === 'store_summary' && !isSessionNamespace(namespace)) {
  return failedResult('store_summary 只支持写入对话级 namespace');
}
```

### 9.5 设计准则

1. **单职责**：每个 Tool 只做一件事（写入/查询/更新/删除），避免 action 枚举膨胀
2. **描述精准**：description 简短聚焦，帮助 LLM 在 4 个工具中快速选择正确的一个
3. **命名统一**：`knowledge_*` 前缀，清晰表达归属 channel
4. **owner 保护**：操作类动作（add/update/delete）涉及非对话级 namespace 时检查 owner 身份
5. **安全兜底**：`clear` 操作要求 AI 先确认再执行，防止误删除

### 8.5 开发工作流

```bash
# 1. 打开新分支
git checkout -b feat/custom-vector-store

# 2. 实现 + 测试
# 写代码 -> 写测试 -> 跑测试

# 3. 类型检查
npx tsc --noEmit

# 4. 运行全部知识库测试
npx vitest --config vitest.config.ts src/knowledge/

# 5. 提交
git add -A
git commit -m "feat(knowledge): 添加 MemoryStore 支持"
```

---

**文档版本**：1.0.0
**最后更新**：2026-04-24
**维护者**：PartMe.AI
