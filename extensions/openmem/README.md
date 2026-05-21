# OpenClaw OpenMem

> OpenMem Local-First Memory Bridge for OpenClaw — HTTP bridge for hybrid recall via `/inspect/search` and event ingest via `/events/ingest`.

[![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--openmem-blue)](https://www.npmjs.com/package/@partme.ai/openclaw-openmem)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

[简体中文](./README.md) | [English](./README.en.md)

---

## Overview

`@partme.ai/openclaw-openmem` bridges OpenClaw agents to a local [OpenMem](https://github.com/partme-ai) memory server. It implements the OpenClaw Memory Host SDK with `kind: "memory"`, providing:

- **Recall**: `MemorySearchManager.search` delegates to `POST /inspect/search` in hybrid mode
- **Ingest**: On `agent_end`, conversation messages are sent to `POST /events/ingest`
- **Tool**: Agents can search OpenMem memories via the `openmem_search` tool

OpenMem is designed as a HTTP sidecar (default port **3317**) that runs alongside the OpenClaw gateway, providing a local-first, hybrid-search memory backend.

## Features

- **HTTP Sidecar Architecture** — OpenMem runs as a standalone server on port 3317
- **Hybrid Search Recall** — Memory search via `POST /inspect/search` (hybrid mode)
- **Agent-End Ingest** — Automatic memory ingestion on `agent_end` events
- **`openmem_search` Tool** — Agent can explicitly search externalized memories
- **Memory Host SDK Compliance** — Implements `MemorySearchManager` for automatic framework recall
- **Zero Internal Storage** — All memory data is managed by the OpenMem sidecar
- **Configurable** — `baseUrl` and `maxSearchResults` are configurable

## Quick Start

### 1. Start the OpenMem Sidecar

```bash
cd OpenMem
pnpm install
pnpm --filter @openmem/server dev
# Server starts on http://127.0.0.1:3317
```

Verify it's running:

```bash
curl -s http://127.0.0.1:3317/healthz
# → { "status": "ok" }
```

### 2. Install the Plugin

```bash
openclaw plugins install @partme.ai/openclaw-openmem
```

### 3. Configure

```json
{
  "plugins": {
    "entries": {
      "openmem": {
        "enabled": true,
        "config": {
          "baseUrl": "http://127.0.0.1:3317"
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
      "openmem": {
        "enabled": true,
        "config": {
          "baseUrl": "http://127.0.0.1:3317",   // OpenMem sidecar URL
          "maxSearchResults": 10                  // Max results per search (default: 10)
        }
      }
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the OpenMem plugin |
| `baseUrl` | string | `"http://127.0.0.1:3317"` | OpenMem sidecar base URL |
| `maxSearchResults` | number | `10` | Maximum results returned per search |

## Behavior

### Recall Flow

```
Agent needs memory
    │
    ▼
OpenClaw Framework calls MemorySearchManager.search(query)
    │
    ▼
Plugin sends POST /inspect/search with { query, mode: "hybrid", limit }
    │
    ▼
OpenMem sidecar performs hybrid search (vector + keyword)
    │
    ▼
Results returned as MemorySearchResult[] → injected into context
```

### Ingest Flow

```
Agent completes a conversation (agent_end event)
    │
    ▼
Plugin collects all messages from the event
    │
    ▼
Plugin sends POST /events/ingest with all messages
    │
    ▼
OpenMem sidecar stores messages as memory events
```

### Agent Tool

Agents can use the `openmem_search` tool during conversation:

```json
{
  "name": "openmem_search",
  "description": "Search externalized memories via OpenMem hybrid recall.",
  "parameters": {
    "query": "string (required)",
    "limit": "number (optional, default 10, max 20)"
  }
}
```

## Architecture

```
┌─────────────────────┐     HTTP      ┌──────────────────────┐
│  OpenClaw Gateway   │ ◄──────────► │  OpenMem Sidecar     │
│                     │              │  (Port 3317)         │
│  openclaw-openmem   │  /inspect/   │                      │
│  plugin             │  search      │  Hybrid Search       │
│                     │              │  Engine              │
│  MemorySearchManager│  /events/    │                      │
│  .search()          │  ingest      │  Event Store         │
│                     │              │                      │
│  agent_end → ingest │              │  Vector + Keyword    │
└─────────────────────┘              │  Index               │
                                      └──────────────────────┘
```

## MVP Verification Checklist

| # | Step | Command / Action |
|---|------|-----------------|
| 1 | Start OpenMem sidecar | `cd OpenMem && pnpm install && pnpm --filter @openmem/server dev` |
| 2 | Health check | `curl -s http://127.0.0.1:3317/healthz` → `{ "status": "ok" }` |
| 3 | End-to-end smoke test | `bash OpenMem/scripts/mvp-smoke.sh` |
| 4 | Install the plugin | `openclaw plugins install -l ./extensions/openmem` |
| 5 | Conversation then recall | Chat → agent_end ingest → new session uses `openmem_search` or auto-recall |

## Development

```bash
# Install dependencies
cd extensions/openmem
pnpm install

# Run tests
pnpm test

# Type check
pnpm typecheck
```

## License

Licensed under the [MIT License](LICENSE).

## About openclaw-plugins

This plugin is part of [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) — an enterprise OpenClaw plugin collection developed and maintained by the **PartMe.AI team**, featuring 30+ plugins across IM channels, message queues, AI capabilities, and infrastructure.

Each plugin is published independently on npm under the `@partme.ai` scope:

```bash
openclaw plugins install @partme.ai/openclaw-openmem
```

**PartMe.AI** specializes in AI customer service and enterprise AI agent infrastructure, providing end-to-end solutions from WeChat Work/DingTalk/Feishu/QQ channel integration to RAG knowledge bases, multi-layer memory, and production monitoring.

> Contact: partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)
