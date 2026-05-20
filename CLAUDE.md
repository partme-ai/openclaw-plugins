# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

30+ enterprise plugins for [OpenClaw](https://github.com/partme-ai/openclaw) — an AI agent gateway. Each plugin is an independent npm package under `@partme.ai/<name>`. The monorepo uses pnpm workspaces; every plugin in `extensions/` is self-contained with zero cross-plugin dependencies.

## Commands

```bash
# Monorepo-wide (from root)
pnpm install
pnpm build              # Build all plugins
pnpm typecheck          # tsc --noEmit across all plugins

# Single plugin (from extensions/<name>)
pnpm build              # tsup → dist/ (or tsc for wecom)
pnpm dev                # tsup --watch
pnpm typecheck          # tsc --noEmit
pnpm test               # vitest run
pnpm test:watch         # vitest --watch

# Run a single test file
npx vitest run src/crypto.test.ts
npx vitest run src/media                # pattern match

# Create new plugin from template
pnpm new-plugin <name> --label "Display Name" --desc "Description"

# Publishing
node scripts/publish-changed.mjs --dry-run              # preview
node scripts/publish-changed.mjs --plugin wecom          # single
node scripts/publish-changed.mjs                        # all changed
node scripts/publish-changed.mjs --plugin wecom --tag next  # prerelease
```

## Architecture

### Five-Layer Model

```
Layer 5 — Business Apps (SCRM, dashboards, analytics)
Layer 4 — Router (rule engine, forwarding, audit, knowledge injection)
Layer 3 — OpenClaw Agents (per-tenant/per-function, each binds memory + knowledge + tools)
Layer 2 — Capability (knowledge/RAG, memory L0-L3, tracing, OAuth2)
Layer 1 — Channels (IM: wecom/wechat/dingtalk/qqbot/lark/douyin/wecom-kf | MQ: mqtt/rabbitmq/redis/rocketmq/stomp/web-*)
```

Plugins live in Layers 1-2. The router plugin (`extensions/router`) bridges all layers.

### Plugin Categories

| Category | Plugins | Key Pattern |
|----------|---------|-------------|
| **IM Channels** | wecom, wechat, wechat-ipad, dingtalk, lark, qqbot, douyin, wecom-kf | ChannelPlugin + webhook/WS + media + dedup |
| **Message Queues** | mqtt, rabbitmq, redis-stream, rocketmq, stomp, web-mqtt, web-stomp, cluster | ChannelPlugin + pub/sub adapter |
| **Infrastructure** | nacos, prometheus, gotify, mtls, oauth2, tracing | Tool/hook-based plugins |
| **AI Capabilities** | knowledge, memory, router, message-sdk | Tool + runtime APIs |
| **Utility** | amap, meituan, rednode | Tool plugins |

### Plugin Internals

Every plugin follows the same contract (see `spec/PLUGIN_SPEC.md`):

- **Entry** (`index.ts`): exports a plugin object with `register(api)` method
- **Config** (`src/config.ts`): Zod schema for validation + JSON Schema for manifest
- **Channel** (`src/channel.ts`): implements ChannelPlugin lifecycle (start/stop/inbound/outbound)
- **Runtime** (`src/runtime.ts`): singleton holding runtime state (connections, caches, stores)
- **Errors**: typed classes extending `Error` with structured fields
- **Status**: reports via `setStatus({ running, configured, lastError, ... })` throughout lifecycle

### Message Deduplication

All channel plugins must implement dedup:

```typescript
const processed = new Map<string, number>();
const DEDUP_TTL_MS = 60_000;
const DEDUP_MAX = 10_000;
```

### Media Module

Channel plugins with media support follow the `src/media.ts` pattern: `detectMediaType`, `loadMedia`, `downloadMedia`, `readLocalMedia`, `extractInboundMedia`. Error types: `FileSizeLimitError`, `MediaTimeoutError`.

### Build Toolchain

- **TypeScript**: ES2022 target, NodeNext modules, strict mode
- **Build**: tsup (ESM output) for most plugins; wecom uses raw `tsc`
- **Test**: Vitest with co-located `*.test.ts` files
- **Base config**: `tsconfig.base.json` at root — all plugins extend it

### CI/CD

- `scripts/ci-detect.mjs` detects changed plugins via `git diff` against `origin/main`
- Matrix build in `.github/workflows/ci.yml`: per-plugin install → typecheck → build → test
- `scripts/publish-changed.mjs` compares local version vs npm registry, publishes only when local > remote

## Key Conventions

- **Versioning**: date-based `YYYY.M.D` for active plugins; semver `1.0.0` for stable. Prerelease: `YYYY.M.D.N` with `--tag next`
- **Test naming**: `src/<module>.<feature>.test.ts` — enables `npx vitest run src/<module>` pattern matching
- **No cross-plugin deps**: each plugin is fully self-contained. `message-sdk` is a shared library, not a plugin
- **File naming**: `kebab-case.ts` for modules, `camelCase.ts` for narrow utilities
- **Plugin IDs**: lowercase, dash-separated
- **Node**: >=22.0.0, pnpm 9, ESM only
