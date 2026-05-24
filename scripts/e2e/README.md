# OpenClaw Plugin E2E

Repeatable end-to-end workflow for validating **installed** OpenClaw plugins against real backing services and the OpenClaw gateway.

## Quick start

```bash
# From openclaw-plugins repo root
pnpm install

# Unit tests only (no Docker) — all extensions
pnpm test:unit

# Unit tests for a subset
pnpm test:unit -- --plugins mqtt,stomp,wecom

# Full queue/channel e2e (Docker + gateway)
pnpm test:e2e

# Host gateway (recommended on Mac)
OPENCLAW_E2E_HOST_GATEWAY=1 pnpm test:e2e

# Combined runner (defaults to unit-only; pass --e2e-only for Docker path)
pnpm test:plugins -- --unit-only --plugins gotify
pnpm test:plugins -- --e2e-only --plugins mqtt,rabbitmq --skip-browser
```

Report: `scripts/e2e/e2e-report.json` (gitignored)

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────┐
│  run-e2e.mjs    │────▶│ Docker Compose (backing services)     │
│  orchestrator   │     │ rabbitmq · gotify · rocketmq-*        │
└────────┬────────┘     └──────────────────────────────────────┘
         │
         ├─ build / pack / install plugins → ~/.openclaw-queue-e2e
         ├─ generate openclaw.json (config/plugins/*.mjs)
         ├─ bootstrap data (Gotify tokens, RocketMQ topic)
         │
         ├─ OpenClaw gateway
         │    ├─ container: docker-compose `openclaw` service
         │    └─ host fallback: OPENCLAW_E2E_HOST_GATEWAY=1
         │
         ├─ plugin adapters (plugins/*.mjs) — smoke + protocol checks
         └─ Playwright browser tests (web-mqtt / web-stomp via test-web/)
```

## Directory layout

| Path | Purpose |
|------|---------|
| `run-e2e.mjs` | Main orchestrator (`--plugins`, `--keep-services`, …) |
| `docker-compose.yml` | Backing services + optional `openclaw` gateway container |
| `docker/openclaw-entrypoint.sh` | Container gateway startup |
| `lib/` | Shared helpers: compose, install, config, gateway, report, registry |
| `config/plugins/` | Per-plugin OpenClaw config fragments |
| `datasets/` | Sample payloads (text/json) reused by adapters |
| `bootstrap/` | Service setup (Gotify tokens, RocketMQ topic) |
| `plugins/` | Per-plugin E2E test adapters |

## Test pyramid

| Layer | Command | Docker | Scope |
|-------|---------|--------|-------|
| **Unit** | `pnpm test:unit` | No | Vitest per extension — config, mappers, mocks |
| **Standard channel** | `cd extensions/gotify && pnpm test:standard` | Optional | Agent send/wait/reply via `testing/` runner |
| **E2E smoke** | `pnpm test:e2e` | Yes* | Install + gateway + protocol adapters |

\* Embedded channels (mqtt, stomp, web-*) need gateway only; external brokers need compose services.

## Extension inventory

See `scripts/e2e/lib/registry.mjs` → `EXTENSION_INVENTORY` for the full matrix:

- **e2eAdapter: true** — has `scripts/e2e/plugins/<id>.mjs` (7 plugins today)
- **e2eAdapter: false** — unit tests (+ optional `testing/` standard suite); no Docker e2e yet
- **dockerRequired: true** — rabbitmq, rocketmq, gotify (redis-stream planned)

### Plugins with e2e adapters (Docker optional per category)

| Plugin | Docker services |
|--------|-----------------|
| mqtt, stomp, web-mqtt, web-stomp | None (embedded / browser) |
| rabbitmq | rabbitmq |
| rocketmq | rocketmq-namesrv, broker, proxy |
| gotify | gotify |

### Unit-only extensions (representative)

wecom, wechat, douyin, redis-stream, nacos, bridge, cluster, knowledge, memory, message-sdk, …

## Shared test utilities

`test-utils/` (`@partme.ai/openclaw-test-utils`):

- `createRuntimeEnv()` — mock plugin runtime env
- `createMockPluginApi()` — minimal PluginApi
- `channel-fixtures` — mqtt/gotify/stomp config fragments
- `plugin-manifest` — manifest smoke test helper
- `datasets` — re-export `scripts/e2e/datasets/*.json`

## Plugin categories (queue/channel focus)

| Category | Plugins | Backing service |
|----------|---------|-----------------|
| Embedded service | mqtt, stomp, web-mqtt, web-stomp | OpenClaw gateway only |
| External broker | rabbitmq, rocketmq, gotify | Docker Compose |

Future categories (extensible via `lib/registry.mjs` + adapter registration):

- **Web/browser** — Playwright against plugin UI or `test-web/`
- **Webhook/platform** — wecom, wechat, douyin, …

## OpenClaw in Docker vs host

There is **no official OpenClaw image** in this repo. The compose `openclaw` service uses `node:22-bookworm-slim`, mounts the repo + E2E state dir, and runs the CLI from `devDependencies.openclaw` (or `npm install -g` fallback).

**Mac / local dev:** use host gateway when bind mounts or CLI paths are simpler:

```bash
export OPENCLAW_E2E_HOST_GATEWAY=1
export OPENCLAW_BIN="$HOME/.openclaw/extensions/wecom/node_modules/.bin/openclaw"  # if needed
```

**Container gateway:** omit `OPENCLAW_E2E_HOST_GATEWAY`; orchestrator starts `openclaw` via compose after backing services.

Do **not** fake success — if the gateway never listens on `E2E_GATEWAY_PORT`, the run fails.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_E2E_HOST_GATEWAY` | unset | `1` = run gateway on host |
| `OPENCLAW_BIN` | repo or wecom install | OpenClaw CLI path |
| `OPENCLAW_E2E_STATE_DIR` | `~/.openclaw-queue-e2e` | Profile state |
| `E2E_GATEWAY_PORT` | `19789` | Gateway HTTP port |
| `OPENCLAW_E2E_SKIP_DOCKER` | unset | `1` = skip Docker entirely (broker tests fail unless services already running) |
| `E2E_STOMP_TCP_PORT` | `61613` | stomp-tcp channel port in config/tests |

## Adding a new plugin test adapter

1. Add entry to `lib/registry.mjs` (id, filter, dir, dockerServices, category).
2. Add `config/plugins/<id>.mjs` with `pluginEntry` + `channelEntry` builders.
3. Add `plugins/<id>.mjs` exporting `testXxx(ctx, results)`.
4. Register in `plugins/index.mjs` (`ADAPTERS` map).
5. Optional: dataset under `datasets/` and bootstrap under `bootstrap/`.
6. Run: `node scripts/e2e/run-e2e.mjs --plugins <id>`.

## Secrets & artifacts (gitignored)

See `.gitignore`: `.e2e-secrets.json`, `e2e-report.json`, gateway logs, browser logs.

## Legacy scripts

These remain as thin wrappers; prefer `run-e2e.mjs`:

- `install-plugins.mjs`
- `generate-openclaw-config.mjs`
- `test-installed-plugins.mjs`
- `setup-gotify-tokens.mjs`
- `bootstrap-rocketmq-topic.mjs`

See [TEST_PLAN.md](./TEST_PLAN.md) for layer-by-layer test design.
