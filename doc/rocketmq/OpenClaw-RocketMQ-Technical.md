# Technical Details — openclaw-rocketmq

## Transport Layer (`transport/server.ts`)

### Producer Management

- A long-lived `Producer` instance is created at channel startup
- Configured with `endpoints`, `namespace`, `requestTimeout`, and optional `sessionCredentials`
- `publishMessage()` uses the existing producer when available
- **One-shot fallback**: In subagent/child-process contexts where the module-level producer is null, a temporary `Producer` is created, used for a single send, and shut down

### PushConsumer Management

- A long-lived `PushConsumer` instance listens for inbound messages
- `messageListener.consume()` is the entry point for all inbound processing
- Returns `ConsumeResult.SUCCESS` to ack, `ConsumeResult.FAILURE` to nack
- Reconsume behavior is controlled by `consumer.reconsumeOnError` config

### Connection Lifecycle

```
startRockermqServer()
  └── connectWithRetry()    # 5 attempts, 5s delay between
       └── connectOnce()
            ├── new Producer() → producer.startup()
            └── new PushConsumer() → consumer.startup()

stopRockermqServer()
  ├── consumer.shutdown()
  └── producer.shutdown()
```

### Stats Tracking

Module-level `RockermqStats` object tracks:
- Connection state (`connected`, `lastConnectAt`, `lastDisconnectAt`)
- Message counters (`messagesReceived`, `messagesSent`, `messagesAcked`, `messagesNacked`, `messagesRequeued`)
- Error state (`lastError`, `errors`)
- In-flight count (`inFlight`)

Stats are returned as a shallow copy via `getStats()` to prevent external mutation.

## Routing Algorithm (`topic-router.ts`)

### Resolving Inbound Messages

`resolveInboundRoute(topic, tag, config, peerIdHint?)` operates in two passes:

**Pass 1 — Explicit Bindings** (priority)
```
for each binding in topicBindings:
  if binding.topic === topic:
    if binding.tag === "*" or binding.tag === tag:
      → return route with binding.agentId, binding.accountId
```

**Pass 2 — Standard Format** (fallback)
```
parseStandardTopic(topic, topicPrefix):
  prefix = topicPrefix ? topicPrefix + "--agent--" : "agent--"
  if topic starts with prefix:
    parts = topic.slice(prefix.length).split("--")
    if 2 <= parts.length <= 3 and every part is non-empty:
      agentId = parts[0]
      direction = parts[1]  # "in" or "out"
      peerId = parts[2] or ""
      → return { agentId, direction, peerId }
```

RocketMQ broker resource names are validated against `^[a-zA-Z0-9_-]+$`; `--` is reserved as the standard-route delimiter and cannot appear inside `topicPrefix`, `agentId`, or `peerId` segments.

### Topic Wildcard Matching

`matchTopic(topic, pattern)` supports RabbitMQ-style wildcards:
- `*` or `+` — matches exactly one segment
- `#` — matches zero or more segments (greedy)
- Forward slashes `/` are normalized to `.` before matching

### Reply Topic Derivation

- `buildReplyTopicFromInbound(inboundTopic)`: Replaces trailing `.in` with `.out`, or appends `.out`
- `buildOutboundTopic(agentId, topicPrefix, peerId?)`: Constructs standard outbound topic

## Dispatch Modes

### 1. `reply-pipeline`
Uses OpenClaw's core reply pipeline (`dispatchReplyFromConfig`). The message flows through standard reply middleware with typing indicators, chunking, and channel-aware delivery.

### 2. `embedded-agent`
Runs the agent synchronously within the channel process:
```
rt.agent.runEmbeddedAgent({
  sessionId, sessionKey, agentId,
  sessionFile, workspaceDir, prompt,
  timeoutMs, runId, config
})
→ extractFinalTextFromRunResult()
→ publishMessage(reply)
```

### 3. `subagent`
Spawns an agent in a separate process:
```
rt.subagent.run({ sessionKey, message, deliver: false })
→ rt.subagent.waitForRun({ runId, timeoutMs })
→ publishMessage(reply)
```

## Config Resolution (`config.ts`)

### Resolution Path

Config is read from `channels.rocketmq` (or top-level `rocketmq` as fallback) in the OpenClaw config:

```typescript
resolveRockermqConfig(cfg)
  → cfg.channels.rocketmq ?? cfg.rocketmq ?? {}
  → merge with DEFAULT_ROCKERMQ_CONFIG
```

### Validation Rules

`validateRockermqConfig()` checks:
1. `endpoints` must be non-empty
2. `consumer.groupId` must be non-empty
3. `producer.maxAttempts` and connection retry settings must be positive

Invalid configuration fails channel startup with a combined validation error.

### Credential Masking

`buildRockermqConfigSnapshot()` deeply copies the config and replaces:
- `sessionCredentials.accessKey` → `"***"`
- `sessionCredentials.accessSecret` → `"***"`
- `sessionCredentials.securityToken` → `"***"`

## Idempotency

Enabled by default (`idempotency.enabled: true`):
- Uses `correlationId` from message payload or `messageId` as the key
- Uses a bounded process-local claim/commit cache
- Claims before Agent dispatch, commits only after dispatch and reply publication succeed
- Releases the claim on transient failure so RocketMQ redelivery can retry
- Treats in-flight and committed duplicates as acknowledged duplicates
- Does not provide distributed exactly-once delivery across plugin processes

## Session Mapping (`session-mapper.ts`)

Two in-memory maps maintain routing state:
- `sessionPeerMap: Map<sessionKey, peerId>` — reverse lookup for outbound
- `sessionContextMap: Map<sessionKey, RockermqSessionContext>` — routing metadata

Session keys are generated by OpenClaw core's `resolveAgentRoute()`, not by this plugin.

## Payload Parsing

Three modes for extracting text from inbound message bodies:

| Mode | Behavior |
|------|----------|
| `plainText` | Raw body is used as-is |
| `jsonOnly` | Body is parsed as JSON; uses `text` field or full JSON string |
| `jsonTextOrPlain` | Tries JSON first; if `text` field exists and is non-empty, uses it; otherwise returns raw body |

## Run ID Generation

Uses `crypto.randomBytes(16)` for cryptographically secure run IDs: `{timestamp}-{32 hex chars}`.
