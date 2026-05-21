# Development Guide — openclaw-rockermq

## Project Setup

```bash
git clone <repo-url>
cd openclaw-rocketmq
npm install
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build with tsup → `dist/` |
| `npm run dev` | Watch mode (rebuild on changes) |
| `npm run typecheck` | TypeScript type check (`tsc --noEmit`) |
| `npm run test` | Run all tests (vitest) |
| `npm run clean` | Remove `dist/` |

### Running specific tests

```bash
# Single test file
npx vitest run test/rockermq-config.test.ts

# Tests matching a pattern
npx vitest run -t "should parse endpoints"

# Watch mode
npx vitest

# Integration tests only
npx vitest run test/integration.test.ts --testTimeout=120000
```

## Local Development with Docker

### Start RocketMQ

```bash
# NameServer
docker run -d --name rmq-namesrv -p 9876:9876 \
  apache/rocketmq:5.3.1 sh mqnamesrv

# Broker + Proxy
docker run -d --name rmq-broker \
  -p 10911:10911 -p 8081:8081 \
  apache/rocketmq:5.3.1 sh mqbroker -n 127.0.0.1:9876 --enable-proxy
```

### Quick connectivity test

```bash
# Verify the broker proxy is reachable
curl -s http://127.0.0.1:8081/ | head -1
```

### Link local build into OpenClaw

```bash
# Build the plugin
npm run build

# Register as a local plugin
openclaw plugins install --path "$(pwd)"
openclaw plugins enable openclaw-rockermq

# Check it's loaded
openclaw plugins list | grep rockermq
```

## Project Structure

```
openclaw-rocketmq/
├── src/
│   ├── index.ts              # Plugin entry (defineChannelPluginEntry)
│   ├── channel.ts            # Channel lifecycle + config
│   ├── rockermq-config.ts    # Config parsing + validation
│   ├── rockermq-server.ts    # Transport (Producer + PushConsumer)
│   ├── rockermq-state.ts     # Runtime config singleton
│   ├── inbound.ts            # Inbound processing + dispatch
│   ├── outbound.ts           # Outbound adapter
│   ├── topic-router.ts       # Topic → agent routing
│   ├── session-mapper.ts     # Session ↔ peer mapping
│   ├── mq-tools.ts           # mq.publish debug tool
│   ├── runtime.ts            # Runtime reference
│   ├── types.ts              # Core types
│   ├── utils.ts              # Text utilities
│   ├── setup-entry.ts        # Setup entry
│   └── openclaw-sdk.d.ts     # SDK type declarations
├── test/
│   ├── rockermq-config.test.ts   # Config parsing tests
│   ├── topic-router.test.ts      # Routing tests
│   ├── session-mapper.test.ts    # Session store tests
│   └── integration.test.ts       # End-to-end tests
├── docs/                    # Documentation
├── dist/                    # Build output
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── eslint.config.js
├── .prettierrc
└── openclaw.plugin.json
```

## Build Configuration

### tsup (`tsup.config.ts`)

- **Entry points**: `src/index.ts`, `src/setup-entry.ts`
- **Format**: ESM only
- **Target**: Node.js 20
- **External**: `openclaw/*`, `rocketmq-client-nodejs`
- **Output**: `dist/` with source maps + declarations

### TypeScript (`tsconfig.json`)

- **Target**: `ESNext`
- **Module**: `ESNext` with `bundler` resolution
- **Strict mode**: enabled
- **Root**: `src/`, output: `dist/`

## Testing

### Unit Tests
- `rockermq-config.test.ts` — config parsing, validation, credential masking
- `topic-router.test.ts` — topic parsing, wildcard matching, route resolution
- `session-mapper.test.ts` — session context CRUD, peer mappings, stats

### Integration Tests
- `integration.test.ts` — requires running RocketMQ + OpenClaw Gateway
- Tests: plugin registration, health endpoints, message routing, agent replies
- Uses real `rocketmq-client-nodejs` Producer + PushConsumer

## Linting & Formatting

```bash
# ESLint
npx eslint .

# Prettier check
npx prettier --check "src/**/*.ts" "test/**/*.ts"

# Prettier fix
npx prettier --write "src/**/*.ts" "test/**/*.ts"
```

### ESLint Rules
- `@typescript-eslint/no-explicit-any`: warn
- `@typescript-eslint/no-unused-vars`: warn (ignore `_` prefixed)
- `no-console`: warn
- `no-debugger`: error

## Plugin Metadata

### `openclaw.plugin.json`

Defines the plugin manifest:
- `id`: `"openclaw-rockermq"`
- `channels`: `["rockermq"]`
- `configSchema`: Channel config JSON Schema
- `contracts.tools`: `["mq.publish"]`
- `channelConfigs.rockermq.schema`: Full config schema
- `channelConfigs.rockermq.uiHints`: UI labels + sensitive field markers

### `package.json` `openclaw` field

```json
{
  "openclaw": {
    "extensions": ["./dist/index.js"],
    "setupEntry": "./dist/setup-entry.js",
    "channel": {
      "id": "rockermq",
      "label": "RocketMQ",
      "blurb": "RocketMQ channel plugin with producer and push-consumer support."
    }
  }
}
```

## Release Checklist

1. `npm run typecheck` — must pass
2. `npm test` — all tests pass
3. `npm run build` — clean build
4. Update version in `package.json` + `openclaw.plugin.json` (date-based: `YYYY.M.D`)
5. Verify with `openclaw plugins list` after install
6. Test health endpoint: `curl http://127.0.0.1:18790/rockermq/health`

## Contributing

1. Follow the OpenClaw plugin conventions (see workspace `CLAUDE.md`)
2. Use `any` sparingly — prefer SDK types from `openclaw/plugin-sdk/*`
3. Prefer `console.warn`/`console.error` over `console.log` for diagnostics
4. Mask credentials in all API responses
5. Write tests for config parsing, routing, and session management
6. Run integration tests before submitting PRs
