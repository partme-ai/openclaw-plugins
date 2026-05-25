# OpenClaw Queue Message Format Guide

This guide explains how OpenClaw queue plugins handle standard wire messages, non-standard payloads, reply formatting, and cross-language SDK adapters. It covers:

- `rabbitmq`
- `mqtt`
- `web-mqtt`
- `stomp`
- `web-stomp`
- `redis-stream`
- `gotify`

## Current Answer

The queue plugins share a common foundation today, but they do not all expose the exact same wire format at every boundary.

| Plugin | Standard inbound | Non-standard inbound | Reply format | Main difference |
|--------|------------------|----------------------|--------------|-----------------|
| `rabbitmq` | `message-sdk` `MessageEnvelope` v1 and legacy `UnifiedMessage` | `{ "text": "..." }`, plain text; `jsonOnly` can reject non-JSON | Default `envelope`; configurable `legacyJsonText` / `plainText` | Uses AMQP `correlationId/messageId` for idempotency; supports deferred ack |
| `mqtt` | `message-sdk` `MessageEnvelope` v1 and legacy `UnifiedMessage` | `{ "text": "..." }`, plain text | Default `envelope`; configurable `legacyJsonText` / `plainText` | Uses MQTT `messageId` for idempotency; embeds Aedes broker |
| `web-mqtt` | `message-sdk` `MessageEnvelope` v1 and legacy `UnifiedMessage` | `{ "text": "..." }`, plain text | Default `envelope`; configurable `legacyJsonText` / `plainText` | MQTT over WebSocket; builds idempotency keys from client/topic/payload |
| `stomp` | `message-sdk` `MessageEnvelope` v1 and legacy `UnifiedMessage` | `{ "text": "..." }`, plain text | Fixed `envelope` | STOMP TCP; replies to a destination |
| `web-stomp` | `message-sdk` `MessageEnvelope` v1 and legacy `UnifiedMessage` | `{ "text": "..." }`, plain text | Fixed `envelope` | STOMP over WebSocket; replies to `/topic/session.<peerId>` |
| `redis-stream` | `message-sdk` `MessageEnvelope` v1 and legacy `UnifiedMessage` | `{ "text": "..." }`, plain text; Stream field mapping | Fixed `envelope` for inbound reply pipeline; direct outbound adapter still writes Redis field/text | Supports Pub/Sub and Stream mode; Stream fields can override agent/account/peer/reply |
| `gotify` | Does not use the MQ wire envelope; uses native Gotify Message API / Stream JSON | Gotify `message` is normalized to `UnifiedMessage` | Native `POST /message` payload | Native notification channel, not a generic MQ wire transport; maps through `message-sdk` models |

New integrations should prefer `MessageEnvelope` v1. Use `{ "text": "..." }` or plain text only for legacy devices and simple scripts.

## Standard OpenClaw Wire Message

The standard wire format is a versioned JSON envelope:

```json
{
  "version": "1",
  "message": {
    "messageId": "mqtt-m8x2a1-k91p0v",
    "traceId": "m8x2a1-n7s3d2q1",
    "timestamp": 1779696000000,
    "source": {
      "channel": "mqtt",
      "accountId": "default",
      "userId": "device-001",
      "chatType": "direct",
      "agentId": "support-bot"
    },
    "contentType": "text",
    "text": "temperature=25 humidity=60",
    "media": [],
    "metadata": {
      "tenantId": "acme"
    },
    "direction": "inbound"
  },
  "headers": {
    "correlationId": "corr-20260525-001",
    "idempotencyKey": "device-001:1716624000",
    "replyRoute": {
      "topic": "openclaw/agent/support-bot/out/device-001"
    }
  }
}
```

### Contract Shape

```ts
type MessageEnvelope = {
  version: "1";
  message: UnifiedMessage;
  headers?: {
    correlationId?: string;
    idempotencyKey?: string;
    replyRoute?: {
      topic?: string;
      routingKey?: string;
      exchange?: string;
      destination?: string;
      queue?: string;
      [key: string]: string | undefined;
    };
    encoding?: "json" | "plain";
    [key: string]: unknown;
  };
};

type UnifiedMessage = {
  messageId: string;
  traceId: string;
  timestamp: number;
  source: {
    channel: string;
    accountId: string;
    userId: string;
    chatType: "direct" | "group";
    agentId?: string;
  };
  target?: {
    channels: string[];
    routingRule?: string;
  };
  contentType: "text" | "markdown" | "mixed";
  text: string;
  markdown?: string;
  media: Array<{
    url: string;
    kind: "image" | "video" | "audio" | "document" | "archive" | "other";
    mimeType: string;
    fileName?: string;
    sizeBytes?: number;
    base64?: string;
    thumbnailUrl?: string;
    durationSeconds?: number;
    width?: number;
    height?: number;
  }>;
  replyToMessageId?: string;
  metadata?: Record<string, unknown>;
  direction: "inbound" | "outbound";
};
```

## Non-standard Payload Normalization

`message-sdk` parses transport payloads in this order:

1. Standard `MessageEnvelope` v1: reads `message.text`, `headers.correlationId`, `headers.idempotencyKey`, and `headers.replyRoute`.
2. Legacy `UnifiedMessage` JSON.
3. Legacy `{ "text": "..." }` JSON, optionally with `correlationId` and `idempotencyKey`.
4. Plain text fallback.

In `jsonOnly` mode, invalid JSON returns empty text. In `plain` / `plainText` mode, the whole payload is treated as text.

Examples:

```text
hello from device-001
```

```json
{
  "text": "check device 42",
  "correlationId": "corr-42",
  "idempotencyKey": "device-001:42"
}
```

Custom payloads should be mapped by the edge SDK/adapter before publishing:

```json
{
  "deviceId": "device-001",
  "body": "temperature=25",
  "requestId": "req-001",
  "replyTopic": "devices/device-001/replies"
}
```

## Reply Formats

The reply pipeline uses `serializeForTransport()` and defaults to standard `envelope`. Supported formats:

- `envelope`: recommended full standard envelope.
- `legacyJsonText`: `{"text":"..."}` for old clients.
- `plainText`: raw text for constrained devices and scripts.

`ChannelOutboundAdapter.sendText()` means host-initiated outbound delivery. Some plugins still send `ctx.text` or a native protocol payload there; Agent replies triggered by inbound messages use the reply pipeline serializer.

## Configuration Examples

### RabbitMQ

```jsonc
{
  "channels": {
    "rabbitmq": {
      "url": "amqp://localhost",
      "exchange": "openclaw",
      "topicPrefix": "openclaw",
      "subscribeTopics": ["openclaw.agent.*.in.#", "devices.*.in"],
      "topicBindings": [
        {
          "topicPattern": "devices.*.in",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyTopicPattern": "devices.${peerId}.out"
        }
      ],
      "payload": {
        "mode": "jsonTextOrPlain",
        "outboundFormat": "envelope"
      },
      "dispatch": {
        "mode": "reply-pipeline",
        "reply": { "enabled": true }
      },
      "idempotency": {
        "enabled": true,
        "ttlMs": 600000,
        "maxEntries": 10000
      }
    }
  }
}
```

### MQTT

```jsonc
{
  "channels": {
    "mqtt": {
      "port": 1883,
      "subscribeTopics": ["openclaw/agent/+/in/#", "devices/+/in"],
      "topicBindings": [
        {
          "topicPattern": "devices/+/in",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyTopic": "devices/replies"
        }
      ],
      "payload": {
        "mode": "jsonTextOrPlain",
        "outboundFormat": "envelope"
      }
    }
  }
}
```

### Web MQTT

```jsonc
{
  "channels": {
    "mqtt-ws": {
      "port": 15675,
      "path": "/ws",
      "topicPrefix": "openclaw/",
      "subscribeTopics": ["openclaw/agent/+/in/#", "web/+/in"],
      "topicBindings": [
        {
          "topicPattern": "web/+/in",
          "agentId": "web-agent",
          "accountId": "default",
          "replyTopic": "web/replies"
        }
      ],
      "payload": {
        "mode": "jsonTextOrPlain",
        "outboundFormat": "envelope"
      }
    }
  }
}
```

### STOMP TCP

```jsonc
{
  "channels": {
    "stomp-tcp": {
      "port": 61613,
      "subscribeTopics": ["/queue/openclaw/agent/*/in", "/queue/devices/*/in"],
      "topicBindings": [
        {
          "topicPattern": "/queue/devices/*/in",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyTopic": "/topic/devices.replies"
        }
      ],
      "defaultAckMode": "client-individual",
      "prefetchCount": 100
    }
  }
}
```

### Web STOMP

```jsonc
{
  "channels": {
    "stomp": {
      "wsPort": 15674,
      "path": "/ws",
      "heartbeatIncoming": 10000,
      "heartbeatOutgoing": 10000,
      "maxConnections": 500
    }
  }
}
```

### Redis Stream / PubSub

```jsonc
{
  "channels": {
    "redis-stream": {
      "url": "redis://localhost:6379",
      "channelMode": "stream",
      "defaultAgentId": "iot-agent",
      "subscribeChannels": ["openclaw:*:in", "devices:*:in"],
      "channelBindings": [
        {
          "channelPattern": "devices:*:in",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyChannel": "devices:replies"
        }
      ],
      "payload": {
        "mode": "jsonTextOrPlain"
      },
      "fieldMapping": {
        "textField": "text",
        "agentIdField": "agentId",
        "peerIdField": "peerId",
        "accountIdField": "accountId",
        "replyStreamField": "replyStream"
      }
    }
  }
}
```

### Gotify

```jsonc
{
  "channels": {
    "gotify": {
      "accounts": [
        {
          "accountId": "default",
          "serverUrl": "https://gotify.example.com",
          "appToken": "${GOTIFY_APP_TOKEN}",
          "clientToken": "${GOTIFY_CLIENT_TOKEN}",
          "defaultPriority": 5,
          "dmPolicy": "allowlist",
          "allowFrom": ["42"],
          "inbound": {
            "enabled": true,
            "allowedAppId": 42,
            "deleteAfterDispatch": true
          }
        }
      ]
    }
  }
}
```

## Cross-language SDK Strategy

Every SDK should provide the same four capabilities:

1. `parseStandardEnvelope(raw)`: parse `MessageEnvelope` v1.
2. `normalizePayload(raw, options)`: return `{ text, unified, correlationId, idempotencyKey, replyRoute }` using envelope → `UnifiedMessage` → `{text}` → plain fallback.
3. `formatReply(text, context, format)`: generate `envelope`, `legacyJsonText`, or `plainText`.
4. `keepCorrelation(context)`: preserve `correlationId`, `replyRoute`, and retry `idempotencyKey`.

### TypeScript / JavaScript

Use `@partme.ai/openclaw-message-sdk` directly:

```ts
import { parseTransportPayload, serializeForTransport } from "@partme.ai/openclaw-message-sdk";

const parsed = parseTransportPayload(rawPayload, "jsonTextOrPlain");
const reply = serializeForTransport({
  channel: "mqtt",
  accountId: "default",
  userId: "device-001",
  text: "done",
  format: "envelope",
  headers: {
    correlationId: parsed.correlationId,
    idempotencyKey: parsed.idempotencyKey,
  },
  replyRoute: parsed.replyRoute ?? { topic: "devices/device-001/out" },
});
```

### Java / Kotlin

Use Jackson or kotlinx.serialization DTOs mirroring `MessageEnvelope` and `UnifiedMessage`. Parse standard envelope first, then legacy `UnifiedMessage`, then `{text}`, then plain text. Replies should preserve `correlationId` and `replyRoute`.

### Python

Use dataclasses or pydantic models with the same parse order. Keep `ensure_ascii=False` when serializing multilingual content.

### Go

Use typed structs for `MessageEnvelope`, `UnifiedMessage`, and `ParsedPayload`. Unknown fields should be tolerated to preserve forward compatibility.

## Enterprise Follow-ups

- Publish dedicated packages: `openclaw-message-sdk-java`, `openclaw-message-sdk-python`, and `openclaw-message-sdk-go`.
- Maintain an official JSON Schema for `MessageEnvelope` v1 and validate examples in CI.
- Add configurable `payload.outboundFormat` to Redis Stream direct outbound behavior.
- Add explicit payload configuration to STOMP/Web STOMP instead of relying on fixed envelope behavior.
- Document Gotify as a native notification protocol mapper, not a generic MQ wire transport.
