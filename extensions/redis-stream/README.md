<div align="center">

# OpenClaw Redis Stream

**Redis Pub/Sub Channel + Stream Consumer Group Integration for OpenClaw**

[![npm version](https://img.shields.io/npm/v/@partme.ai/openclaw-redis-stream)](https://www.npmjs.com/package/@partme.ai/openclaw-redis-stream)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![Redis](https://img.shields.io/badge/redis-%3E%3D7.0-red)](https://redis.io)

</div>

---

[English](./README.md) | [简体中文](./README.zh-CN.md)

---

## Introduction

`openclaw-redis-stream` is an OpenClaw channel plugin that enables AI agent integration via Redis Pub/Sub channels and Redis Stream consumer groups.

It uses the official [node-redis](https://github.com/redis/node-redis) client and follows OpenClaw's `defineChannelPluginEntry` interface. The plugin supports multi-topic subscription, explicit topic→agent bindings, and dmScope-based session isolation consistent with [openclaw-mqtt](https://github.com/partme-ai/openclaw-plugins/tree/main/openclaw-mqtt), [openclaw-stomp](https://github.com/partme-ai/openclaw-plugins/tree/main/openclaw-stomp), and [openclaw-rabbitmq](https://github.com/partme-ai/openclaw-plugins/tree/main/openclaw-rabbitmq).

## Core Capabilities

- **Dual transport**: Redis Pub/Sub for real-time message reception and Redis Stream with consumer groups for persistent, replayable message processing
- **Multi-topic subscription**: Subscribe to multiple Redis channels/patterns with `*` wildcard support via `PSUBSCRIBE`
- **Explicit binding first**: `channelBindings` have highest routing priority, mapping specific channel patterns to agents
- **Standard format fallback**: Unmatched channels use `openclaw:agent:<agentId>:in` format for automatic routing
- **dmScope session isolation**: Session keys derived from OpenClaw's global `session.dmScope` config (`main` / `per-peer` / `per-channel-peer` / `per-account-channel-peer`)
- **JSON + plain text payloads**: Accept raw text or `{"text": "..."}` JSON payloads
- **HTTP health/status endpoints**: `/redis-stream/health` and `/redis-stream/status` for monitoring

## Lifecycle

1. **Gateway startup** → Plugin loads, registers `redis-stream` channel
2. **Account start** → Connects to Redis, subscribes to channels (Pub/Sub mode) or creates consumer group (Stream mode)
3. **Message reception** → Inbound messages go through whitelist filtering → route resolution → dmScope session mapping → agent dispatch
4. **Agent reply** → Outbound text published via `PUBLISH` (Pub/Sub mode) or `XADD` (Stream mode)
5. **Gateway shutdown** → Unsubscribes, quits Redis connections

## Message Processing Flow

1. Redis channel message received (Pub/Sub `SUBSCRIBE`/`PSUBSCRIBE` callback)
2. Whitelist check: if `subscribeChannels` is non-empty, only matched channels are processed
3. Route resolution: `channelBindings` checked first (explicit match), then standard `openclaw:agent:<agentId>:in` format
4. dmScope read from OpenClaw global config (`session.dmScope`)
5. Session key built: `agent:<agentId>:<dmScope_suffix>`
6. Session context updated (channel, replyChannel, peerId)
7. Agent dispatch → `rt.channel.reply.dispatchReplyFromConfig`
8. Reply published to `replyChannel` via Redis `PUBLISH`

## Quick Start

### Prerequisites

- Node.js >= 22
- Redis >= 7.0 (with Pub/Sub support)
- OpenClaw Gateway >= 2026.4.0

### Install

```bash
# Recommended — ClawHub
openclaw plugins install clawhub:@partme.ai/openclaw-redis-stream

# Transitional — npm
openclaw plugins install npm:@partme.ai/openclaw-redis-stream
```

Requires `@partme.ai/openclaw-message-sdk >= 2026.5.22`.

### Minimal Configuration

```jsonc
{
  "channels": {
    "redis-stream": {
      "url": "redis://localhost:6379",
      "channelMode": "pubsub",
      "subscribeChannels": ["openclaw:agent:*:in"],
      "channelBindings": [
        {
          "channelPattern": "sensor:temperature",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyChannel": "sensor:temperature:response"
        }
      ]
    }
  }
}
```

Restart the Gateway after installation: `openclaw gateway restart`

### Build & Test

```bash
npm install
npm run typecheck
npm run build
npm test
```

## Channel Rules

| Type | Format | Notes |
|------|--------|-------|
| Standard inbound | `openclaw:agent:<agentId>:in` | Auto-detected, no binding needed |
| Standard outbound | `openclaw:agent:<agentId>:out` | Derived from inbound |
| Explicit binding | Any channel pattern (e.g. `sensor:temperature`) | Defined in `channelBindings`, highest priority |

**Routing priority**: `channelBindings` > standard format. If no route matches, the message is silently dropped.

Channel patterns support `*` wildcard matching (glob-style, colon-delimited). A standalone `*` matches all remaining segments.

## Configuration Reference

### Required

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | `string` | — | Redis connection URL |

### Channel Mode

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `channelMode` | `"pubsub" \| "stream"` | `"pubsub"` | Inbound message transport |
| `defaultAgentId` | `string` | `""` | Fallback agent ID when no binding/standard-format matches. Empty = drop unroutable messages |
| `subscribeChannels` | `string[]` | `[]` | Channel/pattern whitelist; empty = accept all |
| `channelBindings[].channelPattern` | `string` | — | Channel pattern (supports `*` wildcard — matches all remaining levels, e.g. `openclaw:*` matches `openclaw:a:b:c`) |
| `channelBindings[].agentId` | `string` | — | Target agent ID |
| `channelBindings[].accountId` | `string` | `"default"` | Account context |
| `channelBindings[].replyChannel` | `string` | — | Reply channel override |

### Field Mapping (stream mode JSON payload)

When `channelMode` is `stream`, the stream entry values are mapped to internal fields. Override these keys to match your entry format:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fieldMapping.textField` | `string` | `"text"` | Entry value key for message text |
| `fieldMapping.agentIdField` | `string` | `"agentId"` | Entry value key for target agent (overrides channel routing) |
| `fieldMapping.peerIdField` | `string` | `"peerId"` | Entry value key for peer identifier |
| `fieldMapping.accountIdField` | `string` | `"accountId"` | Entry value key for account context |
| `fieldMapping.replyStreamField` | `string` | `"replyStream"` | Entry value key for reply stream name |

### Stream (channelMode = "stream")

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `stream.inboundKey` | `string` | `"openclaw:inbound"` | Consumer group read stream |
| `stream.outboundKey` | `string` | `"openclaw:outbound"` | Reply write stream |
| `stream.consumerGroup` | `string` | `"openclaw-group"` | Consumer group name |
| `stream.consumerName` | `string` | `"openclaw-consumer-1"` | This instance's consumer name |
| `stream.blockMs` | `number` | `5000` | `XREADGROUP` block timeout |
| `stream.count` | `number` | `10` | Max messages per batch |
| `stream.createGroup` | `boolean` | `true` | Auto-create consumer group |

### Payload

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `payload.mode` | `"plain" \| "jsonTextOrPlain"` | `"jsonTextOrPlain"` | Parsing mode |

### Connection

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `connection.reconnectMs` | `number` | `3000` | Reconnect delay (ms) |
| `connection.maxRetries` | `number` | `10` | Max reconnect attempts |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `REDIS_URL` | Redis connection URL (overrides `channels.redis-stream.url`) |

## Project Structure

```
openclaw-redis-stream/
├── openclaw.plugin.json   # Plugin manifest
├── package.json           # npm package metadata
├── tsconfig.json          # TypeScript config
├── tsup.config.ts         # Build config (tsup)
├── README.md              # This file
├── README.zh-CN.md           # 简体中文
└── src/
    ├── index.ts           # Entry: defineChannelPluginEntry + HTTP routes
    ├── channel.ts         # ChannelPlugin definition
    ├── types.ts           # All TypeScript types
    ├── dm-scope.ts        # dmScope resolution + session key builder
    ├── session-mapper.ts  # Session mapping + contexts
    ├── topic-router.ts    # Channel → agent route resolution
    ├── inbound.ts         # Inbound message dispatch
    ├── runtime.ts         # PluginRuntime singleton store
    ├── redis-stream-config.ts  # Config resolution + defaults
    ├── redis-stream-server.ts  # Redis transport: Pub/Sub + Stream
    ├── setup-entry.ts     # Lightweight setup-only entry
    ├── dm-scope.test.ts
    ├── config.test.ts
    ├── topic-router.test.ts
    ├── session-mapper.test.ts
    └── channel.test.ts
```

## FAQ

**Q: Pub/Sub or Stream — which should I use?**

A: Use `pubsub` for real-time, fire-and-forget messaging (like chat). Use `stream` when you need consumer groups, message persistence, and replay capabilities (like event sourcing).

**Q: How does session isolation work?**

A: Session keys are built from OpenClaw's global `session.dmScope` config — no custom isolation config needed. Set `session.dmScope` to `per-peer` for per-device isolation, or `per-account-channel-peer` for full multi-tenancy.

**Q: Can I use both Pub/Sub and Stream simultaneously?**

A: Currently, `channelMode` selects one inbound transport. You can run multiple Gateway instances with different modes if needed.

**Q: How does `*` wildcard matching work?**

A: The `*` wildcard is **greedy** — it matches all remaining levels in a channel name. For example, `openclaw:*` matches `openclaw:a`, `openclaw:a:b`, and `openclaw:a:b:c`. This differs from Redis PSUBSCRIBE's `*` which only matches a single segment. If you need exact segment matching, use explicit channel names without wildcards.

**Q: Does this work with Redis Cluster?**

A: Pub/Sub works across Redis Cluster nodes. Stream consumer groups require careful key routing in cluster mode. Single-instance Redis is recommended for Stream mode.

## Tests

```bash
# Unit tests
npm test

# Run specific test
npm test -- -t "dmScope"

# Coverage
npx vitest run --coverage
```

Test prerequisites: a running Redis instance on `localhost:6379` (for integration tests).

## GitHub Actions

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | push, PR | Type check, lint, unit tests |
| `release.yml` | tag push | npm publish to registry |

## Security

- Redis credentials should be provided via the connection URL (`redis://user:pass@host:port`)
- TLS is supported via `rediss://` URL scheme
- Do not hardcode credentials in config files — use environment variables or OpenClaw SecretRefs
- `subscribeChannels` acts as a topic-level ACL whitelist

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js >= 22 |
| Redis Client | [node-redis](https://github.com/redis/node-redis) ^5.12 |
| Build | tsup |
| Test | Vitest |
| Type Check | TypeScript 5.7 |

## Version Information

| Plugin Version | Recommended Node | Minimum OpenClaw |
|---------------|------------------|------------------|
| 0.2.x | >= 22 | >= 2026.4.0 |
| 0.1.x | >= 22 | >= 2026.4.0 |

## Related Links

### Redis Resources

| Resource | URL |
|----------|-----|
| Redis Documentation | https://redis.io/docs/ |
| node-redis GitHub | https://github.com/redis/node-redis |
| Redis Pub/Sub | https://redis.io/docs/latest/develop/interact/pubsub/ |
| Redis Streams | https://redis.io/docs/latest/develop/data-types/streams/ |

### OpenClaw Documentation

| Resource | URL |
|----------|-----|
| Building Plugins | https://docs.openclaw.ai/plugins/building-plugins |
| Channel Plugin SDK | https://docs.openclaw.ai/plugins/sdk-channel-plugins |
| Plugin SDK Overview | https://docs.openclaw.ai/plugins/sdk-overview |
| Plugin Manifest | https://docs.openclaw.ai/plugins/manifest |

## License

MIT

## Acknowledgments

Built on top of [node-redis](https://github.com/redis/node-redis) by the Redis team. Session isolation pattern aligned with OpenClaw's [openclaw-mqtt](https://github.com/partme-ai/openclaw-plugins/tree/main/openclaw-mqtt), [openclaw-stomp](https://github.com/partme-ai/openclaw-plugins/tree/main/openclaw-stomp), and [openclaw-rabbitmq](https://github.com/partme-ai/openclaw-plugins/tree/main/openclaw-rabbitmq) plugins.

---

<div align="center">

⭐ **Star us on GitHub** — your support keeps PartMe going!

</div>

## Message Format Guide

Redis Stream uses the shared OpenClaw queue wire contract for inbound parsing and envelope replies, with additional Stream field mapping for non-standard entries. See [OpenClaw Queue Message Format Guide](../../doc/OpenClaw-Queue-Message-Format-Guide.en.md) for standard `MessageEnvelope` payloads, non-standard normalization, and cross-language SDK adapter guidance.
