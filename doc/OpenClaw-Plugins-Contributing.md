# OpenClaw Plugins — Contributing

## Creating a New Plugin

```bash
pnpm new-plugin PLUGIN_NAME --label "Display Name" --desc "Description"
```

This generates a complete scaffold from `extensions/_template`:

```
extensions/<name>/
├── openclaw.plugin.json  # OpenClaw manifest
├── package.json          # npm metadata
├── tsconfig.json         # TypeScript config
├── tsup.config.ts        # Build config
├── vitest.config.ts      # Test config
├── src/
│   ├── index.ts          # Runtime entry: defineChannelPluginEntry
│   ├── setup-entry.ts    # Setup cold-path entry
│   ├── channel.ts        # ChannelPlugin implementation
│   ├── channel-setup-factory.ts # Setup adapter and wizard
│   ├── onboarding.ts     # Setup flow exports
│   ├── inbound.ts        # Inbound message handling
│   ├── outbound.ts       # Outbound message adapter
│   ├── config.ts         # Configuration parsing and validation
│   ├── runtime.ts        # Runtime state
│   ├── types.ts          # Type definitions
│   └── transport/
│       └── server.ts     # Webhook, HTTP, or broker I/O
└── test/
    └── *.test.ts         # Plugin unit tests
```

## Development Workflow

```bash
pnpm install                                      # Install once at the repository root
pnpm --filter './extensions/<name>' dev           # Watch mode (tsup --watch)
pnpm --filter './extensions/<name>' typecheck     # Type check (tsc --noEmit)
pnpm --filter './extensions/<name>' test          # Run tests (vitest)
pnpm --filter './extensions/<name>' build         # Production build
```

## Specification

All plugins MUST comply with [spec/PLUGIN_SPEC.md](../spec/PLUGIN_SPEC.md):

| Requirement | Detail |
|-------------|--------|
| TypeScript strict | `tsconfig.json` extends `../../tsconfig.base.json` |
| Zod + JSON Schema | Export schema from `src/config.ts` |
| Typed errors | Custom Error subclasses with structured fields |
| Status reporting | `setStatus` throughout lifecycle |
| Test directory | Put new plugin tests in `test/*.test.ts`; existing `src/**/*.test.ts` may remain during migration |
| 80%+ coverage | `vitest run --coverage` |

## Test Conventions

```bash
pnpm --filter './extensions/<name>' test
pnpm --filter './extensions/<name>' exec vitest run test/media.test.ts
```

Put new tests under `test/`, named `<module>.<feature>.test.ts`:

```
test/media.test.ts
test/media.errors.test.ts
test/monitor.test.ts
test/monitor.webhook.test.ts
```

## Publishing

### Preview

```bash
node scripts/publish-changed.mjs --dry-run
```

### Single Plugin

```bash
node scripts/publish-changed.mjs --plugin wecom
```

### Pre-release

```bash
node scripts/publish-changed.mjs --plugin wecom --tag next
```

The script compares local `package.json` versions against the npm registry and only publishes plugins with version changes.

## Pull Request Process

1. Fork the repository
2. Create a branch: `git checkout -b feat/my-feature`
3. Develop + test
4. Ensure `pnpm typecheck` and `pnpm test` pass
5. Submit PR to `main`

CI automatically detects changed plugins and runs build + typecheck + test in a parallel matrix.
