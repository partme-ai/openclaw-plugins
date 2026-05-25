# Java SDK

Java 17+，零第三方依赖（内置轻量 JSON 解析），Maven 构建。

Kotlin 项目可将 `sdk/java` 作为 module 依赖，或复制 `ai.partme.openclaw.message` 包源码。

## 构建与测试

```bash
cd sdk/java
mvn test
```

## 解析入站 payload

```java
import ai.partme.openclaw.message.OpenClawMessageSdk;
import ai.partme.openclaw.message.ParsedTransportPayload;

ParsedTransportPayload parsed = OpenClawMessageSdk.parseTransportPayload(rawJson, "jsonTextOrPlain");
System.out.println(parsed.text());
System.out.println(parsed.correlationId());
System.out.println(parsed.replyRoute());
```

## 格式化出站回复

```java
import java.util.Map;

// STOMP — envelope
String stompReply = OpenClawMessageSdk.serializeForTransport(
    "stomp", "default", "session-1", "已收到", null,
    OpenClawMessageSdk.FORMAT_ENVELOPE,
    null,
    Map.of("destination", "/topic/devices.replies")
);

// MQTT — legacy JSON
String mqttLegacy = OpenClawMessageSdk.serializeForTransport(
    "mqtt", "default", "device-001", "ok", null,
    OpenClawMessageSdk.FORMAT_LEGACY_JSON_TEXT, null, null
);

// Plain text
String plain = OpenClawMessageSdk.serializeForTransport(
    "redis-stream", "default", "peer", "done", null,
    OpenClawMessageSdk.FORMAT_PLAIN_TEXT, null, null
);
```

## Kotlin 用法

```kotlin
import ai.partme.openclaw.message.OpenClawMessageSdk
import ai.partme.openclaw.message.MessageFactory

val parsed = OpenClawMessageSdk.parseTransportPayload(raw, "jsonTextOrPlain")
val correlationId = MessageFactory.generateCorrelationId("iot")
```

## 相关文档

- [OpenClaw 队列消息格式指南](../../doc/OpenClaw-Queue-Message-Format-Guide.md)
- [SDK 总览](../README.md)
