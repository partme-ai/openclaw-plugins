# Go SDK

Package `openclaw` — zero-dependency OpenClaw queue message helpers.

## 运行测试

```bash
cd sdk/go
go test ./...
```

## 解析入站 payload

```go
import "github.com/partme-ai/openclaw-plugins/sdk/go/openclaw"

parsed := openclaw.ParseTransportPayload([]byte(raw), openclaw.ParseJSONTextOrPlain)
fmt.Println(parsed.Text, parsed.CorrelationID, parsed.ReplyRoute)

// Plain mode
openclaw.ParseTransportPayload([]byte("hello"), openclaw.ParsePlain)
```

## 格式化出站回复

```go
// MQTT envelope
wire, _ := openclaw.SerializeForTransport(openclaw.SerializeOutboundParams{
    Channel:    "mqtt",
    AccountID:  "default",
    UserID:     "device-001",
    Text:       "已收到",
    ReplyRoute: openclaw.ReplyRoute{"topic": "devices/device-001/replies"},
    Format:     openclaw.FormatEnvelope,
})

// RabbitMQ legacy JSON
legacy, _ := openclaw.SerializeForTransport(openclaw.SerializeOutboundParams{
    Channel: "rabbitmq", AccountID: "default", UserID: "peer", Text: "ok",
    Format: openclaw.FormatLegacyJSONText,
})

// Redis Stream plain text
plain, _ := openclaw.SerializeForTransport(openclaw.SerializeOutboundParams{
    Channel: "redis-stream", AccountID: "default", UserID: "peer", Text: "done",
    Format: openclaw.FormatPlainText,
})
```

## 构建标准 envelope

```go
msg := openclaw.BuildMessage(openclaw.BuildMessageParams{
    Channel: "mqtt", AccountID: "default", UserID: "device-001", Text: "ping",
})
env := openclaw.BuildEnvelope(msg, &openclaw.MessageEnvelopeHeaders{
    CorrelationID: openclaw.GenerateCorrelationID("corr"),
    ReplyRoute:    openclaw.ReplyRoute{"topic": "devices/replies"},
})
wire, _ := openclaw.SerializeEnvelope(env)
```

## 相关文档

- [OpenClaw 队列消息格式指南](../../doc/OpenClaw-Queue-Message-Format-Guide.md)
- [SDK 总览](../README.md)
