# Python SDK

零外部依赖的 OpenClaw 队列消息 SDK。

## 运行测试

```bash
cd sdk/python
python -m unittest discover -s tests
```

## 解析入站 payload

```python
from openclaw_message_sdk import parse_transport_payload, serialize_for_transport

# MQTT envelope v1
raw = '{"version":"1","message":{...}}'
parsed = parse_transport_payload(raw)
print(parsed["text"], parsed.get("correlationId"), parsed.get("replyRoute"))

# Legacy text JSON
parse_transport_payload('{"text": "hello", "correlationId": "c-1"}')

# Plain text (强管控可用 jsonOnly)
parse_transport_payload("hello device", "plain")
```

## 格式化出站回复

```python
from openclaw_message_sdk import serialize_for_transport

# RabbitMQ — envelope
payload = serialize_for_transport({
    "channel": "rabbitmq",
    "accountId": "default",
    "userId": "device-001",
    "text": "已处理",
    "replyRoute": {"routingKey": "devices.device-001.out", "exchange": "openclaw"},
    "format": "envelope",
})

# MQTT — legacy JSON
legacy = serialize_for_transport({
    "channel": "mqtt",
    "accountId": "default",
    "userId": "device-001",
    "text": "ok",
    "format": "legacyJsonText",
})

# Redis Stream — plain text field
plain = serialize_for_transport({
    "channel": "redis-stream",
    "accountId": "default",
    "userId": "peer-1",
    "text": "done",
    "format": "plainText",
})
```

## 构建标准 envelope

```python
from openclaw_message_sdk import (
    build_message,
    build_envelope,
    generate_correlation_id,
    serialize_envelope,
)

msg = build_message({
    "channel": "mqtt",
    "accountId": "default",
    "userId": "device-001",
    "text": "temperature=25",
})
envelope = build_envelope(msg, {
    "correlationId": generate_correlation_id(),
    "replyRoute": {"topic": "devices/device-001/replies"},
})
wire = serialize_envelope(envelope)
# publish wire to broker topic
```

## 相关文档

- [OpenClaw 队列消息格式指南](../../doc/OpenClaw-Queue-Message-Format-Guide.md)
- [SDK 总览](../README.md)
