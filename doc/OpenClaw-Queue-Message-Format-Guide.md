# OpenClaw 队列消息格式指南

本文说明 OpenClaw 队列插件如何处理标准消息、非标准消息、回复格式和跨语言 SDK 适配。适用插件：

- `rabbitmq`
- `mqtt`
- `web-mqtt`
- `stomp`
- `web-stomp`
- `redis-stream`
- `gotify`

## 当前结论

队列插件今天已经有统一基础，但不是所有对接端都使用完全相同的 wire 格式。

| 插件 | 入站标准格式 | 非标准入站 | 回复格式 | 主要差异 |
|------|--------------|------------|----------|----------|
| `rabbitmq` | `message-sdk` `MessageEnvelope` v1、legacy `UnifiedMessage` | `{ "text": "..." }`、纯文本；`jsonOnly` 可拒绝非 JSON | 默认 `envelope`，可配置 `legacyJsonText` / `plainText` | 支持 RabbitMQ `correlationId/messageId` 幂等，支持 deferred ack |
| `mqtt` | `message-sdk` `MessageEnvelope` v1、legacy `UnifiedMessage` | `{ "text": "..." }`、纯文本 | 默认 `envelope`，可配置 `legacyJsonText` / `plainText` | 以 MQTT `messageId` 做幂等；嵌入 Aedes broker |
| `web-mqtt` | `message-sdk` `MessageEnvelope` v1、legacy `UnifiedMessage` | `{ "text": "..." }`、纯文本 | 默认 `envelope`，可配置 `legacyJsonText` / `plainText` | WebSocket MQTT，按 client/topic/payload 构造幂等键 |
| `stomp` | `message-sdk` `MessageEnvelope` v1、legacy `UnifiedMessage` | `{ "text": "..." }`、纯文本 | 固定 `envelope` | STOMP TCP，回复写入 destination |
| `web-stomp` | `message-sdk` `MessageEnvelope` v1、legacy `UnifiedMessage` | `{ "text": "..." }`、纯文本 | 固定 `envelope` | STOMP over WebSocket，回复写入 `/topic/session.<peerId>` |
| `redis-stream` | `message-sdk` `MessageEnvelope` v1、legacy `UnifiedMessage` | `{ "text": "..." }`、纯文本；Stream field mapping | 固定 `envelope`（入站 reply pipeline）；直接 outbound adapter 仍按 Redis field/text 写入 | Pub/Sub 与 Stream 两种模式，Stream 可用字段覆盖 agent/account/peer/reply |
| `gotify` | 不走 MQ wire envelope；使用 Gotify 原生 Message API / Stream JSON | Gotify `message` 字段归一化为 `UnifiedMessage` | 原生 `POST /message` payload | 不是通用 MQ wire 插件，是原生通知通道；通过 mapper 进入 `message-sdk` 统一消息模型 |

建议新接入端优先使用 `MessageEnvelope` v1；只在兼容旧设备或极简脚本时使用 `{ "text": "..." }` 或纯文本。

## 标准 OpenClaw Wire 消息

标准线传输格式是版本化 JSON envelope：

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
    "text": "温度 25C，湿度 60%",
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

### JSON Schema-like 契约

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

### 字段约定

- `messageId`：业务消息唯一 ID，用于审计和排障。
- `traceId`：链路追踪 ID，应在跨系统调用中保持不变。
- `headers.correlationId`：请求/回复关联 ID。RabbitMQ 可映射到 AMQP `correlationId`，其它协议可写入 payload header。
- `headers.idempotencyKey`：幂等键。设备端重试时保持相同值，插件应避免重复 dispatch。
- `headers.replyRoute`：回复路由。不同协议使用不同键：MQTT `topic`、RabbitMQ `routingKey/exchange`、STOMP `destination`、Redis `topic`/channel。
- `metadata`：业务扩展字段。不要把核心路由字段只放在 `metadata`，核心字段应放入 `source` 和 `headers`。

## 非标准消息归一化

`message-sdk` 的 `parseTransportPayload()` 按以下顺序解析：

1. 标准 `MessageEnvelope` v1：读取 `message.text`、`headers.correlationId`、`headers.idempotencyKey`、`headers.replyRoute`。
2. legacy `UnifiedMessage` JSON：直接把整个 JSON 当作 `UnifiedMessage`。
3. legacy `{ "text": "..." }`：仅提取 `text`，可附带 `correlationId`、`idempotencyKey`。
4. 纯文本：把整段 payload 当作 `text`。

`jsonOnly` 模式下，如果不是有效 JSON，则返回空文本；适合强治理环境。`plain` / `plainText` 模式下，不尝试 JSON 解析，整段当作文本。

### 非标准示例

纯文本：

```text
hello from device-001
```

简单 JSON：

```json
{
  "text": "请检查 42 号设备",
  "correlationId": "corr-42",
  "idempotencyKey": "device-001:42"
}
```

自定义 payload 需要先在对接端 SDK/适配器中映射为标准 envelope：

```json
{
  "deviceId": "device-001",
  "body": "temperature=25",
  "requestId": "req-001",
  "replyTopic": "devices/device-001/replies"
}
```

映射规则：

```ts
const envelope = {
  version: "1",
  message: {
    messageId: `mqtt-${custom.requestId}`,
    traceId: custom.requestId,
    timestamp: Date.now(),
    source: {
      channel: "mqtt",
      accountId: "default",
      userId: custom.deviceId,
      chatType: "direct",
    },
    contentType: "text",
    text: custom.body,
    media: [],
    direction: "inbound",
  },
  headers: {
    correlationId: custom.requestId,
    idempotencyKey: custom.requestId,
    replyRoute: { topic: custom.replyTopic },
  },
};
```

## 回复格式

队列插件的 reply pipeline 默认使用 `serializeForTransport()` 输出标准 envelope：

```json
{
  "version": "1",
  "message": {
    "messageId": "mqtt-m8x2b2-p2j4cc",
    "traceId": "m8x2b2-x91zzp0a",
    "timestamp": 1779696005000,
    "source": {
      "channel": "mqtt",
      "accountId": "default",
      "userId": "device-001",
      "chatType": "direct",
      "agentId": "support-bot"
    },
    "contentType": "text",
    "text": "已收到，建议检查风扇转速。",
    "media": [],
    "direction": "outbound"
  },
  "headers": {
    "replyRoute": {
      "topic": "openclaw/agent/support-bot/out/device-001"
    }
  }
}
```

可选出站格式：

- `envelope`：推荐，完整标准信封。
- `legacyJsonText`：`{"text":"..."}`，适合旧客户端。
- `plainText`：裸文本，适合命令行脚本或非常受限的设备。

注意：`ChannelOutboundAdapter.sendText()` 代表宿主主动向通道发送文本，部分插件仍直接发送 `ctx.text` 或协议原生 payload；入站触发的 Agent 回复会走 reply pipeline 的 wire 序列化。

## 七个插件配置示例

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

Publish standard message to routing key `openclaw.agent.iot-agent.in.device-001`.

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
      },
      "auth": {
        "enabled": true,
        "allowAnonymous": false,
        "users": [
          {
            "username": "device",
            "passwordHash": "sha256:...",
            "aclRules": [
              { "action": "publish", "topicPattern": "devices/+/in", "effect": "allow" },
              { "action": "subscribe", "topicPattern": "devices/replies", "effect": "allow" }
            ]
          }
        ]
      }
    }
  }
}
```

Publish standard message to topic `openclaw/agent/iot-agent/in/device-001` or binding topic `devices/device-001/in`.

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
      },
      "auth": {
        "required": true,
        "allowAnonymous": false,
        "users": [
          {
            "username": "browser",
            "password": "change-me",
            "publishAllow": ["web/+/in"],
            "subscribeAllow": ["web/replies"]
          }
        ]
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

Send standard envelope as STOMP frame body. Replies are standard envelopes on the configured destination.

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

Send standard envelope as STOMP SEND body. Default reply destination is `/topic/session.<peerId>`.

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
      },
      "stream": {
        "inboundKey": "openclaw:inbound",
        "outboundKey": "openclaw:outbound",
        "consumerGroup": "openclaw-group",
        "consumerName": "openclaw-consumer-1"
      }
    }
  }
}
```

Stream entry can be either a standard envelope in `text`, simple text in `text`, or custom fields mapped by `fieldMapping`.

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

Gotify does not consume the queue wire envelope directly. Inbound `/stream` messages are Gotify JSON and are mapped to `UnifiedMessage`; outbound replies use native `POST /message`.

## 多语言 SDK 策略

所有语言 SDK 应提供相同四类能力：

1. `parseStandardEnvelope(raw)`：解析 `MessageEnvelope` v1，失败返回 `null`/`None`/`nil`。
2. `normalizePayload(raw, options)`：按 envelope → `UnifiedMessage` → `{text}` → plain 的顺序输出 `{ text, unified, correlationId, idempotencyKey, replyRoute }`。
3. `formatReply(text, context, format)`：输出 `envelope`、`legacyJsonText` 或 `plainText`。
4. `keepCorrelation(context)`：回复必须保留 `correlationId`、`replyRoute`，重试必须保留 `idempotencyKey`。

### TypeScript / JavaScript

首选直接使用 `@partme.ai/openclaw-message-sdk`：

```ts
import {
  parseTransportPayload,
  serializeForTransport,
} from "@partme.ai/openclaw-message-sdk";

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

### Java

建议提供 `openclaw-message-sdk-java`，使用 Jackson：

```java
record ParsedPayload(
    String text,
    MessageEnvelope envelope,
    String correlationId,
    String idempotencyKey,
    Map<String, String> replyRoute
) {}

ParsedPayload normalizePayload(String raw) {
    try {
        JsonNode node = objectMapper.readTree(raw);
        if ("1".equals(node.path("version").asText()) && node.has("message")) {
            MessageEnvelope env = objectMapper.treeToValue(node, MessageEnvelope.class);
            return ParsedPayload.fromEnvelope(env);
        }
        if (node.hasNonNull("messageId") && node.has("source") && node.has("text")) {
            UnifiedMessage msg = objectMapper.treeToValue(node, UnifiedMessage.class);
            return ParsedPayload.fromUnified(msg);
        }
        if (node.hasNonNull("text")) {
            return new ParsedPayload(node.get("text").asText(), null,
                textOrNull(node, "correlationId"), textOrNull(node, "idempotencyKey"), Map.of());
        }
    } catch (JsonProcessingException ignored) {
        // fallback to plain text
    }
    return new ParsedPayload(raw, null, null, null, Map.of());
}
```

### Kotlin

Kotlin 可以复用 Java DTO 或提供 data class：

```kotlin
data class ParsedPayload(
    val text: String,
    val envelope: MessageEnvelope? = null,
    val correlationId: String? = null,
    val idempotencyKey: String? = null,
    val replyRoute: Map<String, String> = emptyMap()
)

fun formatPlainReply(text: String): String = text
fun formatLegacyReply(text: String): String = objectMapper.writeValueAsString(mapOf("text" to text))
```

### Python

```python
import json
import time
import uuid

def normalize_payload(raw: str) -> dict:
    try:
        obj = json.loads(raw)
        if obj.get("version") == "1" and isinstance(obj.get("message"), dict):
            msg = obj["message"]
            headers = obj.get("headers") or {}
            return {
                "text": msg.get("text", ""),
                "unified": msg,
                "correlationId": headers.get("correlationId"),
                "idempotencyKey": headers.get("idempotencyKey"),
                "replyRoute": headers.get("replyRoute"),
            }
        if obj.get("messageId") and obj.get("source") and isinstance(obj.get("text"), str):
            return {"text": obj["text"], "unified": obj}
        if isinstance(obj.get("text"), str):
            return {
                "text": obj["text"],
                "correlationId": obj.get("correlationId"),
                "idempotencyKey": obj.get("idempotencyKey"),
            }
    except json.JSONDecodeError:
        pass
    return {"text": raw, "unified": None}

def format_reply(text: str, route: dict | None = None) -> str:
    return json.dumps({
        "version": "1",
        "message": {
            "messageId": f"python-{uuid.uuid4()}",
            "traceId": str(uuid.uuid4()),
            "timestamp": int(time.time() * 1000),
            "source": {"channel": "python-sdk", "accountId": "default", "userId": "peer", "chatType": "direct"},
            "contentType": "text",
            "text": text,
            "media": [],
            "direction": "outbound",
        },
        "headers": {"replyRoute": route or {}},
    }, ensure_ascii=False)
```

### Go

```go
type ParsedPayload struct {
	Text           string
	Unified        *UnifiedMessage
	CorrelationID  string
	IdempotencyKey string
	ReplyRoute     map[string]string
}

func NormalizePayload(raw []byte) ParsedPayload {
	var env MessageEnvelope
	if err := json.Unmarshal(raw, &env); err == nil && env.Version == "1" && env.Message.Text != "" {
		return ParsedPayload{
			Text:           env.Message.Text,
			Unified:        &env.Message,
			CorrelationID:  env.Headers.CorrelationID,
			IdempotencyKey: env.Headers.IdempotencyKey,
			ReplyRoute:     env.Headers.ReplyRoute,
		}
	}

	var legacy struct {
		Text           string `json:"text"`
		CorrelationID  string `json:"correlationId"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if err := json.Unmarshal(raw, &legacy); err == nil && legacy.Text != "" {
		return ParsedPayload{Text: legacy.Text, CorrelationID: legacy.CorrelationID, IdempotencyKey: legacy.IdempotencyKey}
	}

	return ParsedPayload{Text: string(raw)}
}
```

## 用户使用建议

- 新系统：发送 `MessageEnvelope` v1，回复也订阅/消费 `envelope`。
- 旧设备：发送 `{ "text": "..." }`，在插件配置中保留 `jsonTextOrPlain`。
- 只支持文本的端：发送纯文本，回复格式改为 `plainText`（目前 RabbitMQ/MQTT/Web MQTT 可配置）。
- 强管控环境：使用 `jsonOnly`（RabbitMQ）或网关前置校验，拒绝纯文本。
- 幂等：设备重试时保持同一个 `headers.idempotencyKey`，避免 Agent 重复执行。
- 关联：请求与回复应使用相同 `correlationId` 或协议原生关联字段。

## 企业级后续建议

- 发布独立多语言 SDK 包：`openclaw-message-sdk-java`、`openclaw-message-sdk-python`、`openclaw-message-sdk-go`。
- 为 `MessageEnvelope` v1 维护正式 JSON Schema，并在 CI 中校验示例 payload。
- 为 Redis Stream 增加可配置 `payload.outboundFormat`，让直接 outbound adapter 与 reply pipeline 策略一致。
- 为 STOMP/Web STOMP 增加显式 payload 配置项，减少“固定 envelope”隐式行为。
- 为 Gotify 文档强调它是原生通知协议映射，不是通用 MQ wire transport。
