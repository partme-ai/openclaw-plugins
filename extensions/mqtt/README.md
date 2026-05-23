<div align="center">

# OpenClaw MQTT

**OpenClaw plugin — MQTT channel bridge with multi-topic routing and explicit topic bindings**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--mqtt-blue)
![Node](https://img.shields.io/badge/Node.js-20+-green)
![License](https://img.shields.io/badge/License-MIT-green)
![MQTT](https://img.shields.io/badge/MQTT-3.1.1%2F5.0-orange)

</div>

[English](./README.md) | [简体中文](./README.zh-CN.md)

## Introduction

`@partme.ai/openclaw-mqtt` is an OpenClaw channel plugin for [OpenClaw](https://github.com/openclaw/openclaw) that embeds an MQTT broker ([Aedes](https://github.com/moscajs/aedes)) and bridges MQTT devices to OpenClaw agents. The plugin uses [`defineChannelPluginEntry`](https://docs.openclaw.ai/plugins/sdk-entrypoints#definechannelpluginentry) + `ChannelPlugin` per the official channel plugin guide (not `definePluginEntry`, which is for non-channel plugins).

### Core Capabilities

- **Embedded Broker**: no external MQTT broker required, works out of the box
- **Explicit Binding First**: `topicBindings` has the highest routing priority
- **Standard Topic Fallback**: falls back to `openclaw/agent/<agentId>/in` when no binding matches
- **Controllable Reply Topic**: supports binding-level `replyTopic`, otherwise auto-derives `/out`
- **Session Context Mapping**: saves agent/account/replyTopic info per session
- **Enterprise Security**: MQTT over TLS, user-level topic ACL, anonymous access control, payload size limits

### Lifecycle

- Embedded broker starts when Gateway runs `startAccount` for MQTT channel (single account `default` in current release)
- HTTP `GET /mqtt/status` is registered in `registerFull`, exposing broker stats, config snapshot, and policy hot-reload metadata
- Session key granularity follows OpenClaw global `session.dmScope` configuration
- **`package.json` → `openclaw.setupEntry`** points to `dist/setup-entry.js`, exporting a lightweight entry via `defineSetupPluginEntry`

### Highlights

#### 1. Embedded Broker

Aedes MQTT broker starts in-process with zero external dependencies. Supports MQTT 3.1.1 and MQTT 5.0 protocol versions.

#### 2. Topic Routing

- **Explicit binding**: `topicBindings` array with `topicPattern` → `agentId` + optional `replyTopic`
- **Standard fallback**: `openclaw/agent/<agentId>/in` ↔ `openclaw/agent/<agentId>/out`
- **Wildcard support**: `+` (single segment) and `#` (multi-segment) matching on all topic filters

#### 3. Enterprise Controls

| Area | Feature |
|------|---------|
| Authentication | Username/password, per-user ACL, anonymous access toggle |
| Transport | TCP (1883) + TLS (8883) with configurable cert/key/CA |
| QoS | 0 (at most once) with mailbox soft limit, 1 (at least once) with ACK retry |
| Persistence | Multi-backend: memory, redis (with mqemitter), mongodb, level, nedb |
| Limits | Configurable max payload bytes, max connections |
| Sessions | Expiry-based cleanup, persistent across reconnect |
| Observability | Prometheus metrics (`prom-client`), structured JSON audit logs |
| Will / Retain | Configurable retain policy, will message allowlist |

### Scaling

Default single-process in-memory deployment. Enable persistence for multi-Gateway horizontal scaling:

```json
{
  "channels": {
    "mqtt": {
      "persistence": {
        "enabled": true,
        "backend": "redis",
        "redis": {
          "host": "redis.example.com",
          "port": 6379
        }
      }
    }
  }
}
```

Supports multiple persistence backends: memory, redis, mongodb, level, nedb.

## Message Flow

1. Device publishes MQTT message
2. Plugin filters via `subscribeTopics` allowlist
3. Route decision (`topicBindings` first → standard Topic fallback)
4. Payload parsing (`JSON.text` → plain text fallback)
5. Dispatch to OpenClaw runtime
6. Reply published to `replyTopic` or default `/out`

## Quick Start

### Prerequisites

- OpenClaw `>= 2026.4.0`
- Node.js `20+`

### Install

```bash
openclaw plugins install @partme.ai/openclaw-mqtt
```

Requires `@partme.ai/openclaw-message-sdk >= 2026.5.22`.

### Minimal Config

```json
{
  "channels": {
    "mqtt": {
      "port": 1883,
      "maxConnections": 1000,
      "subscribeTopics": [
        "devices/+/in",
        "openclaw/agent/+/in"
      ],
      "topicBindings": [
        {
          "topicPattern": "devices/+/in",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyTopic": "devices/reply"
        }
      ],
      "payload": {
        "mode": "jsonTextOrPlain"
      }
    }
  },
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

## Topic Rules

| Type | Format |
|------|--------|
| Standard inbound | `openclaw/agent/<agentId>/in` |
| Standard outbound | `openclaw/agent/<agentId>/out` |
| Explicit routing | Defined by `topicBindings.topicPattern` |

Routing priority: `topicBindings` → Standard inbound parsing → Drop

## Configuration

### Required

| Field | Description |
|-------|-------------|
| `port` | MQTT TCP listener port (default: `1883`) |

### Channel

| Field | Default | Description |
|-------|---------|-------------|
| `port` | `1883` | MQTT TCP listener port |
| `maxConnections` | `1000` | Maximum concurrent connections |
| `subscribeTopics` | `[]` | Allowed inbound topic patterns |
| `topicBindings` | `[]` | Explicit topic → agent bindings |

### Auth

| Field | Default | Description |
|-------|---------|-------------|
| `auth.enabled` | `false` | Enable client authentication |
| `auth.allowAnonymous` | `false` | Allow anonymous connections |
| `auth.users` | `[]` | User list with per-user publish/subscribe ACL |

### TLS

| Field | Default | Description |
|-------|---------|-------------|
| `tls.enabled` | `false` | Enable TLS listener (port 8883) |
| `tls.certFile` | — | TLS certificate path (PEM) |
| `tls.keyFile` | — | TLS key path (PEM) |
| `tls.caFile` | — | Optional CA certificate path |
| `tls.requestCert` | `false` | Request client certificate |
| `tls.rejectUnauthorized` | `false` | Reject unauthorized certs |

### Limits & Session

| Field | Default | Description |
|-------|---------|-------------|
| `limits.maxPayloadBytes` | `1048576` | Max payload size in bytes |
| `session.maxExpirySeconds` | `86400` | Session expiry after disconnect |
| `session.persistentAcrossReconnect` | `true` | Allow sessions to survive reconnect |

### Persistence

| Field | Default | Description |
|-------|---------|-------------|
| `persistence.enabled` | `false` | Enable persistence for horizontal scaling |
| `persistence.backend` | `"memory"` | Backend: `memory`, `redis`, `mongodb`, `level`, `nedb` |

## Testing

```bash
# Unit tests
npm test

# Integration tests
npm run test:client
```

Integration test client environment variables: `MQTT_BROKER_URL`, `MQTT_CLIENT_ID`, `MQTT_TEST_TIMEOUT_MS`, etc.

## GitHub Actions

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | Push / PR to `main` | Install, typecheck, build, test |
| `release.yml` | Tag `v*` | Build, test, publish npm package |

## Publishing

```bash
npm version patch
git push origin main --follow-tags
```

## Project Structure

```
openclaw-mqtt/
├── src/
│   ├── index.ts              # defineChannelPluginEntry + registerFull
│   ├── setup-entry.ts        # defineSetupPluginEntry lightweight entry
│   ├── mqtt-plugin.ts        # ChannelPlugin definition
│   ├── gateway-mqtt.ts       # Gateway lifecycle management
│   ├── outbound.ts           # ChannelOutboundAdapter
│   ├── inbound.ts            # Inbound message handling
│   ├── broker.ts             # Aedes TCP server
│   ├── topic-router.ts       # Topic routing
│   ├── session-mapper.ts     # Session context mapping
│   ├── mqtt-config.ts        # Config parsing
│   └── runtime.ts            # Runtime
├── scripts/
│   └── test-client.ts       # Integration test client
├── openclaw.plugin.json     # Plugin metadata
├── package.json
└── README.md / README.zh-CN.md
```

## Tech Stack

| Area | Details |
|------|---------|
| Runtime | Node.js 20+, ESM |
| Broker | [Aedes](https://github.com/moscajs/aedes) |
| Persistence | aedes-persistence-redis, aedes-persistence-mongodb, aedes-persistence-level, aedes-persistence-nedb |
| Metrics | [prom-client](https://github.com/siimon/prom-client) |
| Host | OpenClaw plugin API (`defineChannelPluginEntry`, `registerService`) |

## Version

| Item | Version |
|------|---------|
| @partme.ai/openclaw-mqtt | 0.1.13 |
| Recommended Node | 20+ |

## Security

- **Never store credentials in config**: use environment variables or secret managers for passwords and API keys
- **TLS verification**: enable `tls.rejectUnauthorized` in production to prevent MITM attacks
- **ACL scoping**: use `auth.users[].publishAllow` / `subscribeAllow` to restrict device topics
- **Audit logging**: enable `audit.enabled` for structured JSON logs compatible with ELK/SIEM

## FAQ

**Does this plugin require an external MQTT broker?**

No, the plugin embeds `aedes` broker.

**How is payload parsed?**

Default `jsonTextOrPlain` mode: parses `JSON.text` field first, falls back to raw text if not found.

**How do I bind a Topic to an Agent?**

Configure `topicPattern` and `agentId` via `topicBindings`, with optional `replyTopic`.

## Links

| Resource | URL |
|----------|-----|
| OpenClaw | [https://docs.openclaw.ai](https://docs.openclaw.ai) |
| OpenClaw (source) | [https://github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) |
| Aedes MQTT Broker | [https://github.com/moscajs/aedes](https://github.com/moscajs/aedes) |
| RabbitMQ MQTT Reference | [https://www.rabbitmq.com/docs/mqtt](https://www.rabbitmq.com/docs/mqtt) |
| Chinese README | [README.zh-CN.md](./README.zh-CN.md) |

### OpenClaw Documentation

| Topic | URL |
|-------|-----|
| Channel plugins | [https://docs.openclaw.ai/plugins/sdk-channel-plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins) |
| SDK entry points | [https://docs.openclaw.ai/plugins/sdk-entrypoints](https://docs.openclaw.ai/plugins/sdk-entrypoints) |
| SDK runtime | [https://docs.openclaw.ai/plugins/sdk-runtime](https://docs.openclaw.ai/plugins/sdk-runtime) |
| SDK setup | [https://docs.openclaw.ai/plugins/sdk-setup](https://docs.openclaw.ai/plugins/sdk-setup) |

## License

This project is licensed under the [MIT License](LICENSE).

## Acknowledgements

- [Aedes](https://github.com/moscajs/aedes) — Embedded MQTT broker
- [RabbitMQ](https://www.rabbitmq.com/) — Enterprise MQTT feature reference
- [OpenClaw](https://docs.openclaw.ai) — Plugin host runtime

---

<div align="center">

**If this project helps you, consider giving it a star**

Made with love by PartMe

</div>
