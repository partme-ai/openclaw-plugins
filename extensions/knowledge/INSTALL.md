# @partme.ai/openclaw-knowledge 安装与配置指南

> Knowledge Base RAG 插件 — 为 OpenClaw 渠道插件注入文档索引、向量检索、混合搜索能力。支持作为独立库集成（10 行胶水代码）或作为 OpenClaw 插件加载。

---

## 目录

- [安装方式](#安装方式)
- [配置说明](#配置说明)
- [渠道插件集成](#渠道插件集成)
  - [wecom 集成示例](#wecom-集成示例)
  - [lark 集成示例](#lark-集成示例)
- [连接配置](#连接配置)
- [验证安装](#验证安装)
- [生产部署](#生产部署)

---

## 安装方式

### 方式一：作为 OpenClaw 插件加载（推荐）

```bash
npm install @partme.ai/openclaw-knowledge
```

在 `openclaw.json` 的 `plugins.entries` 中添加：

```json
{
  "plugins": {
    "entries": [
      "@partme.ai/openclaw-knowledge"
    ]
  }
}
```

插件通过 `openclaw.plugin.json` 自动注册，无需额外代码。

### 方式二：作为 NPM 库集成到渠道插件

```bash
npm install @partme.ai/openclaw-knowledge
```

在渠道插件的 `index.ts` 中添加约 10 行胶水代码：

```typescript
import {
  registerKnowledgeHooks,
  createKnowledgeAddTool,
  createKnowledgeQueryTool,
  createKnowledgeUpdateTool,
  createKnowledgeDeleteTool,
} from '@partme.ai/openclaw-knowledge';

export function onRegister(api: PluginApi) {
  // 注册 before_prompt_build hook（RAG 自动检索）
  registerKnowledgeHooks(api, 'channels.wecom.knowledge');

  // 注册知识库 CRUD 工具
  api.registerTool(createKnowledgeAddTool);
  api.registerTool(createKnowledgeQueryTool);
  api.registerTool(createKnowledgeUpdateTool);
  api.registerTool(createKnowledgeDeleteTool);
}
```

---

## 配置说明

知识库配置支持**全局配置**和**按 account 覆盖**，配置层级如下：

```jsonc
{
  "channels": {
    "{channel}": {
      "knowledge": {           // ← 全局知识库配置
        "enabled": true,
        "embedding": {
          "provider": "openai",
          "model": "text-embedding-3-small",
          "dimensions": 1536
        },
        "store": {
          "provider": "sqlite-vec",    // sqlite-vec | zvec | zvec-native
          "dbPath": "./data/knowledge.db"
        },
        "retrieval": {
          "strategy": "hybrid",        // hybrid | vector | keyword
          "topK": 5,
          "minScore": 0.3,
          "hybridAlpha": 0.5
        },
        "tokenizer": {
          "provider": "tiktoken",
          "maxTokens": 8191
        },
        "chunker": {
          "chunkSize": 500,
          "chunkOverlap": 50
        },
        "injection": {
          "position": "system",
          "maxContextLength": 2000,
          "instruction": "Use the following knowledge base content to answer the user's question:"
        },
        "intentGate": {
          "mode": "rule"               // rule | strict
        }
      },
      "accounts": {
        "{accountId}": {
          "knowledge": {              // ← 按 account 覆盖（可选字段）
            "embedding": { "model": "text-embedding-3-large" },
            "store": { "dbPath": "/data/knowledge/acme.db" },
            "retrieval": { "topK": 10 }
          }
        }
      }
    }
  }
}
```

### 配置覆盖规则

- `channels.{channel}.knowledge.*` — 全局知识库配置
- `channels.{channel}.accounts.{id}.knowledge.*` — 按 account 覆盖（仅覆盖指定字段）
- 「启用/禁用」`enabled` 仅全局生效，account 级不覆盖

### 配置参数详解

| 路径 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 启用/禁用知识库 |
| `embedding.provider` | string | `openai` | `openai` / `dashscope` / `zhipu` / `qianfan` / `ollama` |
| `embedding.model` | string | `text-embedding-ada-002` | 嵌入模型名 |
| `embedding.dimensions` | number | `1536` | 向量维度 |
| `embedding.apiKey` | string | — | API Key（也可通过环境变量 `{PROVIDER}_API_KEY`） |
| `embedding.baseUrl` | string | — | 自定义 Base URL（ollama: `http://localhost:11434`） |
| `store.provider` | string | `sqlite-vec` | `sqlite-vec` / `zvec` / `zvec-native` |
| `store.dbPath` | string | `./data/knowledge.db` | 数据库文件路径 |
| `store.namespace` | string | `default` | 命名空间前缀 |
| `retrieval.strategy` | string | `hybrid` | `hybrid` 向量+关键词 / `vector` 纯向量 / `keyword` 纯关键词 |
| `retrieval.topK` | number | `5` | 最大返回条数 |
| `retrieval.minScore` | number | `0.3` | 最小相关度阈值 |
| `retrieval.hybridAlpha` | number | `0.5` | 混合检索比例（0=纯关键词，1=纯向量） |
| `tokenizer.provider` | string | `tiktoken` | `tiktoken` / `zhipu` |
| `chunker.chunkSize` | number | `500` | 每块 token 数 |
| `chunker.chunkOverlap` | number | `50` | 块重叠 token 数 |
| `injection.position` | string | `system` | `system` / `user` |
| `injection.maxContextLength` | number | `2000` | 注入内容最大字符数 |
| `intentGate.mode` | string | `rule` | `rule` 规则模式 / `strict` 严格模式 |

---

## 渠道插件集成

### wecom 集成示例

在 `openclaw-wecom` 的 `index.ts` 中：

```typescript
import { registerKnowledgeHooks, createKnowledgeAddTool,
  createKnowledgeQueryTool, createKnowledgeUpdateTool,
  createKnowledgeDeleteTool } from '@partme.ai/openclaw-knowledge';

export function onRegister(api: PluginApi) {
  // 知识库配置路径：channels.wecom.knowledge
  registerKnowledgeHooks(api, 'channels.wecom.knowledge');

  // 注册 4 个 CRUD 工具
  api.registerTool(createKnowledgeAddTool);
  api.registerTool(createKnowledgeQueryTool);
  api.registerTool(createKnowledgeUpdateTool);
  api.registerTool(createKnowledgeDeleteTool);
}
```

### lark 集成示例

在 `openclaw-lark` 的 `index.ts` 中：

```typescript
import { registerKnowledgeHooks, createKnowledgeAddTool,
  createKnowledgeQueryTool } from '@partme.ai/openclaw-knowledge';

export function onRegister(api: PluginApi) {
  // 知识库配置路径：channels.lark.knowledge
  registerKnowledgeHooks(api, 'channels.lark.knowledge');

  api.registerTool(createKnowledgeAddTool);
  api.registerTool(createKnowledgeQueryTool);
}
```

---

## 连接配置

### 可选组件配置

| 组件 | 配置方式 | 说明 |
|------|----------|------|
| **Reranker** | `channels.{channel}.knowledge.reranker.*` | 重排序（jina/zhipu/ollama） |
| **Parser** | `channels.{channel}.knowledge.parser.*` | 文档解析（ollama/zhipu） |
| **SQLite-Vec** | `channels.{channel}.knowledge.store.provider=sqlite-vec` | 需 `better-sqlite3`（自动安装） |
| **ZVec** | `channels.{channel}.knowledge.store.provider=zvec` | 零依赖，开箱即用 |
| **Ollama** | `channels.{channel}.knowledge.embedding.baseUrl=http://host:11434` | 本地推理 |

### Embedding Provider API Key

可通过环境变量配置，避免明文字段：

```bash
# OpenAI
OPENAI_API_KEY=sk-xxx

# DashScope (阿里)
DASHSCOPE_API_KEY=sk-xxx

# 智谱
ZHIPU_API_KEY=xxx

# 千帆 (百度)
QIANFAN_API_KEY=xxx
```

优先使用配置中的 `apiKey` 字段，其次读取环境变量。

---

## 验证安装

### 方式一：通过 CLI 检查

```bash
openclaw config get channels.wecom.knowledge.enabled
# → true

openclaw config get channels.wecom.knowledge.embedding
# → { "provider": "openai", "model": "text-embedding-3-small" }
```

### 方式二：通过 AI 对话验证

发送消息给已配置好的 AI 机器人：

```
> 请记住：我的数据库连接信息是 host=db.example.com port=5432

AI：已将该信息存入知识库。
```

```
> 之前存的数据库连接信息是什么？

AI：根据知识库，数据库连接信息是：host=db.example.com port=5432
```

### 方式三：直接调用工具

```bash
openclaw run knowledge:stats
# → Knowledge store stats: 15 chunks, 3 documents
```

---

## 生产部署

### 存储优化

```jsonc
{
  "channels": {
    "wecom": {
      "knowledge": {
        "store": {
          "dbPath": "/var/lib/openclaw/knowledge.db",
          "provider": "sqlite-vec"       // 生产推荐
        },
        "retrieval": {
          "topK": 10,
          "minScore": 0.4,
          "hybridAlpha": 0.6
        }
      }
    }
  }
}
```

### 数据目录与权限

```bash
mkdir -p /var/lib/openclaw/knowledge
chmod 750 /var/lib/openclaw

# 数据库自动创建在 dbPath 目录下
```

### 运维命令

```bash
# 查看知识库统计
openclaw run knowledge:stats

# 清除指定命名空间
openclaw run knowledge:clear --namespace acme:bot

# 删除指定源
openclaw run knowledge:delete --source-id media_abc123
```

### 配置分 account 隔离

```jsonc
{
  "channels": {
    "wecom": {
      "knowledge": {
        "enabled": true,
        "store": { "dbPath": "/var/lib/openclaw/knowledge.db" }
      },
      "accounts": {
        "acme_corp": {
          "knowledge": {
            "store": { "dbPath": "/var/lib/openclaw/knowledge-acme.db" },
            "retrieval": { "topK": 10 }
          }
        },
        "globex_inc": {
          "knowledge": {
            "store": { "dbPath": "/var/lib/openclaw/knowledge-globex.db" }
          }
        }
      }
    }
  }
}
```

---

## 架构说明

参考文档：

- [架构与策略文档](../../docs/knowledge/OpenClaw-Knowledge-RAG-Strategy_CN.md) — 三层能力模型、MCP 协同、实施路线图
- [开发指南](../../docs/knowledge/OpenClaw-Knowledge-RAG-Guide_CN.md) — 配置详解、API 参考、运维命令
