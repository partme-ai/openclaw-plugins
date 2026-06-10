# OpenClaw Queue Message SDK

OpenClaw 队列插件（`rabbitmq` / `mqtt` / `web-mqtt` / `stomp` / `web-stomp` / `redis-stream` / `gotify`）的**多语言轻量 SDK**，用于构建、解析与归一化线传输消息。

> 中央规范文档：[OpenClaw 队列消息格式指南](../doc/OpenClaw-Queue-Message-Format-Guide.md) · [English](../doc/OpenClaw-Queue-Message-Format-Guide.en.md)

## 目录结构

| 路径 | 说明 |
|------|------|
| [schema/](./schema/) | `MessageEnvelope` v1 JSON Schema |
| [typescript/](./typescript/) | TypeScript / Node.js SDK（含测试） |
| [python/](./python/) | Python SDK（零外部依赖，含 unittest） |
| [go/](./go/) | Go SDK（零外部依赖，含 `go test`） |
| [java/](./java/) | Java 17 SDK（零外部依赖，Maven + JUnit 5） |

Kotlin/JVM 项目可直接复用 Java 模块，见 [java/README.md](./java/README.md)。

## 能力矩阵

各语言 SDK 对齐 `extensions/message-sdk` 的 wire 契约，提供：

| 能力 | TS | Python | Go | Java |
|------|:--:|:------:|:--:|:----:|
| `MessageEnvelope` v1 类型/模型 | ✅ | ✅ | ✅ | ✅ |
| 解析 envelope / legacy UnifiedMessage / `{text}` / plain | ✅ | ✅ | ✅ | ✅ |
| 归一化 `parseTransportPayload` | ✅ | ✅ | ✅ | ✅ |
| 出站 `envelope` / `legacyJsonText` / `plainText` | ✅ | ✅ | ✅ | ✅ |
| `messageId` / `correlationId` / `replyRoute` helper | ✅ | ✅ | ✅ | ✅ |
| 可运行测试 | ✅ | ✅ | ✅ | ✅ |

## 快速开始

### TypeScript

```bash
cd sdk/typescript
npm install
npm test
```

### Python

```bash
cd sdk/python
python -m unittest discover -s tests
```

### Go

```bash
cd sdk/go
go test ./...
```

### Java

```bash
cd sdk/java
mvn test
```

## 标准消息形状

推荐使用 **MessageEnvelope v1**（详见中央文档）：

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
      "chatType": "direct"
    },
    "contentType": "text",
    "text": "hello",
    "media": [],
    "direction": "inbound"
  },
  "headers": {
    "correlationId": "corr-001",
    "idempotencyKey": "device-001:42",
    "replyRoute": { "topic": "devices/device-001/replies" }
  }
}
```

## 与 message-sdk 的关系

- **运行时插件**仍使用 `extensions/message-sdk`（含 dispatch、dedup、bridge 等完整能力）。
- **本目录 `sdk/`** 面向设备端、网关、异构语言对接方：仅包含 envelope 解析/序列化，**无 OpenClaw 运行时依赖**，可复制到独立仓库或后续发布到 npm / PyPI / Maven Central / Go module。

## 发布状态

当前为 **repo 内源码 + 测试** 阶段，尚未发布到公共包仓库。后续可按语言分别：

- TypeScript → `@partme/openclaw-message-sdk` on npm
- Python → `openclaw-message-sdk` on PyPI
- Java → `ai.partme.openclaw:openclaw-message-sdk` on Maven Central
- Go → `github.com/partme-ai/openclaw-plugins/sdk/go`

## 相关文档

- [队列消息格式指南（中文）](../doc/OpenClaw-Queue-Message-Format-Guide.md)
- [Queue Message Format Guide (EN)](../doc/OpenClaw-Queue-Message-Format-Guide.en.md)
- [message-sdk 插件](../extensions/message-sdk/README.md)
