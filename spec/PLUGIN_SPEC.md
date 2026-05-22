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

All channel plugins MUST implement message deduplication. **MQ / STOMP / MQTT 类插件** SHOULD use `createIdempotencyCache` from `@partme.ai/openclaw-message-sdk` instead of ad-hoc `Map` implementations.

```typescript
import { createIdempotencyCache } from "@partme.ai/openclaw-message-sdk";

const dedup = createIdempotencyCache({ ttlMs: 60_000, maxEntries: 10_000 });

if (idempotencyKey && dedup.remember(idempotencyKey)) {
  return; // duplicate
}
```

### MQ / 推送通道与 message-sdk（必选）

以下传输类插件 **MUST** 使用 message-sdk 作为消息载体与 OpenClaw 入站/出站桥接：

`mqtt`, `rabbitmq`, `redis-stream`, `rocketmq`, `stomp`, `web-mqtt`, `web-stomp`, `gotify`（Gotify 入站映射与去重；出站 REST 仍为明文）

| 职责 | 插件 | SDK |
|------|------|-----|
| 连接、订阅、publish | 各插件 | — |
| 解析入站 payload | — | `parseTransportPayload` |
| 分发至 Agent | — | `dispatchInbound`（`bridge` 子路径） |
| 序列化出站 wire | — | `serializeForTransport`（经 `createReplyHandler`） |

不得在各插件内重复实现 `parseInboundText` 或完整的 `finalizeInboundContext` + `dispatchReplyFromConfig` 样板代码。详见 `extensions/message-sdk/docs/ARCHITECTURE.md`。

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
