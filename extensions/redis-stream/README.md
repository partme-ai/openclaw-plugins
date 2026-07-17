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
- **Reliable Stream processing**: ACK after successful dispatch, stale PEL reclaim, bounded retries, and atomic dead-letter transfer
- **HTTP health/status endpoints**: `/redis-stream/health` and `/redis-stream/status` for monitoring

## Lifecycle

1. **Gateway startup** → Plugin loads, registers `redis-stream` channel
2. **Account start** → Connects to Redis, subscribes to channels (Pub/Sub mode) or creates consumer group (Stream mode)
3. **Message reception** → Inbound messages go through whitelist filtering → route resolution → dmScope session mapping → agent dispatch
4. **Agent reply** → Outbound text published via `PUBLISH` (Pub/Sub mode) or `XADD` (Stream mode)
5. **Gateway shutdown** → Unsubscribes, quits Redis connections

## Message Processing Flow

### Dual-mode architecture

The character view gives a fast reliability overview; the Mermaid view below preserves the renderable component graph:

```text
┌────────────────────────────── Redis ───────────────────────────────────────┐
│ Pub/Sub: PUBLISH → SUBSCRIBE ───────────────┐  at-most-once               │
│ Stream:  XADD → Consumer Group → PEL ───────┤  at-least-once              │
│                  ▲             └─ max attempts → DLQ + XACK (MULTI)       │
│                  └──────────── XAUTOCLAIM ───┘                             │
└──────────────────────────────────────────────┬────────────────────────────┘
                                               ▼
┌──────────────────────── openclaw-redis-stream ────────────────────────────┐
│ filter → route → claimable dedupe → bounded Agent turn → PUBLISH / XADD  │
│ stop: halt intake → drain accepted work → clear publisher → close Redis  │
└──────────────────────────────────────────────┬────────────────────────────┘
                                               ▼
                                  OpenClaw Runtime / Agent
```

```mermaid
flowchart LR
    E["External system"] --> M{"channelMode"}
    M -->|"pubsub"| PS["Redis Pub/Sub<br/>real-time, non-durable"]
    M -->|"stream"| XS["Redis Stream<br/>durable consumer group"]
    PS --> G["subscription filter / route / session"]
    XS --> G
    G --> L{"in-flight limit"}
    L -->|"accepted"| A["OpenClaw Runtime / Agent"]
    L -->|"Pub/Sub overloaded"| DROP["reject and count failure"]
    A --> O{"reply transport"}
    O -->|"PUBLISH, subscribers > 0"| PR["online subscriber"]
    O -->|"PUBLISH, subscribers = 0"| FAIL["delivery failure"]
    O -->|"XADD"| OUT["durable reply stream"]
    XS --> PEL["PEL"]
    PEL -->|"XAUTOCLAIM"| G
    PEL -->|"maxAttempts"| DLQ["dead-letter stream"]
```

### Bounded Gateway shutdown

```text
Gateway abort
      │
      ├── destroy Subscriber / Consumer (stop intake)
      ▼
drain active Stream work + accepted Pub/Sub tasks (one shutdownTimeoutMs budget)
      │
      ├── drained ──→ clear publisher ──→ QUIT main client
      └── timeout
           ├── Stream: no XACK; keep entry in PEL for XAUTOCLAIM
           ├── Pub/Sub: warn that the outcome is unknown
           └── clear publisher ──→ DESTROY main client
```

```mermaid
flowchart TD
    A["Gateway abort"] --> S["Destroy Subscriber / Consumer<br/>stop new intake"]
    S --> W["Drain active Stream work<br/>and accepted Pub/Sub tasks"]
    W -->|"completed in budget"| C["Clear publisher"]
    C --> Q["QUIT main client"]
    W -->|"shutdownTimeoutMs reached"| T["Emit observable timeout warning"]
    T --> P["Stream: no XACK<br/>entry remains in PEL"]
    T --> U["Pub/Sub: outcome unknown"]
    P --> D["Clear publisher / DESTROY main client"]
    U --> D
```

Pub/Sub and Stream deliberately expose different delivery guarantees. Pub/Sub overload is bounded by
`connection.maxPubSubInFlight`, and a reply with zero active subscribers is reported as failed. Use Stream
mode when messages must survive consumer downtime or overload.

### Stream retry and dead-letter sequence

```mermaid
sequenceDiagram
    autonumber
    participant R as Redis Stream
    participant P as Redis Stream plugin
    participant A as OpenClaw Agent
    R->>P: XREADGROUP (entry enters PEL)
    P->>A: dispatchChannelMessage
    alt Agent and reply XADD succeed
        A-->>P: reply
        P->>R: XADD reply stream
        P->>R: XACK inbound entry
    else Dispatch or reply fails
        P-->>R: keep entry in PEL
        R->>P: XAUTOCLAIM after idle timeout
        alt delivery count below maxAttempts
            P->>A: retry dispatch
        else retries exhausted
            P->>R: MULTI: XADD DLQ + XACK inbound
            R-->>P: EXEC atomically in one hash slot
        end
    end
```

1. Redis message received through Pub/Sub or `XREADGROUP`
2. Whitelist check: if `subscribeChannels` is non-empty, only matched channels are processed
3. Route resolution: `channelBindings` checked first (explicit match), then standard `openclaw:agent:<agentId>:in` format
4. dmScope read from OpenClaw global config (`session.dmScope`)
5. Session key built: `agent:<agentId>:<dmScope_suffix>`
6. Session context updated (channel, replyChannel, peerId)
7. Agent dispatch → `rt.channel.reply.dispatchReplyFromConfig`
8. Reply sent with `PUBLISH` in Pub/Sub mode or durable `XADD` in Stream mode

## Quick Start

### Prerequisites

- Node.js >= 22
- Redis >= 7.0 (with Pub/Sub support)
- OpenClaw Gateway >= 2026.7.1

### Install

```bash
# Recommended — ClawHub
openclaw plugins install clawhub:@partme.ai/openclaw-redis-stream

# Transitional — npm
openclaw plugins install npm:@partme.ai/openclaw-redis-stream
```

Requires `@partme.ai/openclaw-message-sdk >= 2026.7.1`.

### Minimal Configuration

```jsonc
{
  "channels": {
    "redis-stream": {
      "url": "redis://localhost:6379",
      "channelMode": "stream",
      "defaultAgentId": "main",
      "stream": {
        "inboundKey": "openclaw:{agent}:inbound",
        "outboundKey": "openclaw:{agent}:outbound",
        "deadLetterKey": "openclaw:{agent}:inbound:dlq",
      },
    },
  },
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

| Type              | Format                                          | Notes                                          |
| ----------------- | ----------------------------------------------- | ---------------------------------------------- |
| Standard inbound  | `openclaw:agent:<agentId>:in`                   | Auto-detected, no binding needed               |
| Standard outbound | `openclaw:agent:<agentId>:out`                  | Derived from inbound                           |
| Explicit binding  | Any channel pattern (e.g. `sensor:temperature`) | Defined in `channelBindings`, highest priority |

**Routing priority**: `channelBindings` > standard format. If no route matches, the message is silently dropped.

Channel patterns support `*` wildcard matching (glob-style, colon-delimited). A standalone `*` matches all remaining segments.

## Configuration Reference

### Required

| Field | Type     | Default | Description          |
| ----- | -------- | ------- | -------------------- |
| `url` | `string` | —       | Redis connection URL |

### Channel Mode

| Field                              | Type                   | Default     | Description                                                                                                        |
| ---------------------------------- | ---------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `channelMode`                      | `"pubsub" \| "stream"` | `"pubsub"`  | Inbound message transport                                                                                          |
| `defaultAgentId`                   | `string`               | `""`        | Fallback agent ID when no binding/standard-format matches. Empty = drop unroutable messages                        |
| `subscribeChannels`                | `string[]`             | `[]`        | Channel/pattern whitelist; empty = accept all                                                                      |
| `channelBindings[].channelPattern` | `string`               | —           | Channel pattern (supports `*` wildcard — matches all remaining levels, e.g. `openclaw:*` matches `openclaw:a:b:c`) |
| `channelBindings[].agentId`        | `string`               | —           | Target agent ID                                                                                                    |
| `channelBindings[].accountId`      | `string`               | `"default"` | Account context                                                                                                    |
| `channelBindings[].replyChannel`   | `string`               | —           | Reply channel override                                                                                             |

### Field Mapping (stream mode JSON payload)

When `channelMode` is `stream`, the stream entry values are mapped to internal fields. Override these keys to match your entry format:

| Field                           | Type     | Default         | Description                                                  |
| ------------------------------- | -------- | --------------- | ------------------------------------------------------------ |
| `fieldMapping.textField`        | `string` | `"text"`        | Entry value key for message text                             |
| `fieldMapping.agentIdField`     | `string` | `"agentId"`     | Entry value key for target agent (overrides channel routing) |
| `fieldMapping.peerIdField`      | `string` | `"peerId"`      | Entry value key for peer identifier                          |
| `fieldMapping.accountIdField`   | `string` | `"accountId"`   | Entry value key for account context                          |
| `fieldMapping.replyStreamField` | `string` | `"replyStream"` | Entry value key for reply stream name                        |

### Stream (channelMode = "stream")

| Field                       | Type      | Default                  | Description                                                           |
| --------------------------- | --------- | ------------------------ | --------------------------------------------------------------------- |
| `stream.inboundKey`         | `string`  | `"openclaw:inbound"`     | Consumer group read stream                                            |
| `stream.outboundKey`        | `string`  | `"openclaw:outbound"`    | Reply write stream                                                    |
| `stream.consumerGroup`      | `string`  | `"openclaw-group"`       | Consumer group name                                                   |
| `stream.consumerName`       | `string`  | `""`                     | Unique consumer name; empty derives hostname + process ID             |
| `stream.blockMs`            | `number`  | `5000`                   | `XREADGROUP` block timeout                                            |
| `stream.count`              | `number`  | `10`                     | Max messages per batch                                                |
| `stream.createGroup`        | `boolean` | `true`                   | Auto-create consumer group                                            |
| `stream.pendingClaimIdleMs` | `number`  | `180000`                 | Reclaim stale PEL entries; must exceed Agent timeout; `0` disables it |
| `stream.maxAttempts`        | `number`  | `5`                      | Delivery attempts before dead-lettering                               |
| `stream.deadLetterKey`      | `string`  | `"openclaw:inbound:dlq"` | Dead-letter Stream key                                                |
| `stream.maxLen`             | `number`  | `100000`                 | Approximate max length for outbound and DLQ streams; `0` is unlimited |

### Payload

| Field          | Type                           | Default             | Description  |
| -------------- | ------------------------------ | ------------------- | ------------ |
| `payload.mode` | `"plain" \| "jsonTextOrPlain"` | `"jsonTextOrPlain"` | Parsing mode |

### Connection

| Field                             | Type      | Default | Description                                                                                |
| --------------------------------- | --------- | ------- | ------------------------------------------------------------------------------------------ |
| `connection.allowInsecureRemote`  | `boolean` | `false` | Allow plaintext `redis://` for remote hosts; keep false in production                      |
| `connection.reconnectMs`          | `number`  | `3000`  | Exponential-backoff base delay (ms)                                                        |
| `connection.reconnectMaxMs`       | `number`  | `30000` | Exponential-backoff maximum delay (ms)                                                     |
| `connection.reconnectJitterRatio` | `number`  | `0.2`   | Jitter ratio used to reduce reconnect stampedes                                            |
| `connection.maxRetries`           | `number`  | `0`     | Max reconnect attempts; `0` retries indefinitely                                           |
| `connection.maxPubSubInFlight`    | `number`  | `32`    | Maximum concurrent Pub/Sub messages admitted into the Agent pipeline; overload is rejected |
| `connection.startupTimeoutMs`     | `number`  | `30000` | Connection startup timeout                                                                 |
| `connection.shutdownTimeoutMs`    | `number`  | `10000` | Total accepted-work drain and main-client shutdown budget; destroys the socket on timeout  |

### Agent Pipeline

| Field                         | Type     | Default  | Description                                                                 |
| ----------------------------- | -------- | -------- | --------------------------------------------------------------------------- |
| `network.agentReplyTimeoutMs` | `number` | `120000` | Total Agent-turn/reply timeout; Stream reclaim idle must be greater than it |

### Idempotency

| Field                    | Type      | Default  | Description                            |
| ------------------------ | --------- | -------- | -------------------------------------- |
| `idempotency.enabled`    | `boolean` | `true`   | Claim Stream entry IDs before dispatch |
| `idempotency.ttlMs`      | `number`  | `600000` | Completed-entry retention window       |
| `idempotency.maxEntries` | `number`  | `10000`  | In-process cache bound                 |

## Reliability and Deployment Notes

- Stream entries are ACKed only after Agent dispatch and reply delivery complete. Failed entries remain in the PEL and are reclaimed after `pendingClaimIdleMs`. Configuration rejects a reclaim idle value shorter than or equal to the Agent timeout, preventing another consumer from reclaiming an active turn.
- Remote Redis endpoints require `rediss://` by default. Plaintext remote connections require explicit `connection.allowInsecureRemote=true` acknowledgement.
- At `maxAttempts`, the original entry and failure metadata are appended to `deadLetterKey`, then ACKed in the same Redis transaction.
- Every Gateway replica needs a unique `consumerName`; leaving it empty generates one from hostname and process ID.
- `inboundKey` and `deadLetterKey` must share a Redis Cluster hash tag for atomic dead-letter transfer, for example `openclaw:{agent}:inbound` and `openclaw:{agent}:inbound:dlq`.
- The plugin uses a single-endpoint node-redis client; native Redis Cluster topology discovery is not supported. Use a standalone/HA endpoint or a compatible proxy.
- Pub/Sub mode is intentionally at-most-once: it has no ACK, replay, dead letter, or overload recovery. Use Stream mode for production workflows that cannot lose messages.
- Pub/Sub processing is capped by `maxPubSubInFlight`. Messages received beyond the cap are rejected and counted as failures instead of creating unbounded Agent turns.
- `PUBLISH` replies/outbound messages fail when Redis reports zero active subscribers; command execution alone is not reported as successful delivery.
- `shutdownTimeoutMs` is one shared budget for accepted-work drain and main-client close. On timeout, Stream work is left unacknowledged in the PEL for reclaim, Pub/Sub reports an unknown outcome, and the socket is destroyed so Gateway termination stays bounded.
- Idempotency is process-local and prevents duplicate work within one plugin process; it does not provide cross-node exactly-once semantics.

### Environment Variables

| Variable    | Description                                                  |
| ----------- | ------------------------------------------------------------ |
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
    ├── config.ts          # Config validation, resolution + defaults
    ├── transport/         # Redis publisher and Pub/Sub/Stream lifecycle
    ├── routing/           # Topic routing and session mapping
    ├── shared/            # Errors, logging, dmScope and idempotency helpers
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

| Workflow      | Trigger  | Purpose                      |
| ------------- | -------- | ---------------------------- |
| `ci.yml`      | push, PR | Type check, lint, unit tests |
| `release.yml` | tag push | npm publish to registry      |

## Security

- Redis credentials should be provided via the connection URL (`redis://user:pass@host:port`)
- TLS is supported via `rediss://` URL scheme
- Do not hardcode credentials in config files — use environment variables or OpenClaw SecretRefs
- `subscribeChannels` acts as a topic-level ACL whitelist

## Tech Stack

| Layer        | Technology                                              |
| ------------ | ------------------------------------------------------- |
| Runtime      | Node.js >= 22                                           |
| Redis Client | [node-redis](https://github.com/redis/node-redis) ^5.12 |
| Build        | tsup                                                    |
| Test         | Vitest                                                  |
| Type Check   | TypeScript 5.7                                          |

## Version Information

| Plugin Version | Recommended Node | Minimum OpenClaw |
| -------------- | ---------------- | ---------------- |
| 0.2.x          | >= 22            | >= 2026.4.0      |
| 0.1.x          | >= 22            | >= 2026.4.0      |

## Related Links

### Redis Resources

| Resource            | URL                                                      |
| ------------------- | -------------------------------------------------------- |
| Redis Documentation | https://redis.io/docs/                                   |
| node-redis GitHub   | https://github.com/redis/node-redis                      |
| Redis Pub/Sub       | https://redis.io/docs/latest/develop/interact/pubsub/    |
| Redis Streams       | https://redis.io/docs/latest/develop/data-types/streams/ |

### OpenClaw Documentation

| Resource            | URL                                                  |
| ------------------- | ---------------------------------------------------- |
| Building Plugins    | https://docs.openclaw.ai/plugins/building-plugins    |
| Channel Plugin SDK  | https://docs.openclaw.ai/plugins/sdk-channel-plugins |
| Plugin SDK Overview | https://docs.openclaw.ai/plugins/sdk-overview        |
| Plugin Manifest     | https://docs.openclaw.ai/plugins/manifest            |

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
