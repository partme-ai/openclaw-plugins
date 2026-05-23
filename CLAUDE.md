# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

28 enterprise plugins for [OpenClaw](https://github.com/partme-ai/openclaw) — an AI agent gateway. Each plugin is an independent npm package under `@partme.ai/<name>`. The monorepo uses pnpm workspaces; every plugin in `extensions/` is self-contained with zero cross-plugin dependencies (message-sdk is the sole exception — a shared library, not a plugin).

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
Layer 4 — Router + Bridge (rule engine, forwarding, audit, cross-channel context injection)
Layer 3 — OpenClaw Agents (per-tenant/per-function, each binds memory + knowledge + tools)
Layer 2 — Capability (knowledge/RAG, memory L0-L3, tracing, OAuth2)
Layer 1 — Channels (IM: wecom/wechat/douyin/wecom-kf/wechat-ipad + bridge adapts 21 upstream channels | MQ: mqtt/rabbitmq/redis/rocketmq/stomp/web-*)
```

Plugins live in Layers 1-2. The router plugin (`extensions/router`) and bridge plugin (`extensions/bridge`) bridge all layers.

### Plugin Categories

| Category | Plugins | Key Pattern |
|----------|---------|-------------|
| **IM Channels** | wecom, wechat, wechat-ipad, douyin, wecom-kf | ChannelPlugin + webhook/WS + media + dedup |
| **IM Bridge** | bridge | before_prompt_build context injection + agent_end → MQ forwarding for 21 upstream channels |
| **Message Queues** | mqtt, rabbitmq, redis-stream, rocketmq, stomp, web-mqtt, web-stomp, cluster | ChannelPlugin + pub/sub adapter |
| **Infrastructure** | nacos, prometheus, gotify, mtls, oauth2, tracing | Tool/hook-based plugins |
| **AI Capabilities** | knowledge, memory, router, message-sdk | Tool + runtime APIs |
| **Utility** | amap, meituan, rednode | Tool plugins |

> DingTalk, Lark/Feishu, and QQ Bot channels are maintained by their platform teams as official upstream plugins.  
> They are integrated into the PartMe.AI ecosystem via `@partme.ai/openclaw-bridge` — no local forks needed.

### Plugin Internals

Most plugins follow the same contract (see `spec/PLUGIN_SPEC.md`):

- **Entry** (`index.ts`): exports a plugin object with `register(api)` method
- **Config** (`src/config.ts`): Zod schema for validation + JSON Schema for manifest
- **Channel** (`src/channel.ts`): implements ChannelPlugin lifecycle (start/stop/inbound/outbound)
- **Runtime** (`src/runtime.ts`): singleton holding runtime state (connections, caches, stores)
- **Errors**: typed classes extending `Error` with structured fields
- **Status**: reports via `setStatus({ running, configured, lastError, ... })` throughout lifecycle

Lightweight plugins (memory, router, bridge) implement everything in a single `index.ts` — no `src/` subdirectory needed. Channel plugins (wecom, mqtt, etc.) use the full `src/` layout.

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
- **Test**: Vitest with co-located `*.test.ts` files (also `index.test.ts` at plugin root for single-file plugins)
- **Base config**: `tsconfig.base.json` at root — all plugins extend it
- **Note**: wecom and gotify build with raw `tsc`; all other plugins use tsup

### CI/CD

- `scripts/ci-detect.mjs` detects changed plugins via `git diff` against `origin/main`
- Matrix build in `.github/workflows/ci.yml`: per-plugin install → typecheck → build → test (lenient: `|| true` on build steps)
- `.github/workflows/build-nacos.yml`: dedicated strict workflow (install → tsc → tsup → vitest → upload artifact)
- `.github/workflows/publish.yml`: manual trigger with `--dry-run` default
- `scripts/publish-changed.mjs` compares local version vs npm registry, publishes only when local > remote

## Key Conventions

- **Versioning**: date-based `YYYY.M.D` for active plugins; semver `1.0.0` for stable. Prerelease: `YYYY.M.D.N` with `--tag next`
- **Test naming**: `src/<module>.<feature>.test.ts` — enables `npx vitest run src/<module>` pattern matching
- **No cross-plugin deps**: each plugin is fully self-contained. `message-sdk` is the sole shared library — consumers use `workspace:^<sdkVersion>` in dev; `publish-changed.mjs` materializes to `^<version>` on npm publish. Run `pnpm sync-message-sdk-deps` after bumping message-sdk.
- **File naming**: `kebab-case.ts` for modules, `camelCase.ts` for narrow utilities
- **Plugin IDs**: lowercase, dash-separated
- **Node**: >=22.0.0, pnpm 9, ESM only

## CLAUDE Rules

These rules apply to every task in this project unless explicitly overridden.
Bias: caution over speed on non-trivial work. Use judgment on trivial tasks.

### Rule 1 — Think Before Coding
State assumptions explicitly. If uncertain, ask rather than guess.
Present multiple interpretations when ambiguity exists.
Push back when a simpler approach exists.
Stop when confused. Name what's unclear.

### Rule 2 — Simplicity First
Minimum code that solves the problem. Nothing speculative.
No features beyond what was asked. No abstractions for single-use code.
Test: would a senior engineer say this is overcomplicated? If yes, simplify.

### Rule 3 — Surgical Changes
Touch only what you must. Clean up only your own mess.
Don't "improve" adjacent code, comments, or formatting.
Don't refactor what isn't broken. Match existing style.

### Rule 4 — Goal-Driven Execution
Define success criteria. Loop until verified.
Don't follow steps. Define success and iterate.
Strong success criteria let you loop independently.

### Rule 5 — Use the model only for judgment calls
Use me for: classification, drafting, summarization, extraction.
Do NOT use me for: routing, retries, deterministic transforms.
If code can answer, code answers.

### Rule 6 — Token budgets are not advisory
Per-task: 4,000 tokens. Per-session: 30,000 tokens.
If approaching budget, summarize and start fresh.
Surface the breach. Do not silently overrun.

### Rule 7 — Surface conflicts, don't average them
If two patterns contradict, pick one (more recent / more tested).
Explain why. Flag the other for cleanup.
Don't blend conflicting patterns.

### Rule 8 — Read before you write
Before adding code, read exports, immediate callers, shared utilities.
"Looks orthogonal" is dangerous. If unsure why code is structured a way, ask.

### Rule 9 — Tests verify intent, not just behavior
Tests must encode WHY behavior matters, not just WHAT it does.
A test that can't fail when business logic changes is wrong.

### Rule 10 — Checkpoint after every significant step
Summarize what was done, what's verified, what's left.
Don't continue from a state you can't describe back.
If you lose track, stop and restate.

### Rule 11 — Match the codebase's conventions, even if you disagree
Conformance > taste inside the codebase.
If you genuinely think a convention is harmful, surface it. Don't fork silently.

### Rule 12 — Fail loud
"Completed" is wrong if anything was skipped silently.
"Tests pass" is wrong if any were skipped.
Default to surfacing uncertainty, not hiding it.