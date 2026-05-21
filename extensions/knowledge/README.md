# @partme.ai/openclaw-knowledge

> OpenClaw Knowledge Base RAG Engine — standalone plugin for embedding, vector store, hybrid retrieval, multi-type chunking, and automatic context injection.

[![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--knowledge-blue)](https://www.npmjs.com/package/@partme.ai/openclaw-knowledge)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

[简体中文](./README.md) | [English](./README.en.md)

---

## Overview

`@partme.ai/openclaw-knowledge` is a pipeline-based RAG (Retrieval-Augmented Generation) engine for OpenClaw. It provides pluggable embedding, vector storage, hybrid retrieval, multi-type chunking, reranking, and automatic context injection via the `before_prompt_build` hook.

Integrates with any OpenClaw channel plugin (wecom, lark, dingtalk, qqbot, weixin) in approximately 10 lines of glue code. Each pipeline stage is **optional** (configured by config) and **fail-safe** (node failure does not block the pipeline).

## Features

- **5 Embedding Providers** — OpenAI / DashScope / ZhipuAI / Baidu Qianfan / Ollama
- **3 Vector Backends** — `sqlite-vec` (production recommended) / `zvec` (zero-dependency) / `native-zvec`
- **Hybrid Retrieval** — Vector similarity + FTS5 keyword search with configurable weights (default 0.7:0.3)
- **Multi-Type Chunking** — Smart paragraph/sentence boundary-aware splitting with configurable overlap
- **3 Reranker Providers** — Jina / ZhipuAI / Ollama
- **2 Tokenizer Options** — `tiktoken` / ZhipuAI
- **Document Parser** — Ollama / ZhipuAI for non-text file parsing
- **Intent Gate** — `rule` mode (<1ms keyword decision) / `strict` mode for precise gating
- **CRUD Tools** — `knowledge_add` / `knowledge_query` / `knowledge_update` / `knowledge_delete`
- **Config Hierarchy** — Global config with per-account overrides (shallow merge, arbitrary field override)
- **Auto Context Injection** — Automatic RAG context injection via `before_prompt_build` hook
- **Moderation** — Optional content filtering with configurable rejection message

## Architecture

```
User Input
    │
    ▼
IntentGate (rule/strict) ─── non-retrieval intent → skip RAG
    │
    ▼ (retrieval intent)
Embedding ─── Tokenizer ─── Chunker
    │
    ▼
VectorStore ─── HybridRetriever ───►──── Reranker (optional)
    │                                        jina/zhipu/ollama
    ▼
before_prompt_build hook
    │
    ▼ (context injection)
Injection → AI Response
```

**Pipeline characteristics:**
- Each node is **optional** — configure what you need
- Each node is **fail-safe** — failure in one node does not block the pipeline
- Nodes are resolved at runtime based on configuration, not compile time

## Quick Start

### Installation

```bash
npm install @partme.ai/openclaw-knowledge
# or
pnpm add @partme.ai/openclaw-knowledge
```

### Integration into a Channel Plugin

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

### Minimal Configuration

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

## Configuration Reference

### Global Configuration

```jsonc
{
  "channels": {
    "wecom": {
      "knowledge": {
        "enabled": true,                     // Enable knowledge base
        "intentGate": {
          "mode": "rule",                    // "rule" | "strict"
          "triggers": ["什么", "如何", "?"],  // Custom trigger words (optional)
          "skips": ["闲聊", "你好"]           // Custom skip words (optional)
        },
        "embedding": {
          "provider": "openai",              // "openai" | "dashscope" | "zhipu" | "qianfan" | "ollama"
          "model": "text-embedding-ada-002",
          "dimensions": 1536,
          "baseUrl": "",                     // Optional: custom API endpoint
          "apiKey": ""                       // Optional: custom API key
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
          "provider": "",                    // "jina" | "zhipu" | "ollama" | "" (disabled)
          "model": "",
          "topN": 5
        },
        "parser": {
          "provider": "zhipu",               // "zhipu" | "ollama" | "" (disabled)
          "model": ""
        },
        "injection": {
          "position": "system",              // "system" | "user"
          "template": "Relevant knowledge:\n\n{context}",
          "maxChunks": 5,
          "maxTokens": 2048
        },
        "moderation": {
          "enabled": false,
          "rejectionMessage": "I can't answer that."
        }
      }
    }
  }
}
```

### Per-Account Override

```jsonc
{
  "channels": {
    "wecom": {
      "accounts": {
        "account_001": {
          "knowledge": {
            "retrieval": { "topK": 10 },      // Override: use topK=10 for this account
            "store": { "sources": { "docIds": ["doc_001"] } }  // Replace sources entirely
          }
        }
      }
    }
  }
}
```

### Pipeline Stage Summary

| Stage | Enabled by Default | Fail-Safe | Available Providers |
|-------|-------------------|-----------|-------------------|
| Embedding | Yes | Yes | openai / dashscope / zhipu / qianfan / ollama |
| Tokenizer | Yes | Yes | tiktoken / zhipu |
| Chunker | Yes | Yes | Built-in (3 strategies) |
| VectorStore | Yes | Yes | sqlite-vec / zvec / native-zvec |
| HybridRetriever | Yes | Yes | Built-in (configurable weights) |
| Reranker | No | Yes | jina / zhipu / ollama |
| Parser | No | Yes | ollama / zhipu |
| IntentGate | Yes | Yes | rule / strict |

## Supported File Types

Files can be indexed via the `knowledge_add` tool or the `indexFile()` API:

| Extension | Description |
|-----------|-------------|
| `.md` | Markdown documents |
| `.txt` | Plain text files |
| `.csv` | Tabular data |
| `.json` | JSON data |
| `.text` | Text files (alias) |

## CRUD Tools

| Tool Name | Function | Description |
|-----------|----------|-------------|
| `knowledge_add` | Add documents | Index file(s) into the knowledge base |
| `knowledge_query` | Search | Query the knowledge base by semantic similarity |
| `knowledge_update` | Update | Update existing indexed documents |
| `knowledge_delete` | Delete | Remove documents from the knowledge base |

## Namespace Strategy

Knowledge data is isolated per namespace in the format `{accountId}:{mode}` (where mode is `bot` or `agent`). This ensures data separation across different accounts and agent modes.

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests (107+ tests)
pnpm test

# Watch mode
pnpm dev

# Type checking
pnpm typecheck
```

## Technical Details

- **Dynamic imports**: Heavy dependencies (`better-sqlite3`, `@zvec/zvec`) are dynamically imported, so failures don't prevent loading when using other backends.
- **Store caching**: VectorStore + EmbeddingService pairs are cached in a `Map<string, {store, embedding}>` keyed by namespace. Use `invalidateStoreCache(namespace?)` to force recreation.
- **Embedding overloads**: `EmbeddingEngine.embed()` uses function overloads — single string returns `number[]`, string array returns `number[][]`.
- **Config hierarchy**: Field-level shallow merge with `store.sources` wholesale replacement.

## License

Licensed under the [MIT License](LICENSE).

## About openclaw-plugins

This plugin is part of [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) — an enterprise OpenClaw plugin collection developed and maintained by the **PartMe.AI team**, featuring 30+ plugins across IM channels, message queues, AI capabilities, and infrastructure.

Each plugin is published independently on npm under the `@partme.ai` scope:

```bash
openclaw plugins install @partme.ai/openclaw-knowledge
```

**PartMe.AI** specializes in AI customer service and enterprise AI agent infrastructure, providing end-to-end solutions from WeChat Work/DingTalk/Feishu/QQ channel integration to RAG knowledge bases, multi-layer memory, and production monitoring.

> Contact: partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)
