# OpenClaw Queue Message SDK

Lightweight **multi-language SDKs** for OpenClaw queue plugins (`rabbitmq`, `mqtt`, `web-mqtt`, `stomp`, `web-stomp`, `redis-stream`, `gotify`) to build, parse, and normalize wire messages.

> Canonical spec: [Queue Message Format Guide](../doc/OpenClaw-Queue-Message-Format-Guide.en.md) · [中文](../doc/OpenClaw-Queue-Message-Format-Guide.md)

## Layout

| Path | Description |
|------|-------------|
| [schema/](./schema/) | `MessageEnvelope` v1 JSON Schema |
| [typescript/](./typescript/) | TypeScript / Node.js SDK |
| [python/](./python/) | Python SDK (zero deps) |
| [go/](./go/) | Go SDK (zero deps) |
| [java/](./java/) | Java 17 SDK (zero deps, Maven) |

Kotlin projects can reuse the Java module — see [java/README.md](./java/README.md).

## Capability matrix

| Feature | TS | Python | Go | Java |
|---------|:--:|:------:|:--:|:----:|
| `MessageEnvelope` v1 models | ✅ | ✅ | ✅ | ✅ |
| Parse envelope / legacy / `{text}` / plain | ✅ | ✅ | ✅ | ✅ |
| `parseTransportPayload` normalization | ✅ | ✅ | ✅ | ✅ |
| Outbound `envelope` / `legacyJsonText` / `plainText` | ✅ | ✅ | ✅ | ✅ |
| `messageId` / `correlationId` / `replyRoute` helpers | ✅ | ✅ | ✅ | ✅ |
| Runnable tests | ✅ | ✅ | ✅ | ✅ |

## Quick start

```bash
# TypeScript
cd sdk/typescript && npm install && npm test

# Python
cd sdk/python && python -m unittest discover -s tests

# Go
cd sdk/go && go test ./...

# Java
cd sdk/java && mvn test
```

## Relationship to `message-sdk`

- **Runtime plugins** use `extensions/message-sdk` (dispatch, dedup, bridge, etc.).
- **`sdk/`** targets devices, gateways, and polyglot integrators: envelope parse/serialize only, **no OpenClaw runtime dependency**.

## Publishing

Source + tests live in-repo; not yet published to npm / PyPI / Maven Central / Go module proxy.

## See also

- [Queue Message Format Guide (EN)](../doc/OpenClaw-Queue-Message-Format-Guide.en.md)
- [message-sdk extension](../extensions/message-sdk/README.md)
