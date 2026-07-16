# API Reference — openclaw-rocketmq

## HTTP Endpoints

All endpoints are served under the OpenClaw Gateway at `http://127.0.0.1:18790`.

**Authentication**: Bearer token (`Authorization: Bearer <gateway-token>`)

**Auth scope**: `plugin` (accessible to authenticated plugin routes)

---

### GET /rocketmq/health

Returns the connection health status of the RocketMQ plugin.

**Response 200** (healthy):
```json
{
  "ok": true,
  "healthy": true,
  "data": {
    "connected": true,
    "lastConnectAt": 1779123254777,
    "lastDisconnectAt": null,
    "lastConsumeAt": null,
    "lastError": null,
    "messagesReceived": 42,
    "messagesSent": 15,
    "messagesAcked": 40,
    "messagesNacked": 2,
    "messagesRequeued": 1,
    "messagesDeadLettered": 0,
    "errors": 0,
    "inFlight": 2
  }
}
```

**Response 503** (unhealthy):
```json
{
  "ok": true,
  "healthy": false,
  "data": {
    "connected": false,
    "lastError": "Connection refused",
    ...
  }
}
```

**Health logic**: `healthy = connected`. `lastError` remains diagnostic history and does not permanently poison health after recovery.

---

### GET /rocketmq/stats

Returns message statistics and session counts.

```json
{
  "ok": true,
  "data": {
    "stats": { /* RockermqStats — same shape as /health data */ },
    "sessions": {
      "activeSessions": 3,
      "uniquePeers": 2,
      "contextBoundSessions": 3
    }
  }
}
```

---

### GET /rocketmq/status

Returns full plugin status including config snapshot and session mappings.

```json
{
  "ok": true,
  "data": {
    "stats": { /* RockermqStats */ },
    "sessions": { /* SessionStats */ },
    "mappings": [
      {
        "peerId": "device-001",
        "sessionKey": "agent:main:direct:device-001",
        "context": {
          "peerId": "device-001",
          "agentId": "main",
          "accountId": "default",
          "lastInboundTopic": "openclaw-agent-main-in",
          "replyTopic": "openclaw-agent-main-out",
          "updatedAt": 1779123456789
        }
      }
    ],
    "config": {
      "endpoints": "127.0.0.1:8081",
      "namespace": "",
      "topicPrefix": "openclaw",
      "sessionCredentials": {
        "accessKey": "***",
        "accessSecret": "***",
        "securityToken": "***"
      },
      "producer": { "groupId": "...", "requestTimeout": 5000, "maxAttempts": 3 },
      "consumer": { "groupId": "...", "subscriptions": [...], ... },
      "topicBindings": [...],
      "payload": { "mode": "jsonTextOrPlain" },
      "dispatch": { "mode": "...", "timeoutMs": 120000, "reply": {...} },
      "idempotency": { "enabled": true, "ttlMs": 600000, "maxEntries": 10000 },
      "connection": { "startupAttempts": 6, "retryDelayMs": 5000 }
    }
  }
}
```

**Security**: `sessionCredentials.accessKey`, `accessSecret`, and `securityToken` are always masked as `"***"`.

---

## Delivery Contract

The channel does not register a generic publish tool. Agent replies are emitted by the channel outbound adapter. A transient dispatch or reply-publication failure returns `ConsumeResult.FAILURE`; after `consumer.retry.maxAttempts`, the plugin forwards the message through the RocketMQ Consumer Group DLQ API and acknowledges the source message only after that succeeds.

---

## Config Schema Reference

### `channels.rocketmq`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `endpoints` | string | `"127.0.0.1:8081"` | RocketMQ proxy address (required) |
| `namespace` | string | `""` | RocketMQ namespace |
| `topicPrefix` | string | `"openclaw"` | Prefix for standard topic format |
| `sessionCredentials` | object | — | ACL credentials |
| `sessionCredentials.accessKey` | string | — | Access key |
| `sessionCredentials.accessSecret` | string | — | Access secret (sensitive) |
| `sessionCredentials.securityToken` | string | — | Security token (sensitive, optional) |
| `producer.groupId` | string | `"openclaw-rocketmq-producer"` | Deprecated compatibility label; unused by the RocketMQ 5 Node Producer |
| `producer.requestTimeout` | number | `5000` | Send timeout in ms |
| `producer.maxAttempts` | number | `3` | Producer send attempts |
| `consumer.groupId` | string | `"openclaw-rocketmq-consumer"` | Consumer group ID |
| `consumer.subscriptions` | array | `[]` | Topic subscriptions |
| `consumer.subscriptions[].topic` | string | — | Topic name |
| `consumer.subscriptions[].filterExpression` | string | `"*"` | Tag filter |
| `consumer.maxCacheMessageCount` | number | `1024` | Max cached messages |
| `consumer.maxCacheMessageSizeInBytes` | number | `67108864` | Max cache size (64 MB) |
| `consumer.longPollingTimeout` | number | `30000` | Long polling timeout in ms |
| `consumer.requestTimeout` | number | `3000` | Consumer request timeout in ms |
| `consumer.reconsumeOnError` | boolean | `true` | Reconsume on dispatch error |
| `consumer.retry.maxAttempts` | number | `17` | Maximum delivery attempts exposed to retry/DLQ handling |
| `consumer.retry.initialDelayMs` | number | `1000` | Initial redelivery delay |
| `consumer.retry.maxDelayMs` | number | `60000` | Maximum redelivery delay |
| `consumer.retry.multiplier` | number | `2` | Exponential delay multiplier |
| `topicBindings` | array | `[]` | Explicit topic → agent mappings |
| `topicBindings[].topic` | string | — | Topic name (required) |
| `topicBindings[].tag` | string | `"*"` | Tag filter |
| `topicBindings[].agentId` | string | — | Target agent ID (required) |
| `topicBindings[].accountId` | string | `"default"` | Account identifier |
| `topicBindings[].peerId` | string | — | Peer identifier for session routing |
| `topicBindings[].replyTopic` | string | — | Custom reply topic |
| `topicBindings[].replyTag` | string | — | Custom reply tag |
| `payload.mode` | enum | `"jsonTextOrPlain"` | `jsonTextOrPlain` / `jsonOnly` / `plainText` |
| `dispatch.mode` | enum | `"embedded-agent"` | `reply-pipeline` / `embedded-agent` / `subagent` |
| `dispatch.timeoutMs` | number | `120000` | Agent dispatch timeout in ms |
| `dispatch.reply.enabled` | boolean | `true` | Enable reply publishing |
| `idempotency.enabled` | boolean | `true` | Enable process-local claim/commit dedup |
| `idempotency.ttlMs` | number | `600000` | Dedup key TTL (10 min) |
| `idempotency.maxEntries` | number | `10000` | Max dedup entries |
| `connection.startupAttempts` | number | `6` | Producer/consumer startup attempts |
| `connection.retryDelayMs` | number | `5000` | Delay between startup attempts in ms |

---

## TypeScript Types

### `RockermqConfig`
Full config type — see `src/config.ts`.

### `RockermqStats`
```typescript
type RockermqStats = {
  connected: boolean;
  lastConnectAt: number | null;
  lastDisconnectAt: number | null;
  lastConsumeAt: number | null;
  lastError: string | null;
  messagesReceived: number;
  messagesSent: number;
  messagesAcked: number;
  messagesNacked: number;
  messagesRequeued: number;
  messagesDropped: number;
  lastDropReason: string | null;
  messagesDeadLettered: number;
  errors: number;
  inFlight: number;
};
```

### `InboundEvent`
```typescript
type InboundEvent = {
  topic: string;
  tag?: string;
  body: Buffer;
  keys?: string[];
  messageId?: string;
  deliveryAttempt?: number;
};
```

### `RockermqSessionContext`
```typescript
interface RockermqSessionContext {
  peerId: string;
  agentId: string;
  accountId: string;
  lastInboundTopic?: string;
  lastInboundTag?: string;
  replyTopic?: string;
  replyTag?: string;
  updatedAt: number;
}
```
