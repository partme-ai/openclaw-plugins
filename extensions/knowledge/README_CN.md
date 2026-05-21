# @partme.ai/openclaw-knowledge

> OpenClaw Knowledge Base RAG Engine —— 独立的 Embedding、向量存储、混合检索、多类型分块、自动上下文注入插件。

[![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--knowledge-blue)](https://www.npmjs.com/package/@partme.ai/openclaw-knowledge)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

[简体中文](./README_CN.md) | [English](./README.en.md)

---

## 概述

`@partme.ai/openclaw-knowledge` 是一个基于流水线架构的 RAG（检索增强生成）引擎，为 OpenClaw 提供可插拔的 Embedding、向量存储、混合检索、多类型文本切片、重排序，以及通过 `before_prompt_build` 钩子实现的自动上下文注入。

可与任意 OpenClaw 渠道插件（企微、飞书、钉钉、QQ 机器人、微信）集成，仅需约 **10 行胶水代码**。每个流水线节点都是 **可选的**（通过配置决定）且 **故障安全**（节点失败不影响整体流水线）。

## 特性

- **5 种 Embedding 提供者** — OpenAI / DashScope（阿里通义）/ 智谱AI / 百度千帆 / Ollama
- **3 种向量后端** — `sqlite-vec`（生产推荐） / `zvec`（零依赖） / `native-zvec`
- **混合检索** — 向量相似度 + FTS5 关键词搜索，权重可调（默认 0.7:0.3）
- **智能分块** — 基于段落/句子边界的智能分割，支持重叠配置
- **3 种重排序器** — Jina / 智谱AI / Ollama
- **2 种分词器** — `tiktoken` / 智谱AI
- **文档解析** — Ollama / 智谱AI 解析非文本文件
- **意图门控** — `rule` 模式（<1ms 关键词决策）/ `strict` 严格模式实现精确门控
- **CRUD 工具** — `knowledge_add` / `knowledge_query` / `knowledge_update` / `knowledge_delete`
- **配置层级** — 全局配置 + 按 account 覆盖（浅合并，任意字段覆盖）
- **自动上下文注入** — 通过 `before_prompt_build` 钩子自动注入 RAG 上下文
- **内容审核** — 可选的过滤配置，可自定义驳回消息

## 架构

```
用户输入
    │
    ▼
意图门控 (rule/strict) ─── 非检索意图 → 跳过 RAG
    │
    ▼ (检索意图)
Embedding ─── Tokenizer ─── Chunker
    │
    ▼
VectorStore ─── HybridRetriever ───►──── Reranker (可选)
    │                                       jina/zhipu/ollama
    ▼
before_prompt_build 钩子
    │
    ▼ (上下文注入)
注入 → AI 响应
```

**流水线特点：**
- 每个节点都是 **可选的** — 根据需要配置所需功能
- 每个节点都是 **故障安全的** — 单个节点失败不影响整体流水线
- 节点在运行时根据配置动态解析，而非编译时决定

## 快速开始

### 安装

```bash
npm install @partme.ai/openclaw-knowledge
# 或
pnpm add @partme.ai/openclaw-knowledge
```

### 集成到渠道插件

```typescript
import {
  registerKnowledgeHooks,
  createKnowledgeAddTool,
  createKnowledgeQueryTool,
  createKnowledgeUpdateTool,
  createKnowledgeDeleteTool,
} from '@partme.ai/openclaw-knowledge';

export function onRegister(api: PluginApi) {
  registerKnowledgeHooks(api, 'channels.wecom.knowledge');
  api.registerTool(createKnowledgeAddTool);
  api.registerTool(createKnowledgeQueryTool);
  api.registerTool(createKnowledgeUpdateTool);
  api.registerTool(createKnowledgeDeleteTool);
}
```

### 最小配置

```json
{
  "channels": {
    "wecom": {
      "knowledge": {
        "enabled": true,
        "embedding": { "model": "text-embedding-3-small" },
        "store": { "provider": "zvec" }
      }
    }
  }
}
```

## 配置参考

### 全局配置

```jsonc
{
  "channels": {
    "wecom": {
      "knowledge": {
        "enabled": true,                     // 启用知识库
        "intentGate": {
          "mode": "rule",                    // "rule" | "strict"
          "triggers": ["什么", "如何", "?"],  // 自定义触发词（可选）
          "skips": ["闲聊", "你好"]           // 自定义跳过词（可选）
        },
        "embedding": {
          "provider": "openai",              // "openai" | "dashscope" | "zhipu" | "qianfan" | "ollama"
          "model": "text-embedding-ada-002",
          "dimensions": 1536,
          "baseUrl": "",                     // 可选：自定义 API 端点
          "apiKey": ""                       // 可选：自定义 API 密钥
        },
        "tokenizer": {
          "provider": "tiktoken",            // "tiktoken" | "zhipu"
          "model": "o200k_base"
        },
        "store": {
          "provider": "sqlite-vec",          // "sqlite-vec" | "zvec" | "native-zvec"
          "dbPath": "./data/knowledge.db"
        },
        "retrieval": {
          "strategy": "hybrid",              // "hybrid" | "vector" | "keyword"
          "topK": 5,
          "minScore": 0.3,
          "keywordBoost": true
        },
        "reranker": {
          "provider": "",                    // "jina" | "zhipu" | "ollama" | "" (禁用)
          "model": "",
          "topN": 5
        },
        "parser": {
          "provider": "zhipu",               // "zhipu" | "ollama" | "" (禁用)
          "model": ""
        },
        "injection": {
          "position": "system",              // "system" | "user"
          "template": "相关知识库内容：\n\n{context}",
          "maxChunks": 5,
          "maxTokens": 2048
        },
        "moderation": {
          "enabled": false,
          "rejectionMessage": "抱歉，我无法回答这个问题。"
        }
      }
    }
  }
}
```

### 按 account 覆盖

```jsonc
{
  "channels": {
    "wecom": {
      "accounts": {
        "account_001": {
          "knowledge": {
            "retrieval": { "topK": 10 },      // 覆盖：对该账号使用 topK=10
            "store": { "sources": { "docIds": ["doc_001"] } }  // 完全替换 store.sources
          }
        }
      }
    }
  }
}
```

### 流水线节点速查

| 节点 | 默认启用 | 故障安全 | 可用的 Provider |
|-------|-------------------|-----------|-------------------|
| Embedding | 是 | 是 | openai / dashscope / zhipu / qianfan / ollama |
| Tokenizer | 是 | 是 | tiktoken / zhipu |
| Chunker | 是 | 是 | 内置（3 种策略） |
| VectorStore | 是 | 是 | sqlite-vec / zvec / native-zvec |
| HybridRetriever | 是 | 是 | 内置（可配置权重） |
| Reranker | 否 | 是 | jina / zhipu / ollama |
| Parser | 否 | 是 | ollama / zhipu |
| IntentGate | 是 | 是 | rule / strict |

## 支持的文件类型

可通过 `knowledge_add` 工具或 `indexFile()` API 索引文件：

| 扩展名 | 描述 |
|-----------|-------------|
| `.md` | Markdown 文档 |
| `.txt` | 纯文本文件 |
| `.csv` | 表格数据 |
| `.json` | JSON 数据 |
| `.text` | 文本文件（别名） |

## CRUD 工具

| 工具名称 | 函数 | 描述 |
|-----------|----------|-------------|
| `knowledge_add` | 添加文档 | 索引文件到知识库 |
| `knowledge_query` | 搜索 | 按语义相似度查询知识库 |
| `knowledge_update` | 更新 | 更新已索引的文档 |
| `knowledge_delete` | 删除 | 从知识库中移除文档 |

## 命名空间策略

知识数据按命名空间隔离，格式为 `{accountId}:{mode}`（mode 为 `bot` 或 `agent`）。这确保了不同账号和 Agent 模式之间的数据分离。

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 运行测试（107+ 个测试用例）
pnpm test

# 监听模式
pnpm dev

# 类型检查
pnpm typecheck
```

## 技术细节

- **动态导入**：重依赖（`better-sqlite3`、`@zvec/zvec`）使用动态导入，当使用其他后端时不会阻止加载。
- **Store 缓存**：VectorStore + EmbeddingService 对按命名空间缓存在 `Map<string, {store, embedding}>` 中。可通过 `invalidateStoreCache(namespace?)` 强制重建。
- **Embedding 重载**：`EmbeddingEngine.embed()` 使用函数重载处理单文本和多文本。
- **配置层级**：字段级浅合并，`store.sources` 整体替换。

## 许可证

基于 [MIT License](LICENSE) 开源。

## 关于 openclaw-plugins

本项目是 [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) monorepo 的一员 — 由 **PartMe.AI 团队** 研发与二次开发的 OpenClaw 企业级插件集合，包含 30+ 独立插件，覆盖 IM 渠道、消息队列、AI 能力、基础设施四大领域。

每个插件独立发布到 npm（`@partme.ai` scope），可单独安装：

```bash
openclaw plugins install @partme.ai/openclaw-knowledge
```

**PartMe.AI** 专注于 AI 智能客服与企业级 AI Agent 基础设施，提供从企微/钉钉/飞书/QQ 渠道接入，到 RAG 知识库、多级记忆、监控运维的全栈解决方案。

> 联系我们：partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)
