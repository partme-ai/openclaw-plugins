# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`@partme.ai/openclaw-knowledge` — OpenClaw knowledge base RAG engine plugin. Provides embedding, vector store, hybrid retrieval, and multi-type chunking as a pluggable module for OpenClaw channel plugins (wecom, lark, dingtalk, qqbot, etc.).

## Build & Test

```bash
pnpm install                  # Install dependencies (pnpm required)
pnpm build                    # Build via tsup → dist/
pnpm dev                      # Watch mode
pnpm test                     # Run all vitest tests
pnpm test -- -t "pattern"     # Run specific test by name
pnpm test:coverage            # Test with coverage
pnpm clean                    # Remove dist/
pnpm typecheck                # tsc --noEmit (must add to scripts first)
```

Node >= 22, pnpm 10.x, ESM only. Tests live next to source as `*.test.ts`.

## Architecture

This is a pipeline-based RAG engine. Each pipeline node is **optional** (enabled by config) and **fail-safe** (node failure does not block the pipeline):

```
IntentGate (rule/strict) → Embedding → Tokenizer → Chunker
                                          ↓
VectorStore ←── HybridRetriever (vector + FTS5 keyword, weighted fusion)
      ↓
(Reranker, optional: jina/zhipu/ollama)
      ↓
before_prompt_build hook → Injection (system or user prompt)
```

### Source layout

```
src/
  index.ts               # Public API entry: indexFile, searchByQuery, CRUD tool exports
  types.ts               # All interfaces & config types (EmbeddingService, VectorStore, etc.)
  config.ts              # Config defaults, validation, merge logic
  hooks.ts               # Runtime: store caching (by namespace), config merge, main before_prompt_build pipeline
  intent-gate.ts         # Intent detection: keyword-based rule mode, strict mode
  indexer/
    scheduler.ts         # indexDocument/indexDocuments: load → chunk → embed → store
    chunker.ts           # Text splitting: paragraph/sentence boundary aware
  retriever/
    hybrid.ts            # HybridSearch: vector + keyword fusion (0.7/0.3 default weights)
  embedding/             # Provider factory + 5 providers (openai, dashscope, zhipu, qianfan, ollama)
  store/                 # VectorStore factory + 3 backends (sqlite-vec, zvec, native-zvec)
  reranker/              # Factory + 3 providers (jina, zhipu, ollama)
  tokenizer/             # Factory + 2 providers (tiktoken, zhipu)
  parser/                # Factory + 2 providers (ollama, zhipu) — for non-text files
  tools/                 # CRUD tools: knowledge-add, query, update, delete
```

### Key design decisions

- **Namespace format**: `{accountId}:{mode}` where mode is `bot` or `agent`. This isolates data per account+mode.
- **Config hierarchy**: `channels.{channel}.knowledge.*` (global) → `channels.{channel}.accounts.{id}.knowledge.*` (override). Fields are shallow-merged; `store.sources` is replaced wholesale.
- **Dynamic imports**: Heavy dependencies (better-sqlite3, @zvec/zvec) are dynamically imported so failures don't prevent the module from loading when using other backends.
- **Store caching**: VectorStore + EmbeddingService pairs are cached in a `Map<string, {store, embedding}>` keyed by namespace. Use `invalidateStoreCache(namespace?)` to force recreation.
- **embed() overload**: `EmbeddingEngine.embed()` uses function overloads — single string returns `number[]`, string array returns `number[][]`.
- **`enabled` field**: Only respected at the global config level; account-level overrides cannot independently enable/disable.

### Integration pattern

Channel plugins integrate with ~10 lines:

```typescript
import { registerKnowledgeHooks, createKnowledgeAddTool, ... } from '@partme.ai/openclaw-knowledge';

export function onRegister(api: PluginApi) {
  registerKnowledgeHooks(api, 'channels.wecom.knowledge');
  api.registerTool(createKnowledgeAddTool);
  api.registerTool(createKnowledgeQueryTool);
  api.registerTool(createKnowledgeUpdateTool);
  api.registerTool(createKnowledgeDeleteTool);
}
```

## CI/CD

Two workflows in `.github/workflows/`:
- `ci.yml` — Runs on PR/push: build, typecheck, test, code quality checks
- `release.yml` — Triggers on tag push `v*`, publishes to npm + GitHub Packages