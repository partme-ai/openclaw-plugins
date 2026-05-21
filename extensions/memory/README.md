# OpenClaw Memory

> Multi-Level Long-Term Memory System (L0 to L3) — conversation recording, memory extraction, scenario induction, user profiling, and automatic recall.

[![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--memory-blue)](https://www.npmjs.com/package/@partme.ai/openclaw-memory)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

[简体中文](./README.md) | [English](./README.en.md)

---

## Overview

`@partme.ai/openclaw-memory` provides multi-level long-term memory for OpenClaw agents. It implements the OpenClaw Memory Host SDK contract with `kind: "memory"` — the framework automatically handles memory recall, context injection, and flush timing. The plugin is responsible only for storage (L0 recording), extraction (L1 keyword memory), and search (via `MemorySearchManager`).

**Zero external dependencies** — data is stored in local JSONL files with pure keyword matching, no external databases or APIs needed.

## Architecture

```
Memory Level Architecture:

L0 — Conversation Recording: Auto-capture every conversation turn to local JSONL
L1 — Memory Extraction: Extract structured keyword memories from conversations
L2 — Scenario Induction: Summarize scenario blocks from L1 memories (via memory_search tool)
L3 — User Profiling: Generate/update user profiles (via memory_search tool)

Auto-Recall: Automatic memory injection into context before each conversation
```

### How It Works

1. **L0 Recording**: On each `agent_end` event, all conversation messages are appended to a daily JSONL file (`conversations/YYYY-MM-DD.jsonl`)
2. **L1 Extraction**: On every 5th `agent_end`, user messages are scanned for keywords. Messages with sufficient keywords are recorded as episodic memories (`records/YYYY-MM-DD.jsonl`)
3. **Auto-Recall**: The `MemorySearchManager.search()` method is called by the OpenClaw framework during `before_prompt_build` — relevant memories are automatically injected into the conversation context
4. **Manual Search**: Agents can explicitly search memories via the `memory_search` tool

## Features

- **L0 Conversation Logging** — Auto-capture every conversation turn to local JSONL files
- **L1 Keyword Extraction** — Extract structured keyword memories with semantic tagging
- **Automatic Recall** — Framework-invoked `MemorySearchManager.search()` auto-injects relevant memories
- **Keyword Search** — Pure keyword matching with scoring (zero external API calls)
- **30-File Window Scan** — Searches the most recent 30 record files for relevant memories
- **`memory_search` Tool** — Agent can actively search for user memories during conversation
- **Retention Management** — Configurable retention period (default 90 days)
- **Fully Local** — No external dependencies, no API keys, no vector databases
- **Configurable** — Data directory, search limits, retention days all configurable

## Quick Start

### Installation

```bash
openclaw plugins install @partme.ai/openclaw-memory
```

### Minimal Configuration

```json
{
  "plugins": {
    "entries": {
      "memory": {
        "enabled": true,
        "config": {
          "dataDir": "~/.openclaw/state/memory"
        }
      }
    }
  }
}
```

## Configuration Reference

```jsonc
{
  "plugins": {
    "entries": {
      "memory": {
        "enabled": true,
        "config": {
          "dataDir": "~/.openclaw/state/memory",   // Data storage directory
          "maxSearchResults": 10,                   // Max results per search (default: 10)
          "retentionDays": 90                       // Data retention period (default: 90 days)
        }
      }
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the memory plugin |
| `dataDir` | string | `~/.openclaw/state/memory` | Data storage directory |
| `maxSearchResults` | number | `10` | Maximum results returned per search |
| `retentionDays` | number | `90` | Data retention period in days (not auto-deleted, used for reference) |

## Memory Search Tool

Agents can use the `memory_search` tool to actively search user memories during conversation:

```json
{
  "name": "memory_search",
  "label": "Memory Search",
  "description": "Search user's long-term memories.",
  "parameters": {
    "query": "Search query string",
    "limit": "Max results (default 10, max 20)"
  }
}
```

## Data Storage

### Directory Structure

```
{dataDir}/
├── conversations/        # L0 conversation logs (daily JSONL files)
│   └── 2026-05-22.jsonl
└── records/              # L1 extracted memories (daily JSONL files)
    └── 2026-05-22.jsonl
```

### Conversation Record Format (L0)

```json
{
  "id": "1747891234567_a1b2c3d4",
  "role": "user",
  "content": "What is the refund policy?",
  "timestamp": 1747891234567,
  "sessionKey": "session_abc123"
}
```

### Memory Record Format (L1)

```json
{
  "id": "1747891234567_e5f6g7h8",
  "content": "User mentioned: refund, policy, return. What is the refund policy?",
  "type": "episodic",
  "sessionKey": "session_abc123",
  "createdAt": "2026-05-22T10:00:00.000Z"
}
```

## Scoping and Limitations

- **Storage**: Local JSONL files only. Not suitable for distributed/clustered deployments.
- **Search**: Pure keyword matching with Chinese bigram tokenization. No semantic/vector search.
- **Performance**: Scans the most recent 30 record files. Performance depends on file sizes.
- **Extraction frequency**: Memories are extracted every 5th conversation turn by default (configurable via `shouldExtract()`).
- **Memory Host SDK**: Implements the standard `MemorySearchManager` interface — the framework handles injection timing.

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Watch mode
pnpm dev

# Type check
pnpm typecheck
```

## License

Licensed under the [MIT License](LICENSE).

## About openclaw-plugins

This plugin is part of [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) — an enterprise OpenClaw plugin collection developed and maintained by the **PartMe.AI team**, featuring 30+ plugins across IM channels, message queues, AI capabilities, and infrastructure.

Each plugin is published independently on npm under the `@partme.ai` scope:

```bash
openclaw plugins install @partme.ai/openclaw-memory
```

**PartMe.AI** specializes in AI customer service and enterprise AI agent infrastructure, providing end-to-end solutions from WeChat Work/DingTalk/Feishu/QQ channel integration to RAG knowledge bases, multi-layer memory, and production monitoring.

> Contact: partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)
