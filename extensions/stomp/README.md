<div align="center">

# OpenClaw STOMP

**OpenClaw channel plugin — native STOMP TCP bridge with enterprise delivery controls**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--stomp-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

[English](./README.md) | [简体中文](./README.zh-CN.md)

## Introduction

`@partme.ai/openclaw-stomp` is an OpenClaw channel plugin that embeds a native STOMP TCP server (`stomp-tcp`) and bridges STOMP clients to OpenClaw Agents.

Compared with old drafts, this version is fully aligned with OpenClaw channel SDK entrypoints:

- `defineChannelPluginEntry` for full runtime registration
- `defineSetupPluginEntry` for setup-only lightweight loading
- `openclaw.setupEntry` in `package.json`

## Core capabilities

- STOMP `CONNECT` / `SEND` / `SUBSCRIBE` / `UNSUBSCRIBE` / `ACK` / `NACK` / `DISCONNECT`
- STOMP 1.0/1.1/1.2 handshake with `CONNECTED` response
- ACK mode support: `auto`, `client`, `client-individual`
- Prefetch control (`prefetch-count`)
- Durable subscription behavior (`durable:true` + `auto-delete:false`)
- Multi-topic allowlist (`subscribeTopics`)
- Explicit `topicPattern -> agentId` binding (`topicBindings`)
- TLS listener support
- Status endpoint: `GET /stomp-tcp/status`

## Message flow

1. STOMP client connects and subscribes one or more topics.
2. Client sends `SEND` to destination.
3. Plugin resolves route:
   - First: explicit `topicBindings`
   - Fallback: destination-derived agent route
4. Plugin dispatches inbound text to OpenClaw runtime.
5. Agent reply is published to `replyDestination` (bound topic or session topic).
6. For `client` / `client-individual`, reply delivery waits for `ACK` under prefetch limits.

## Session isolation (`session.dmScope` compatible)

The plugin does not introduce a custom session-scope setting.  
It follows OpenClaw native session configuration directly:

- `session.dmScope: "main"`
- `session.dmScope: "per-peer"`
- `session.dmScope: "per-channel-peer"`
- `session.dmScope: "per-account-channel-peer"`

Session-key partitioning is driven only by `session.dmScope`.

## Quick start

### Prerequisites

- OpenClaw `>= 2026.4.x`
- Node.js `22+`

### Install

```bash
openclaw plugins install @partme.ai/openclaw-stomp
```

Requires `@partme.ai/openclaw-message-sdk >= 2026.5.22`.

### Minimal config example (`openclaw.json`)

```json
{
  "channels": {
    "stomp-tcp": {
      "port": 61613,
      "tlsPort": 61614,
      "tls": {
        "enabled": false
      },
      "maxConnections": 1000,
      "maxFrameSize": 4194304,
      "defaultAckMode": "auto",
      "prefetchCount": 100,
      "subscribeTopics": [
        "devices/*/in",
        "openclaw/agent/*/in"
      ],
      "topicBindings": [
        {
          "topicPattern": "devices/*/in",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyTopic": "/topic/devices/reply"
        }
      ],
      "auth": {
        "required": false
      }
    }
  }
}
```

## Configuration reference

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `port` | number | `61613` | STOMP TCP listener |
| `tlsPort` | number | `61614` | STOMP TLS listener (`0` disables TLS port) |
| `tls.enabled` | boolean | `false` | Enable TLS listener |
| `tls.certFile` / `tls.keyFile` / `tls.caFile` | string | - | TLS certificate files |
| `heartbeat.serverMs` / `heartbeat.clientMs` | number | `10000` | Heartbeat negotiation values |
| `maxConnections` | number | `1000` | TCP max connections |
| `maxFrameSize` | number | `4194304` | Max frame bytes |
| `auth.required` | boolean | `true` | Require auth on `CONNECT` |
| `auth.defaultUser` / `auth.defaultPass` | string | - | Optional default credentials |
| `subscribeTopics` | string[] | `[]` | Inbound destination allowlist |
| `topicBindings` | object[] | `[]` | Explicit topic to agent mappings |
| `defaultAckMode` | enum | `auto` | Default subscription ack mode |
| `prefetchCount` | number | `100` | Default subscription prefetch |

## Test

### Unit tests

```bash
npm test
```

### STOMP test client

```bash
npm run test:client
```

Environment variables:

- `STOMP_HOST`, `STOMP_PORT`, `STOMP_TIMEOUT_MS`
- `STOMP_TEST_SUBSCRIBE_TOPICS`
- `STOMP_TEST_PUBLISH_CASES` (JSON array)
- `STOMP_TEST_DEST_1`, `STOMP_TEST_DEST_2`
- `STOMP_TEST_BODY_1`, `STOMP_TEST_BODY_2`

## Status API

`GET /stomp-tcp/status` returns:

- connection list
- version distribution
- snapshot counters: inbound/outbound routed, dropped messages, pending ACK

## CI and release

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push/PR to `main`/`master` | typecheck + build + test + dist artifact |
| `.github/workflows/release.yml` | tag `v*` / manual dispatch | package + test + npm publish |

Release playbook: [RELEASING.md](./RELEASING.md)

## OpenClaw plugin docs

### Plugins

- https://docs.openclaw.ai/tools/plugin
- https://docs.openclaw.ai/plugins/community
- https://docs.openclaw.ai/plugins/bundles
- https://docs.openclaw.ai/plugins/voice-call

### Building plugins

- https://docs.openclaw.ai/plugins/building-plugins
- https://docs.openclaw.ai/plugins/sdk-channel-plugins
- https://docs.openclaw.ai/plugins/sdk-provider-plugins
- https://docs.openclaw.ai/plugins/sdk-migration

### SDK reference

- https://docs.openclaw.ai/plugins/sdk-overview
- https://docs.openclaw.ai/plugins/sdk-entrypoints
- https://docs.openclaw.ai/plugins/sdk-runtime
- https://docs.openclaw.ai/plugins/sdk-setup
- https://docs.openclaw.ai/plugins/sdk-testing
- https://docs.openclaw.ai/plugins/manifest
- https://docs.openclaw.ai/plugins/architecture

### RabbitMQ STOMP reference

- https://www.rabbitmq.com/docs/stomp

## License

MIT

## Message Format Guide

STOMP uses the shared OpenClaw queue wire contract for inbound parsing and envelope replies. See [OpenClaw Queue Message Format Guide](../../doc/OpenClaw-Queue-Message-Format-Guide.en.md) for standard `MessageEnvelope` payloads, non-standard normalization, fixed envelope replies, and cross-language SDK adapter guidance.
