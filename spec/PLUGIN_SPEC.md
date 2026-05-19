# Plugin Specification v1.0

Every plugin in this monorepo MUST comply with this spec. This ensures
"One Standard" — users get a consistent experience across all 30+ plugins.

---

## 1. Directory Structure

```
<plugin>/
├── package.json              # npm metadata
├── openclaw.plugin.json      # OpenClaw manifest
├── tsconfig.json             # extends ../../tsconfig.base.json
├── index.ts                  # Plugin entry: default export register(api)
├── README.md                 # Setup guide + config reference
├── LICENSE                   # License file
│
├── src/
│   ├── channel.ts            # ChannelPlugin implementation
│   ├── config.ts             # Zod schema + JSON Schema
│   ├── runtime.ts            # Runtime state singleton
│   ├── types.ts              # All type definitions
│   │
│   ├── *.test.ts             # Co-located tests
│   └── <module>.ts           # Feature modules
│
└── skills/                   # Optional: built-in skills
    └── <skill>/SKILL.md
```

## 2. package.json

```json
{
  "name": "@partme.ai/<plugin>",
  "version": "YYYY.M.D[-N]",
  "type": "module",
  "main": "index.ts",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/partme-ai/openclaw-plugins.git",
    "directory": "extensions/<plugin>"
  },
  "keywords": ["openclaw", "openclaw-plugin", "<domain>"],
  "peerDependencies": {
    "openclaw": ">=YYYY.M.D"
  }
}
```

## 3. openclaw.plugin.json

```json
{
  "id": "<plugin>",
  "channels": ["<channel-id>"],
  "configSchema": { "type": "object", "additionalProperties": false, "properties": {} },
  "channelConfigs": {
    "<channel-id>": {
      "label": "<Display Name>",
      "description": "<Description>",
      "schema": { "type": "object", "additionalProperties": true, "properties": {} }
    }
  }
}
```

## 4. Config

- Define a Zod schema for runtime validation
- Export a JSON Schema for the plugin manifest
- Support `accounts` for multi-account plugins
- Use `enabled: boolean` as the master switch

## 5. Error Handling

- Use typed error classes (extending Error) with structured fields
- NEVER silently swallow errors
- Log error context via `api.logger.error()`
- Return user-friendly messages for the user-facing layer

```typescript
export class TimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}
```

## 6. Status Reporting

Report lifecycle events via `setStatus`:

```typescript
setStatus({
  accountId, running, configured,
  lastStartAt, lastStopAt, lastError,
  lastInboundAt, lastOutboundAt
});
```

## 7. Tests

- Co-located with source: `src/foo.ts` → `src/foo.test.ts`
- Framework: Vitest
- Minimum coverage: 80%
- Run: `npx vitest run`

### Test naming convention

Follow `<module>.<feature>.test.ts` pattern:

```
src/channel.test.ts                # Channel lifecycle
src/channel.ws-media.test.ts       # WS media sending
src/config.test.ts                 # Config parsing
src/media.test.ts                  # Media upload/download
src/media.errors.test.ts           # Media error handling
src/monitor.test.ts                # Monitor / dedup
src/monitor.webhook.test.ts        # Webhook handler
src/outbound.test.ts               # Outbound delivery
src/outbound.text.test.ts          # Text-specific outbound
```

This makes it immediately clear what each test file covers, and allows
running focused test suites: `npx vitest run src/media`

### Message dedup pattern

All channel plugins MUST implement message deduplication:

```typescript
const processedMessages = new Map<string, number>();
const DEDUP_TTL_MS = 60_000;
const DEDUP_MAX_ENTRIES = 10_000;

function isDuplicate(messageId: string): boolean {
  const now = Date.now();
  if (!messageId) return false;
  const prev = processedMessages.get(messageId);
  if (prev && now - prev < DEDUP_TTL_MS) return true;
  // Prune expired + LRU eviction
  processedMessages.set(messageId, now);
  return false;
}
```

### Media module guidelines

Each channel plugin SHOULD have `src/media.ts` providing:

| Function | Purpose |
|----------|---------|
| `detectMediaType(fileName)` | Extension-based type detection |
| `detectMediaTypeFromContentType(mime)` | MIME-based type detection |
| `loadMedia(source, maxBytes?)` | Unified URL/local loading |
| `downloadMedia(url, maxBytes?)` | Remote media download |
| `readLocalMedia(path, maxBytes?)` | Local file read with validation |
| `extractInboundMedia(raw)` | Platform-specific media extraction |

Error types: `FileSizeLimitError`, `MediaTimeoutError`.

## 8. Lifecycle Hooks

Use OpenClaw's hook system for cross-cutting concerns:

```typescript
api.on("before_prompt_build", (_event, ctx) => { ... });
api.on("agent_end", (event, ctx) => { ... });
api.on("gateway_stop", async () => { ... });
```

## 9. Security

- No hardcoded secrets (API keys, tokens, passwords)
- Use environment variables or OpenClaw config
- Validate all user input at system boundaries
- Apply dmPolicy / groupPolicy consistently

## 10. Naming Conventions

- Plugin directory: lowercase, dash-separated (`wecom`, `redis-stream`)
- npm package: `@partme.ai/<directory>`
- Channel ID: lowercase, dash-separated
- Source files: `kebab-case.ts` for modules, `camelCase.ts` for narrow utilities
