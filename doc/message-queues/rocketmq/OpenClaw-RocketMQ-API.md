# API Reference — openclaw-rockermq

## HTTP Endpoints

All endpoints are served under the OpenClaw Gateway at `http://127.0.0.1:18790`.

**Authentication**: Bearer token (`Authorization: Bearer <gateway-token>`)

**Auth scope**: `plugin` (accessible to authenticated plugin routes)

---

### GET /rockermq/health

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

**Health logic**: `healthy = connected && lastError === null`

---

### GET /rockermq/stats

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

### GET /rockermq/status

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
        "accessKey": "ak-xxx",
        "accessSecret": "***",
        "securityToken": "***"
      },
      "producer": { "groupId": "...", "requestTimeout": 5000 },
      "consumer": { "groupId": "...", "subscriptions": [...], ... },
      "topicBindings": [...],
      "payload": { "mode": "jsonTextOrPlain" },
      "dispatch": { "mode": "...", "timeoutMs": 120000, "reply": {...} },
      "idempotency": { "enabled": false, "ttlMs": 600000, "maxEntries": 10000 }
    }
  }
}
```

**Security**: `sessionCredentials.accessSecret` and `securityToken` are always masked as `"***"`.

---

## Debug Tool: `mq.publish`

Registered as a plugin tool, accessible to agents.

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `topic` | string | yes | Target RocketMQ topic |
| `tag` | string | no | Message tag filter |
| `payload` | any | yes | Message payload (string or object) |
| `keys` | string[] | no | Message keys for partition routing |

### Response

```json
{
  "content": [{
    "type": "text",
    "text": "{\n  \"ok\": true,\n  \"topic\": \"...\",\n  \"tag\": \"...\",\n  \"receipt\": {...}\n}"
  }]
}
```

---

## Config Schema Reference

### `channels.rockermq`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `endpoints` | string | `"127.0.0.1:8081"` | RocketMQ proxy address (required) |
| `namespace` | string | `""` | RocketMQ namespace |
| `topicPrefix` | string | `"openclaw"` | Prefix for standard topic format |
| `sessionCredentials` | object | — | ACL credentials |
| `sessionCredentials.accessKey` | string | — | Access key |
| `sessionCredentials.accessSecret` | string | — | Access secret (sensitive) |
| `sessionCredentials.securityToken` | string | — | Security token (sensitive, optional) |
| `producer.groupId` | string | `"openclaw-rockermq-producer"` | Producer group ID |
| `producer.requestTimeout` | number | `5000` | Send timeout in ms |
| `consumer.groupId` | string | `"openclaw-rockermq-consumer"` | Consumer group ID |
| `consumer.subscriptions` | array | `[]` | Topic subscriptions |
| `consumer.subscriptions[].topic` | string | — | Topic name |
| `consumer.subscriptions[].filterExpression` | string | `"*"` | Tag filter |
| `consumer.maxCacheMessageCount` | number | `1024` | Max cached messages |
| `consumer.maxCacheMessageSizeInBytes` | number | `67108864` | Max cache size (64 MB) |
| `consumer.longPollingTimeout` | number | `30000` | Long polling timeout in ms |
| `consumer.requestTimeout` | number | `3000` | Consumer request timeout in ms |
| `consumer.reconsumeOnError` | boolean | `true` | Reconsume on dispatch error |
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
| `idempotency.enabled` | boolean | `false` | Enable idempotency dedup |
| `idempotency.ttlMs` | number | `600000` | Dedup key TTL (10 min) |
| `idempotency.maxEntries` | number | `10000` | Max dedup entries |

---

## TypeScript Types

### `RockermqConfig`
Full config type — see `src/rockermq-config.ts`.

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
