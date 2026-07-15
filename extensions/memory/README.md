# OpenClaw Memory

> Local layered memory (L0 to L3) with agent/session isolation, retention, optional encryption, and automatic recall.

[![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--memory-blue)](https://www.npmjs.com/package/@partme.ai/openclaw-memory)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

[简体中文](./README.zh-CN.md) | [English](./README.md)

---

## Overview

`@partme.ai/openclaw-memory` provides multi-level long-term memory for OpenClaw agents. It implements the OpenClaw Memory Host SDK contract with `kind: "memory"` — the framework automatically handles memory recall, context injection, and flush timing. The plugin is responsible only for storage (L0 recording), extraction (L1 keyword memory), and search (via `MemorySearchManager`).

**Zero external dependencies** — data is stored in local JSONL files with lexical matching. This plugin does not claim vector or semantic search.

## Architecture

```
Memory Level Architecture:

L0 — Conversation Recording: Idempotent current-turn capture by runId
L1 — Episodic Memory: User input plus searchable terms
L2 — Scenario Induction: Periodic deterministic session scenario records
L3 — User Profile: Explicit preferences, identity facts, and durable instructions

Auto-Recall: Automatic memory injection into context before each conversation
```

### How It Works

1. **L0 Recording**: Successful `agent_end` hooks persist only the current turn and deduplicate by `runId`.
2. **L1/L2/L3 Extraction**: Each user turn creates L1 episodic memory, periodic turns create L2 scenarios, and explicit durable facts create L3 profile records.
3. **Auto-Recall**: OpenClaw invokes `MemorySearchManager.search()`; all levels are session-filtered by default.
4. **Manual Search**: The tool factory uses trusted host `agentId` and `sessionKey`; tool arguments cannot switch tenants.

## Features

- **L0 Conversation Logging** — Auto-capture every conversation turn to local JSONL files
- **L1 Keyword Extraction** — Extract structured keyword memories with semantic tagging
- **Automatic Recall** — Framework-invoked `MemorySearchManager.search()` auto-injects relevant memories
- **Keyword Search** — Pure keyword matching with scoring (zero external API calls)
- **Bounded Time Window** — Scans at most 365 daily files within the configured retention period
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
| `retentionDays` | number | `90` | Retention period; cleanup runs at startup and daily |
| `extractionInterval` | number | `5` | Turns between L2 scenario records |
| `maxRecordBytes` | number | `65536` | Maximum L0 record size |
| `profileScope` | `session` \| `agent` | `session` | L3 recall scope; use `agent` only for a single-user agent |
| `encryptionKeyEnv` | string | unset | Environment variable containing the optional AES-256-GCM key |

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

- **Deployment**: Local JSONL targets a single node. Use an external memory backend for shared multi-node memory.
- **Search**: Lexical matching with Chinese bigrams; no semantic/vector search.
- **Isolation**: Data is physically partitioned by agent and all levels are session-filtered by default. Cross-session L3 requires explicit `profileScope: "agent"` opt-in.
- **Extraction**: L2/L3 use deterministic rules rather than an LLM.
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

This plugin is part of [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins), an enterprise OpenClaw plugin collection covering IM channels, message queues, AI capabilities, and infrastructure.

Each plugin is published independently on npm under the `@partme.ai` scope:

```bash
openclaw plugins install @partme.ai/openclaw-memory
```

**PartMe.AI** specializes in AI customer service and enterprise AI agent infrastructure, providing end-to-end solutions from WeChat Work/DingTalk/Feishu/QQ channel integration to RAG knowledge bases, multi-layer memory, and production monitoring.

> Contact: partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)
