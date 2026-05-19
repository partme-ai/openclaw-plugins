# openclaw-plugins

30+ Enterprise Plugins for OpenClaw. One Standard.
Built for production. Not for demos.

## Monorepo Structure

```
openclaw-plugins/
├── extensions/       # All plugins (independent, zero cross-deps)
│   ├── _template/    # Scaffold for new plugins
│   ├── wecom/        # @partme.ai/wecom (flagship)
│   ├── dingtalk/     # @partme.ai/dingtalk
│   └── ...           # 29 total
├── doc/              # Guides and architecture docs
├── spec/             # Plugin development specification
├── archives/         # Reference implementations (not published)
├── test-utils/       # Shared test helpers
└── scripts/          # CI/CD and release tooling
```

## Quick Start

```bash
pnpm install
pnpm build          # Build all
pnpm typecheck      # Type check all
```

Create a new plugin:

```bash
pnpm new-plugin <name> --label "Display Name" --desc "Description"
```

## Plugin Development Convention

Every plugin MUST follow [spec/PLUGIN_SPEC.md](spec/PLUGIN_SPEC.md).

### Core rules
- **Independent**: zero cross-plugin dependencies. Each plugin is self-contained.
- **Config**: Zod schema + JSON Schema in `openclaw.plugin.json`
- **Errors**: typed error classes extending Error, with structured fields
- **Status**: report via `setStatus` throughout lifecycle events
- **Tests**: co-located in `src/`, Vitest, min 80% coverage
- **npm scope**: `@partme.ai/<plugin-name>`

### Plugin directory layout
```
extensions/<name>/
├── package.json              # npm metadata
├── openclaw.plugin.json      # OpenClaw manifest
├── tsup.config.ts            # Build config
├── tsconfig.json             # extends ../../tsconfig.base.json
├── vitest.config.ts
├── index.ts                  # Plugin entry: default export register(api)
├── src/                      # All source code
│   ├── channel.ts            # ChannelPlugin implementation
│   ├── config.ts             # Zod + JSON Schema
│   ├── runtime.ts            # Runtime singleton
│   ├── types.ts              # Type definitions
│   ├── *.test.ts             # Co-located tests
│   └── ...
├── skills/                   # Optional: built-in skills
└── README.md                 # Setup guide + config reference
```

## Building & Publishing

### Local development
```bash
cd extensions/<name>
pnpm build          # tsup → dist/
pnpm dev            # watch mode
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run
```

### Publishing to npm
```bash
# Preview what would be published
node scripts/publish-changed.mjs --dry-run

# Publish all changed plugins
node scripts/publish-changed.mjs

# Publish single plugin
node scripts/publish-changed.mjs --plugin wecom

# Prerelease
node scripts/publish-changed.mjs --plugin wecom --tag next
```

The script compares local `package.json` version against the npm registry:
- `local > npm` → publish
- `local = npm` → skip (up to date)
- `local < npm` → skip with warning (behind)
- Prerelease (`x.y.z-w`) + `--tag latest` → blocked

## Versioning

Use date-based versioning for actively developed plugins:
```
2026.5.12       # Stable
2026.5.12.1     # Prerelease (published with --tag next)
```

Stable plugins can use semver: `1.0.0`, `1.1.0`.

## CI/CD

- **CI** (`.github/workflows/ci.yml`): auto-detects changed plugins via `git diff`, runs build+typecheck+test in parallel matrix
- **Publish** (`.github/workflows/publish.yml`): manual trigger, publishes only version-changed plugins

## Safety

- No hardcoded secrets (API keys, tokens, passwords)
- Validate all inbound messages as untrusted input
- Use environment variables for credentials (`WECOM_BOT_ID`, etc.)
- Never commit `.env` or credentials files

## License

| Source | License |
|--------|---------|
| Self-built plugins | MIT |
| wecom | ISC (TencentCloud fork) |
| wechat/weixin | SEE LICENSE IN LICENSE (Tencent fork) |
| wecom-ics, weixin-ics | MIT |
