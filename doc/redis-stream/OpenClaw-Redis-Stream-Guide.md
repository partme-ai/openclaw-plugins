# OpenClaw-Redis-Stream Guide (Install Redis + Install openclaw-redis-stream + Integration)

This guide covers the complete path from Redis deployment through `openclaw-redis-stream` plugin installation to end-to-end verification. It is intended for users who want to integrate OpenClaw with Redis Pub/Sub channels and Stream consumer groups.

> Quick terminology:
> - **Pub/Sub**: Real-time fire-and-forget messaging via Redis channels
> - **Stream**: Persistent, replayable message processing via consumer groups
> - **openclaw-redis-stream**: An OpenClaw Channel Plugin that bridges Redis Pub/Sub + Stream into OpenClaw's unified message plane

For architecture details and module design, see:
- [OpenClaw-Redis-Stream-Architecture_CN.md](./OpenClaw-Redis-Stream-Architecture_CN.md)

---

## 1. Prerequisites

- Node.js >= 22
- Redis >= 7.0 (with Pub/Sub support; Streams require Redis >= 5.0, but 7.0+ recommended)
- OpenClaw Gateway >= 2026.4.0

---

## 2. Install Redis

### 2.1 Docker (Recommended)

```bash
docker run -d --name redis \
  -p 6379:6379 \
  --restart unless-stopped \
  redis:7-alpine
```

Verify connectivity:
```bash
docker exec redis redis-cli ping
# Expected: PONG
```

### 2.2 Local Installation

**macOS:**
```bash
brew install redis
brew services start redis
```

**Linux:**
```bash
sudo apt install redis-server
sudo systemctl enable --now redis
```

### 2.3 TLS / Authentication

To use Redis with password authentication or TLS:

```bash
# Password authentication
redis://user:password@host:6379

# TLS encryption
rediss://host:6380

# TLS with authentication
rediss://user:password@host:6380
```

---

## 3. Install openclaw-redis-stream

### 3.1 Via ClawHub (Recommended)

```bash
openclaw plugins install clawhub:@partme.ai/openclaw-redis-stream
```

### 3.2 Via npm

```bash
openclaw plugins install npm:@partme.ai/openclaw-redis-stream
```

### 3.3 Local Development

```bash
git clone https://github.com/partme-ai/openclaw-plugins
cd openclaw-plugins/openclaw-redis-stream
npm install && npm run build
openclaw plugins install --link .
```

---

## 4. Configuration

### 4.1 Minimal Configuration (Pub/Sub only)

```json
{
  "channels": {
    "redis-stream": {
      "url": "redis://localhost:6379",
      "channelMode": "pubsub",
      "subscribeChannels": ["openclaw:agent:*:in"]
    }
  }
}
```

This enables: subscribing to all `openclaw:agent:*:in` channels, auto-routing to the correct agent via standard format.

### 4.2 Pub/Sub with Explicit Bindings

```json
{
  "channels": {
    "redis-stream": {
      "url": "redis://localhost:6379",
      "channelMode": "pubsub",
      "subscribeChannels": ["openclaw:*", "sensor:*"],
      "channelBindings": [
        {
          "channelPattern": "sensor:temperature",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyChannel": "sensor:temperature:response"
        },
        {
          "channelPattern": "chat:*",
          "agentId": "chat-agent"
        }
      ],
      "defaultAgentId": "main"
    }
  }
}
```

### 4.3 Stream Mode (Consumer Group)

```json
{
  "channels": {
    "redis-stream": {
      "url": "redis://localhost:6379",
      "channelMode": "stream",
      "defaultAgentId": "main",
      "stream": {
        "inboundKey": "openclaw:inbound",
        "outboundKey": "openclaw:outbound",
        "consumerGroup": "openclaw-group",
        "consumerName": "openclaw-consumer-1",
        "blockMs": 5000,
        "count": 10,
        "createGroup": true
      },
      "fieldMapping": {
        "textField": "text",
        "agentIdField": "agentId",
        "peerIdField": "peerId"
      }
    }
  }
}
```

### 4.4 Environment Variable Override

```bash
export REDIS_URL="redis://prod-redis:6379"
```
The `REDIS_URL` environment variable takes precedence over `channels.redis-stream.url` in the config file.

---

## 5. Channel Rules

### Standard Format (Auto-Detected)

| Direction | Format | Example |
|-----------|--------|---------|
| Inbound | `openclaw:agent:<agentId>:in` | `openclaw:agent:main:in` |
| Outbound | `openclaw:agent:<agentId>:out` | `openclaw:agent:main:out` |

Standard format channels are auto-detected — no explicit binding needed.

### Explicit Bindings

Defined in `channelBindings`, highest routing priority:

| Field | Required | Description |
|-------|----------|-------------|
| `channelPattern` | Yes | Channel pattern with `*` wildcard support |
| `agentId` | Yes | Target agent ID |
| `accountId` | No | Account context (default: `"default"`) |
| `replyChannel` | No | Override reply channel |

### Routing Priority

```
fieldAgentId (Stream field override)
  > channelBindings (explicit match)
    > standard format (openclaw:agent:<agentId>:in)
      > defaultAgentId (fallback)
        > drop (no match)
```

### Wildcard Matching

The `*` wildcard is **greedy** — it matches all remaining colon-delimited segments:

| Pattern | Channel | Match? |
|---------|---------|--------|
| `sensor:*` | `sensor:temperature` | Yes |
| `sensor:*` | `sensor:temperature:bedroom` | Yes |
| `sensor:*` | `other:channel` | No |
| `openclaw:agent:*` | `openclaw:agent:bot1:in` | Yes |
| `*` | `any:channel:name` | Yes |

---

## 6. Session Isolation (dmScope)

Session keys are built from OpenClaw's global `session.dmScope` config. The default is `per-peer`.

| dmScope | Session Key Format | Use Case |
|---------|-------------------|----------|
| `per-peer` (default) | `agent:<id>:direct:<peer>` | Per-device/channel isolation |
| `main` | `agent:<id>:main` | Shared session for all messages |
| `per-channel-peer` | `agent:<id>:<channel>:direct:<peer>` | Per-channel isolation |
| `per-account-channel-peer` | `agent:<id>:<channel>:<acct>:direct:<peer>` | Full multi-tenancy |

Configure dmScope in OpenClaw:
```json
{
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

The `peerId` defaults to the Redis channel name. In Stream mode, it can be overridden via `fieldMapping.peerIdField`.

---

## 7. Verification

### 7.1 Run Tests

```bash
cd openclaw-redis-stream
npm install && npm run typecheck && npm run build && npm test
```

### 7.2 Health Check

```bash
curl http://localhost:<gateway-port>/redis-stream/health
```

Expected response:
```json
{
  "ok": true,
  "healthy": true,
  "data": {
    "connected": true,
    "messagesRead": 10,
    "messagesWritten": 5,
    "messagesAcked": 10
  },
  "sessions": { "peerCount": 2, "sessionCount": 2, "contextCount": 2 }
}
```

### 7.3 Status Endpoint

```bash
curl http://localhost:<gateway-port>/redis-stream/status
```

Returns full config (with password redacted), stats, and session details.

### 7.4 Manual Pub/Sub Test

```bash
# Terminal 1: Subscribe to the reply channel
redis-cli SUBSCRIBE openclaw:agent:main:out

# Terminal 2: Publish a test message
redis-cli PUBLISH openclaw:agent:main:in "Hello from Redis!"
```

If configured correctly, you should see the agent's reply appear in Terminal 1.

### 7.5 Manual Stream Test

```bash
# Add a message to the inbound stream
redis-cli XADD openclaw:inbound "*" text "Hello" agentId "main"

# Read the reply
redis-cli XREAD BLOCK 5000 STREAMS openclaw:outbound 0
```

---

## 8. Application Scenarios

### 8.1 Real-Time AI Chat

Use Pub/Sub mode for real-time bidirectional chat with AI agents.

```
Client → PUBLISH openclaw:agent:main:in → Redis → Plugin → Agent
Agent → Plugin → PUBLISH openclaw:agent:main:out → Redis → Client
```

### 8.2 Event-Driven Agent Pipeline

Use Stream mode for reliable event processing with at-least-once delivery.

```
Producer → XADD openclaw:inbound → Consumer Group → Plugin → Agent
Agent → Plugin → XADD openclaw:outbound → Consumer reads reply
Plugin → XACK → Message confirmed
```

### 8.3 IoT Data Processing

```json
{
  "subscribeChannels": ["sensor:*"],
  "channelBindings": [
    { "channelPattern": "sensor:temperature", "agentId": "iot-agent" },
    { "channelPattern": "sensor:humidity", "agentId": "iot-agent" }
  ],
  "defaultAgentId": "main"
}
```

IoT sensors publish to Redis channels; the plugin routes to the correct agent for processing.

### 8.4 Multi-Service Communication

Different microservices communicate through Redis channels, each routed to its own AI agent:

```
Service A → openclaw:agent:service-a:in → agent:service-a
Service B → openclaw:agent:service-b:in → agent:service-b
Generic   → random:channel → defaultAgentId: main
```

---

## 9. Troubleshooting

### Connection Failed

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```
- Verify Redis is running: `redis-cli ping`
- Check the URL configuration matches your Redis instance
- For TLS, ensure the `rediss://` scheme is used

### No Route Matched

```
[openclaw-redis-stream] No route matched for channel: xxx
```
- Add a `channelBindings` entry for the channel
- Use standard format: `openclaw:agent:<agentId>:in`
- Configure `defaultAgentId` as a fallback
- Check `subscribeChannels` whitelist includes the channel pattern

### Messages Not Received

- Verify `subscribeChannels` includes the channel (empty = all channels)
- Check that `channelMode` matches your usage (pubsub vs stream)
- For Stream mode, verify the consumer group was created
- Check the plugin is enabled: `openclaw plugins list | grep redis-stream`

### Self-Loop / Echo

The plugin automatically filters channels ending with `:out` and the `openclaw:agent:outbound` channel to prevent self-loop. If you're using custom reply channels, make sure they don't match your inbound subscriptions.

---

## 10. Configuration Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | `string` | — | Redis connection URL (required) |
| `channelMode` | `"pubsub" \| "stream"` | `"pubsub"` | Inbound transport mode |
| `defaultAgentId` | `string` | `""` | Fallback agent when no route matches |
| `subscribeChannels` | `string[]` | `[]` | Channel whitelist (empty = all) |
| `channelBindings[].channelPattern` | `string` | — | Pattern with `*` support |
| `channelBindings[].agentId` | `string` | — | Target agent |
| `channelBindings[].accountId` | `string` | `"default"` | Account context |
| `channelBindings[].replyChannel` | `string` | — | Reply channel override |
| `payload.mode` | `"plain" \| "jsonTextOrPlain"` | `"jsonTextOrPlain"` | Payload parsing |
| `fieldMapping.textField` | `string` | `"text"` | Stream value key for text |
| `fieldMapping.agentIdField` | `string` | `"agentId"` | Stream value key for agent |
| `fieldMapping.peerIdField` | `string` | `"peerId"` | Stream value key for peer |
| `fieldMapping.accountIdField` | `string` | `"accountId"` | Stream value key for account |
| `fieldMapping.replyStreamField` | `string` | `"replyStream"` | Stream value key for reply stream |
| `stream.inboundKey` | `string` | `"openclaw:inbound"` | Consumer group read stream |
| `stream.outboundKey` | `string` | `"openclaw:outbound"` | Reply write stream |
| `stream.consumerGroup` | `string` | `"openclaw-group"` | Consumer group name |
| `stream.consumerName` | `string` | `"openclaw-consumer-1"` | Instance consumer name |
| `stream.blockMs` | `number` | `5000` | XREADGROUP block timeout |
| `stream.count` | `number` | `10` | Max messages per batch |
| `stream.createGroup` | `boolean` | `true` | Auto-create consumer group |
| `connection.reconnectMs` | `number` | `3000` | Reconnect delay in ms |
| `connection.maxRetries` | `number` | `10` | Max reconnect attempts |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `REDIS_URL` | Redis connection URL (overrides config file) |

---

**Document Version**: 1.0.0
**Last Updated**: 2026-05-19
**Maintainer**: PartMe.AI
