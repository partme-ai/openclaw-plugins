<div align="center">

# OpenClaw Web MQTT

**OpenClaw channel plugin — enterprise MQTT over WebSocket with topic governance and agent binding**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--web--mqtt-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

[English](./README.md) | [简体中文](./README_CN.md)

## Introduction

`@partme.ai/openclaw-web-mqtt` is an OpenClaw **channel plugin** built on the latest channel SDK entrypoints:

- `defineChannelPluginEntry` for full runtime registration
- `defineSetupPluginEntry` for setup-only loading
- runtime store pattern for safe runtime injection

It provides a hardened embedded MQTT-over-WebSocket broker for browser and web applications, and routes inbound messages into OpenClaw agent replies.

## Core capabilities

- **Multi-topic subscription governance**: `subscribeTopics` allowlist with MQTT wildcards (`+`, `#`)
- **Topic-agent binding**: explicit `topicPattern -> agentId` routing with optional `replyTopic`
- **Standard fallback route**: `<topicPrefix>agent/<agentId>/in` -> `<topicPrefix>agent/<agentId>/out`
- **Enterprise controls**:
  - auth and per-user topic allowlist
  - TLS/WSS support
  - max payload and websocket frame limits
  - idle timeout and connection governance
  - route metrics and drop reason visibility

## Message flow

1. Web MQTT client publishes topic/payload
2. Plugin checks `subscribeTopics`
3. Route resolution:
   - first `topicBindings`
   - then standard fallback topic
4. Payload parsing (`jsonTextOrPlain`)
5. Dispatch to OpenClaw runtime reply pipeline
6. Publish reply to binding `replyTopic` or derived default out topic

## Quick start

### Prerequisites

- OpenClaw `>= 2026.4.0`
- Node.js `22+`

### Install

```bash
openclaw plugins install @partme.ai/openclaw-web-mqtt
```

### Minimal config (`openclaw.json`)

```json
{
  "channels": {
    "mqtt-ws": {
      "port": 15675,
      "path": "/ws",
      "topicPrefix": "openclaw/",
      "subscribeTopics": [
        "openclaw/agent/+/in",
        "devices/+/in"
      ],
      "topicBindings": [
        {
          "topicPattern": "devices/+/in",
          "agentId": "iot-agent",
          "replyTopic": "devices/reply"
        }
      ],
      "payload": { "mode": "jsonTextOrPlain" },
      "auth": {
        "required": true,
        "allowAnonymous": false,
        "users": [
          {
            "username": "mqtt_user",
            "password": "change_me",
            "publishAllow": ["openclaw/agent/+/in", "devices/+/in"],
            "subscribeAllow": ["openclaw/agent/+/out", "devices/reply"]
          }
        ]
      },
      "tls": {
        "enabled": false
      },
      "ws": {
        "compress": true,
        "idleTimeoutMs": 60000,
        "maxFrameSize": 262144
      },
      "limits": {
        "maxPayloadBytes": 1048576,
        "maxSubscriptionsPerClient": 200
      }
    }
  }
}
```

## Enterprise hardening checklist

- Replace default credentials and enforce dedicated users
- Enable `tls.enabled` and deploy WSS in production
- Set strict `publishAllow` / `subscribeAllow`
- Tune `maxPayloadBytes`, `maxFrameSize`, `idleTimeoutMs` by traffic profile
- Use reverse proxy policy and network ACL for perimeter controls

## Status and observability

`GET /mqtt-ws/status` (plugin-auth route) exposes:

- connection count
- accepted/dropped inbound counters
- binding-vs-standard route counters
- outbound publish counters
- last error summary
- sanitized active config snapshot

## Testing

### Unit tests

```bash
npm test
```

### Integration test client

```bash
npm run test:client
```

Default test endpoint:

- `MQTT_BROKER_URL=ws://127.0.0.1:15675/ws`

Supported env vars:

- `MQTT_BROKER_URL`
- `MQTT_CLIENT_ID`
- `MQTT_TEST_TIMEOUT_MS`
- `MQTT_TEST_SUBSCRIBE_TOPICS`
- `MQTT_TEST_PUBLISH_CASES`
- `MQTT_TEST_TOPIC_JSON`
- `MQTT_TEST_TOPIC_PLAIN`
- `MQTT_TEST_REPLY_TOPIC`

## CI and release

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `.github/workflows/ci.yml` | Push / PR | install, typecheck, build, test, upload artifact |
| `.github/workflows/release.yml` | tag `v*` / manual | build, test, publish npm (skip existing version) |

Release details: [`RELEASING.md`](./RELEASING.md)

## RabbitMQ Web MQTT baseline

This plugin references RabbitMQ Web MQTT production practices:

- default websocket endpoint convention `15675/ws`
- explicit plugin enabling and secure user setup
- WSS/TLS deployment recommendations
- websocket tuning (frame size / timeout / compression)

Reference: [RabbitMQ Web MQTT](https://www.rabbitmq.com/docs/web-mqtt)

## OpenClaw documentation

### Plugins

- [Tools - Plugins](https://docs.openclaw.ai/tools/plugin)
- [Community plugins](https://docs.openclaw.ai/plugins/community)
- [Bundles](https://docs.openclaw.ai/plugins/bundles)
- [Voice call](https://docs.openclaw.ai/plugins/voice-call)

### Building plugins

- [Building plugins](https://docs.openclaw.ai/plugins/building-plugins)
- [SDK - Channel plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins)
- [SDK - Provider plugins](https://docs.openclaw.ai/plugins/sdk-provider-plugins)
- [SDK - Migration](https://docs.openclaw.ai/plugins/sdk-migration)

### SDK reference

- [SDK overview](https://docs.openclaw.ai/plugins/sdk-overview)
- [SDK entry points](https://docs.openclaw.ai/plugins/sdk-entrypoints)
- [SDK runtime](https://docs.openclaw.ai/plugins/sdk-runtime)
- [SDK setup](https://docs.openclaw.ai/plugins/sdk-setup)
- [SDK testing](https://docs.openclaw.ai/plugins/sdk-testing)
- [Manifest](https://docs.openclaw.ai/plugins/manifest)
- [Architecture](https://docs.openclaw.ai/plugins/architecture)

## License

MIT
