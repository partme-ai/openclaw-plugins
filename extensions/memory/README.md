# OpenClaw Memory

<!-- README_STANDARD_START -->

> Standard reading order: positioning → architecture → flow → boundaries → installation → configuration → operations → deep dive.
> This block favors text diagrams that render reliably on npm; when applicable, deeper Mermaid diagrams remain in the repository's `doc/` design material.

[English](./README.md) | [简体中文](./README.zh-CN.md)

## 1. Component positioning

Provides retainable, recallable, and deletable local memory. Component type: **Long-term memory capability**.

| Item | Value |
|---|---|
| npm package | `@partme.ai/openclaw-memory` |
| Version | `2026.7.1` |
| Plugin ID | `memory` |
| Channel ID | — |
| OpenClaw | `>=2026.7.1` |
| Source | `extensions/memory` |

## 2. At a glance

```text
[Conversation hooks and explicit memory operations]
          │
          ▼
┌──────────────────────────────────────────────────────────────┐
│ Inside OpenClaw Gateway: memory
│ 1. Capture and scope conversations
│ 2. Extract and persist L0-to-L3 memories
│ 3. Recall with bounds and inject into current context
└──────────────────────────────────────────────────────────────┘
          │
          ▼
[Long-term memory and profile context]
```

## 3. Architecture and core flow

The component keeps protocol and platform differences inside its own boundary and exposes stable plugin, channel, hook, tool, or service contracts to OpenClaw.

```text
Conversation hooks and explicit memory operations
  │
  ▼
Capture and scope conversations
  │
  ▼
Extract and persist L0-to-L3 memories
  │
  ▼
Recall with bounds and inject into current context
  │
  ▼
Long-term memory and profile context

Failure path: Any failed stage: record a diagnosable error, then retry, reject, or degrade per component policy
```

## 4. Capabilities and boundaries

| Area | Contract |
|---|---|
| Owns | Provides retainable, recallable, and deletable local memory |
| Does not own | Does not elevate historical memory above the current request |
| Input | Conversation hooks and explicit memory operations |
| Output | Long-term memory and profile context |
| Failure rule | Failures remain observable; authentication, boundary validation, and persistence failures must not be reported as success |

## 5. Quick start

```bash
openclaw plugins install "@partme.ai/openclaw-memory@2026.7.1"
```

Start with least-privilege configuration, then launch the Gateway. Validate connectivity, authorization, and recovery in an isolated profile before production use.

## 6. Configuration entry points

| Layer | Path |
|---|---|
| Plugin configuration | `plugins.entries.memory.config` |
| Channel configuration | Not applicable |
| Configuration schema | `extensions/memory/openclaw.plugin.json` |

Field definitions, environment variables, and complete examples remain in the preserved detailed reference below.

## 7. Operations, security, and troubleshooting

- Confirm the OpenClaw version, package version, manifest ID, and configuration key first.
- Keep credentials in environment variables or SecretRef values, never in logs, source control, or plaintext examples.
- Diagnose by layer: Gateway logs, plugin health, then the external dependency.
- Back up state before upgrades; for cursors, queues, or indexes, verify restart recovery and duplicate-delivery semantics.

## 8. Verification and deep dives

```bash
pnpm --filter "@partme.ai/openclaw-memory" typecheck
pnpm --filter "@partme.ai/openclaw-memory" test
pnpm --filter "@partme.ai/openclaw-memory" build
```

- [Plugin architecture overview](../../doc/OpenClaw-Plugins-Architecture.md)
- [Unified plugin structure standard](../../doc/OpenClaw-Plugins-Structure-Standard.md)

## 9. Preserved detailed reference

The original configuration tables, protocol details, examples, and troubleshooting material continue below.

<!-- README_STANDARD_END -->


> Local layered memory (L0 to L3) with agent/session isolation, retention, optional encryption, and automatic recall.

[![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--memory-blue)](https://www.npmjs.com/package/@partme.ai/openclaw-memory)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

[简体中文](./README.zh-CN.md) | [English](./README.md)

---

## Overview

`@partme.ai/openclaw-memory` provides multi-level long-term memory for OpenClaw agents. It implements the OpenClaw 2026.7.1 Memory Host SDK contract with `kind: "memory"`. The plugin handles local storage, deterministic extraction, and lexical search through `MemorySearchManager`.

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
3. **Auto-Recall**: OpenClaw invokes `MemorySearchManager.search()`; missing `sessionKey` fails closed and does not scan session memories.
4. **Manual Search**: The tool factory uses trusted host `agentId` and `sessionKey`; tool arguments cannot switch tenants.

## Features

- **L0 Conversation Logging** — Auto-capture every conversation turn to local JSONL files
- **L1 Keyword Extraction** — Extract deterministic keyword memories, including Chinese bigrams
- **Automatic Recall** — Framework-invoked `MemorySearchManager.search()` auto-injects relevant memories
- **Keyword Search** — Pure keyword matching with scoring (zero external API calls)
- **Bounded Time Window** — Scans at most 365 daily files within the configured retention period
- **`memory_search` Tool** — Agent can actively search for user memories during conversation
- **Retention Management** — Configurable retention period (default 90 days)
- **Physical Isolation** — Agent and session partitions with opaque, non-enumerable session capabilities
- **Optional Encryption** — Per-line AES-256-GCM; a missing or wrong key fails startup
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
        "hooks": {
          "allowConversationAccess": true
        },
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
        "hooks": {
          "allowConversationAccess": true // Required trust policy for agent_end content
        },
        "config": {
          "dataDir": "~/.openclaw/state/memory",   // Data storage directory
          "maxSearchResults": 10,                   // Max results per search (default: 10)
          "maxSearchBytes": 16777216,               // Cross-file scan budget per search (16 MiB)
          "maxReadLines": 200,                      // Maximum decoded records per readFile call
          "retentionDays": 90,                      // Data retention period (default: 90 days)
          "extractionInterval": 5,                  // L2 extraction interval
          "maxRecordBytes": 65536,                 // Maximum size of every record
          "profileScope": "session",              // Use agent only for single-user agents
          "encryptionKeyEnv": "OPENCLAW_MEMORY_KEY" // Optional, value must be >= 32 bytes
        }
      }
    }
  }
}
```

> `hooks.allowConversationAccess=true` is OpenClaw 2026.7.1's explicit trust policy for non-bundled conversation hooks. Without it, the plugin still appears `loaded` and registers Memory Host search, but OpenClaw blocks `agent_end`, so no new memories are captured.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the memory plugin |
| `dataDir` | string | `~/.openclaw/state/memory` | Data storage directory |
| `maxSearchResults` | number | `10` | Maximum results returned per search |
| `maxSearchBytes` | integer | `16777216` | Shared byte budget across all files scanned by one search |
| `maxReadLines` | integer | `200` | Maximum decoded records returned by one source read |
| `retentionDays` | number | `90` | Retention period; cleanup runs at startup and daily |
| `extractionInterval` | number | `5` | Turns between L2 scenario records |
| `maxRecordBytes` | integer | `65536` | Maximum size of every record |
| `profileScope` | `session` \| `agent` | `session` | L3 recall scope; use `agent` only for a single-user agent |
| `encryptionKeyEnv` | string | unset | Environment variable containing an optional AES-256-GCM key of at least 32 bytes |

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
{dataDir}/agents/{agent-slug-hash}/
├── sessions/{opaque-session-token}/
│   ├── conversations/    # L0 current-turn records
│   ├── memories/         # L1 episodic records
│   ├── scenarios/        # L2 scenario records
│   └── profiles/         # Session-scoped L3 profiles
├── agent-profiles/       # L3 when profileScope=agent
└── .legacy-backup/       # Backups created by legacy-layout migration
```

### Conversation Record Format (L0)

```json
{
  "id": "1747891234567_a1b2c3d4",
  "level": "L0",
  "type": "conversation",
  "agentId": "main",
  "sessionKey": "session_abc123",
  "runId": "run_123",
  "messages": [{ "role": "user", "content": "What is the refund policy?" }],
  "createdAt": "2026-07-15T10:00:00.000Z"
}
```

### Memory Record Format (L1)

```json
{
  "id": "1747891234567_e5f6g7h8",
  "level": "L1",
  "content": "What is the refund policy?",
  "keywords": ["refund", "policy"],
  "type": "episodic",
  "agentId": "main",
  "sessionKey": "session_abc123",
  "createdAt": "2026-07-15T10:00:00.000Z"
}
```

## Scoping and Limitations

- **Deployment**: Local JSONL targets a single node. Use an external memory backend for shared multi-node memory.
- **Search**: Lexical matching with Chinese bigrams; no semantic/vector search.
- **Isolation**: Data is physically partitioned by agent and session. Since Memory Host `readFile()` has no session context, search paths contain a local-keyed 128-bit opaque token and act as unguessable capabilities. Cross-session L3 requires explicit `profileScope: "agent"` opt-in.
- **Group sessions**: Memory Host passes `sessionKey`, not `senderId`, to search. Multiple senders in one session share that session's memory; do not treat a group-chat session as private per-user storage.
- **Encryption operations**: Back up both the key and data directory. Wrong keys fail startup. In-place key rotation or removing encryption from existing encrypted data requires an offline migration.
- **Upgrade migration**: Startup splits the legacy mixed directories into session partitions and retains `.legacy-backup` copies.
- **Acceptance**: Automated tests cover storage, isolation, migration, and the host contract. Production still requires acceptance testing with the real OpenClaw configuration, filesystem permissions, backup restore, and retention policy.
- **Extraction**: L2/L3 use deterministic rules rather than an LLM.
- **Data minimization**: L1 stores up to 2,000 characters of each user input. Do not send secrets into memory unless encryption, access controls, retention, and deletion procedures are in place.
- **Memory Host SDK**: Implements the standard `MemorySearchManager` interface — the framework handles injection timing.
- **Host trust policy**: Set `plugins.entries.memory.hooks.allowConversationAccess=true`; production deployments should also pin trusted third-party plugins with `plugins.allow: ["memory"]`.

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
