# TypeScript SDK

零 OpenClaw 运行时依赖的轻量队列消息 SDK，对齐 `extensions/message-sdk` wire 契约。

## 安装（本地）

```bash
cd sdk/typescript
npm install
npm test
npm run build
```

## 解析入站 payload

```ts
import { parseTransportPayload, serializeForTransport } from "./src/index.js";

// 1. 标准 envelope
const envRaw = "..."; // MessageEnvelope v1 JSON
const parsed = parseTransportPayload(envRaw, "jsonTextOrPlain");
console.log(parsed.text, parsed.correlationId, parsed.replyRoute);

// 2. Legacy { "text": "..." }
parseTransportPayload('{"text":"ping","correlationId":"c-1"}');

// 3. Plain text
parseTransportPayload("hello device", "plain");
```

## 格式化出站回复

```ts
import { serializeForTransport } from "./src/index.js";

// MQTT — standard envelope (recommended)
const mqttReply = serializeForTransport({
  channel: "mqtt",
  accountId: "default",
  userId: "device-001",
  text: "已收到",
  replyRoute: { topic: "devices/device-001/replies" },
  format: "envelope",
});

// RabbitMQ — legacy JSON for old consumers
const rabbitReply = serializeForTransport({
  channel: "rabbitmq",
  accountId: "default",
  userId: "device-001",
  text: "ok",
  format: "legacyJsonText",
});

// Redis Stream field value — plain text
const redisReply = serializeForTransport({
  channel: "redis-stream",
  accountId: "default",
  userId: "stream-peer",
  text: "done",
  format: "plainText",
});
```

## 关联 ID

```ts
import { generateMessageId, generateCorrelationId, buildEnvelope, buildMessage } from "./src/index.js";

const msg = buildMessage({
  channel: "mqtt",
  accountId: "default",
  userId: "device-001",
  text: "telemetry",
});
const envelope = buildEnvelope(msg, {
  correlationId: generateCorrelationId(),
  idempotencyKey: `${msg.source.userId}:${Date.now()}`,
  replyRoute: { topic: "devices/replies" },
});
```

## 相关文档

- [OpenClaw 队列消息格式指南](../../doc/OpenClaw-Queue-Message-Format-Guide.md)
- [SDK 总览](../README.md)
