# OpenClaw Plugins — Contributing

## Creating a New Plugin

```bash
pnpm new-plugin <name> --label "Display Name" --desc "Description"
```

This generates a complete scaffold from `extensions/_template`:

```
extensions/<name>/
├── index.ts              # Plugin entry point
├── openclaw.plugin.json  # OpenClaw manifest
├── package.json          # npm metadata
├── tsconfig.json         # TypeScript config
├── tsup.config.ts        # Build config
├── vitest.config.ts      # Test config
└── src/
    ├── channel.ts        # ChannelPlugin implementation
    ├── config.ts         # Zod schema + JSON Schema
    ├── media.ts          # Media handling
    ├── monitor.ts        # Message dedup + webhook
    ├── runtime.ts        # Runtime singleton
    └── types.ts          # Type definitions
```

## Development Workflow

```bash
cd extensions/<name>
pnpm install
pnpm dev               # Watch mode (tsup --watch)
pnpm typecheck         # Type check (tsc --noEmit)
pnpm test              # Run tests (vitest)
pnpm build             # Production build
```

## Specification

All plugins MUST comply with [spec/PLUGIN_SPEC.md](../spec/PLUGIN_SPEC.md):

| Requirement | Detail |
|-------------|--------|
| TypeScript strict | `tsconfig.json` extends `../../tsconfig.base.json` |
| Zod + JSON Schema | Export schema from `src/config.ts` |
| Typed errors | Custom Error subclasses with structured fields |
| Status reporting | `setStatus` throughout lifecycle |
| Co-located tests | `src/foo.test.ts` alongside `src/foo.ts` |
| 80%+ coverage | `vitest run --coverage` |

## Test Conventions

```bash
pnpm test                    # All tests
npx vitest run src/media     # Single module
```

Naming: `<module>.<feature>.test.ts`

```
src/media.test.ts
src/media.errors.test.ts
src/monitor.test.ts
src/monitor.webhook.test.ts
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
