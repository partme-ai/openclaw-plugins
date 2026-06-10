<div align="center">

# OpenClaw RabbitMQ

**OpenClaw plugin — RabbitMQ channel bridge with multi-agent async collaboration and topic subscription support**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--rabbitmq-blue)
![Node](https://img.shields.io/badge/Node.js-20+-green)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

[English](./README.md) | [简体中文](./README.zh-CN.md)

## 📖 Introduction

`@partme.ai/openclaw-rabbitmq` is an OpenClaw channel plugin for [OpenClaw](https://github.com/openclaw/openclaw) that connects to an external RabbitMQ server and bridges RabbitMQ messages to OpenClaw agents. The plugin uses [`defineChannelPluginEntry`](https://docs.openclaw.ai/plugins/sdk-entrypoints#definechannelpluginentry) / `ChannelPlugin` per the OpenClaw channel plugin guide (not `definePluginEntry`, which is for non-channel plugins). It supports:

- Explicit `topicPattern -> agentId` bindings
- Multi-topic subscription (`subscribeTopics`)
- RabbitMQ Topic Exchange with wildcard matching (`*` and `#`)
- Inbound payload parsing strategy (`JSON.text` first, fallback plain text)
- Runtime reply dispatch via RabbitMQ topic-based routing
- Session isolation following OpenClaw `session.dmScope`

## 🎯 Core Capabilities

- **External RabbitMQ server**: connects to an existing RabbitMQ server
- **Explicit routing first**: `topicBindings` has higher priority than standard topic fallback
- **Standard fallback**: `openclaw.agent.<agentId>.in` still works when no binding matches
- **Reply topic control**: use `replyTopicPattern` per binding, otherwise derive from inbound topic
- **Session context mapping**: each RabbitMQ message records agent/account context
- **Enterprise security baseline**: uses RabbitMQ's built-in security features (TLS, authentication, authorization)

### Plugin lifecycle

- The RabbitMQ connection starts when the Gateway runs `gateway.startAccount` for the RabbitMQ channel (single account `default` in this release).
- HTTP routes are registered in `registerFull` (plugin-authenticated):
  - `GET /rabbitmq/health` - readiness + last error
  - `GET /rabbitmq/stats` - stats + session counters
  - `GET /rabbitmq/status` - stats + active config snapshot
- Session key scope follows OpenClaw global `session.dmScope` (for example `per-channel-peer`), instead of a channel-local `channels.rabbitmq.session.dmScope`.
- If `channels.rabbitmq.session.dmScope` is present, the plugin logs a warning and ignores it.

### Tools

- `mq.publish` - publish a message to the configured exchange
- `mq.request` - request/reply via a RabbitMQ queue using Direct Reply-to

## 🏗️ Message Flow

1. Device publishes RabbitMQ message to a topic exchange.
2. Plugin receives message from the subscribed queue.
3. Plugin resolves route:
   - First: `topicBindings`
   - Fallback: standard `openclaw.agent.<agentId>.in`
4. Plugin parses payload (`JSON.text` -> plain text fallback).
5. Plugin dispatches to OpenClaw runtime.
6. Reply is published to the derived topic pattern.

## 🚀 Quick Start

### Prerequisites

- OpenClaw `>= 2026.4.0`
- Node.js `20+`
- RabbitMQ server `>= 3.8`

### Install

```bash
openclaw plugins install @partme.ai/openclaw-rabbitmq
```

Requires `@partme.ai/openclaw-message-sdk >= 2026.5.22`.

### Minimal config (`openclaw.json`)

```json
{
  "channels": {
    "rabbitmq": {
      "url": "amqp://localhost",
      "exchange": "openclaw",
      "exchangeType": "topic",
      "topicPrefix": "openclaw",
      "subscribeTopics": [
        "devices.*.in",
        "openclaw.agent.*.in.#"
      ],
      "topicBindings": [
        {
          "topicPattern": "devices.*.in",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyTopicPattern": "devices.${peerId}.out"
        }
      ],
      "payload": {
        "mode": "jsonTextOrPlain"
      },
      "dispatch": {
        "mode": "embedded-agent",
        "timeoutMs": 120000,
        "reply": { "enabled": true }
      }
    }
  },
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

### Advanced config (`openclaw.json`)

```json
{
  "channels": {
    "rabbitmq": {
      "url": "amqps://user:password@rabbitmq.example.com:5671",
      "exchange": "openclaw",
      "exchangeType": "topic",
      "topicPrefix": "openclaw",
      "subscribeTopics": [
        "devices.*.in",
        "sensors.*.data",
        "openclaw.agent.*.in.#"
      ],
      "topicBindings": [
        {
          "topicPattern": "devices.*.in",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyTopicPattern": "devices.${peerId}.out"
        },
        {
          "topicPattern": "sensors.*.data",
          "agentId": "sensor-agent",
          "accountId": "default",
          "replyTopicPattern": "sensors.${peerId}.response"
        },
        {
          "topicPattern": "openclaw.agent.admin.in.#",
          "agentId": "admin-agent",
          "accountId": "admin",
          "replyTopicPattern": "openclaw.agent.admin.out"
        }
      ],
      "payload": {
        "mode": "jsonTextOrPlain"
      },
      "connection": {
        "timeoutMs": 30000,
        "heartbeatSeconds": 30,
        "reconnectAttempts": 5,
        "reconnectDelayMs": 5000
      },
      "consume": {
        "prefetch": 50,
        "concurrency": 4,
        "requeueOnError": true
      },
      "idempotency": {
        "enabled": false
      }
    }
  },
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

## 🧭 Topic Rules

### Topic Format

- Standard inbound: `openclaw.agent.<agentId>.in[.<peerId>]`
- Standard outbound: `openclaw.agent.<agentId>.out[.<peerId>]`
- Explicit mapping: configured by `topicBindings.topicPattern`

### Wildcard Support

RabbitMQ Topic Exchange supports wildcards:
- `*` - matches exactly one word
- `#` - matches zero or more words
The plugin also treats `+` as an alias of `*` and normalizes `/` to `.` for compatibility, but `.` + `*`/`#` is recommended.

### Priority

1. `topicBindings` match (explicit routing)
2. Standard inbound parsing (fallback)
3. Drop message when neither matches

## 🔐 Session Isolation (dmScope)

Session key granularity follows OpenClaw global `session.dmScope` configuration. No channel-local `channels.rabbitmq.session.dmScope` is needed or used.

| dmScope | Session Key Format | Behavior |
|---------|-------------------|----------|
| `per-peer` (default) | `agent:<agentId>:direct:<peerId>` | One session per (agent, peer) pair |
| `per-channel-peer` | `agent:<agentId>:rabbitmq:direct:<peerId>` | One session per channel + (agent, peer) |
| `per-account-channel-peer` | `agent:<agentId>:rabbitmq:<accountId>:direct:<peerId>` | One session per account + channel + (agent, peer) |
| `main` | `agent:<agentId>:main` | Single shared session per agent |

To configure, set in your `openclaw.json`:

```json
{
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

## 🔧 Configuration Reference

### Connection

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | string | - | RabbitMQ server URL (required) |
| `exchange` | string | `openclaw` | Exchange name |
| `exchangeType` | string | `topic` | Exchange type (topic, direct, fanout) |
| `topicPrefix` | string | `openclaw` | Topic prefix for standard format |
| `connection.timeout` | number | 30000 | Connection timeout (ms) |
| `connection.reconnectAttempts` | number | 5 | Reconnect attempts |
| `connection.reconnectDelay` | number | 5000 | Reconnect delay (ms) |

### Topics

| Field | Type | Description |
| --- | --- | --- |
| `subscribeTopics` | string[] | List of topic patterns to subscribe to |
| `topicBindings` | array | Explicit topic to agent bindings |

### Topic Bindings

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `topicPattern` | string | - | RabbitMQ topic pattern (required) |
| `agentId` | string | - | Target agent ID (required) |
| `accountId` | string | `default` | Account ID |
| `replyTopicPattern` | string | - | Reply topic pattern (supports ${agentId}, ${peerId}, ${rest} placeholders) |

### Payload

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `payload.mode` | string | `jsonTextOrPlain` | Payload parsing mode (jsonTextOrPlain, jsonOnly, plainText) |

## 🧪 Testing

### Unit tests

```bash
npm test
```

### Integration test client

```bash
npm run test:client
```

`scripts/test-client.ts` will:

- connect to RabbitMQ server (default `amqp://localhost`)
- subscribe to configured topics
- publish JSON payload and plain text payload
- receive and display replies
- fail on timeout when no reply is received

### Environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `RABBITMQ_URL` | RabbitMQ server URL | `amqp://localhost` |
| `RABBITMQ_EXCHANGE` | Exchange name | `openclaw` |
| `RABBITMQ_EXCHANGE_TYPE` | Exchange type | `topic` |
| `RABBITMQ_TOPIC_PREFIX` | Topic prefix | `openclaw` |
| `RABBITMQ_AGENT_ID` | Test agent ID | `support-bot` |
| `RABBITMQ_PEER_ID` | Test peer ID | `test-peer` |
| `RABBITMQ_TEST_SUBSCRIBE_TOPICS` | Comma-separated subscribe topics | `openclaw.agent.support-bot.out.test-peer,openclaw.#` |
| `RABBITMQ_TEST_PUBLISH_CASES` | JSON array of publish cases | `[{"routingKey": "openclaw.agent.support-bot.in.test-peer", "payload": "{\"text\": \"hello from json.text test\"}"}, {"routingKey": "openclaw.agent.support-bot.in.test-peer", "payload": "hello from plain text test"}]` |
| `RABBITMQ_TEST_TIMEOUT_MS` | Test timeout | `20000` |

## 🤖 GitHub Actions

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `.github/workflows/ci.yml` | Push / PR to `main` or `develop` | Install, typecheck, build, test, upload `dist/` |
| `.github/workflows/release.yml` | Tag `v*` / manual dispatch | Build, test, publish npm package |

## 📦 Publishing

- Package: `@partme.ai/openclaw-rabbitmq`
- Required secret: `NPM_TOKEN`

Tag release example:

```bash
npm version patch
git push origin main --follow-tags
```

## 📁 Project Structure

```text
openclaw-rabbitmq/
├── src/
│   ├── index.ts              # defineChannelPluginEntry + registerFull (HTTP)
│   ├── channel.ts            # ChannelPlugin
│   ├── rabbitmq-server.ts    # RabbitMQ connection management
│   ├── rabbitmq-config.ts    # Config parsing and validation
│   ├── rabbitmq-state.ts     # State management
│   ├── inbound.ts            # Process inbound messages
│   ├── outbound.ts           # ChannelOutboundAdapter
│   ├── topic-router.ts       # Topic routing and wildcard matching
│   ├── session-mapper.ts     # Session mapping and context
│   ├── dm-scope.ts           # Session isolation (dmScope)
│   ├── runtime.ts            # Runtime management
│   └── types.ts              # Type definitions
├── scripts/
│   └── test-client.ts        # Integration test client
├── .github/
│   └── workflows/
│       ├── ci.yml            # CI workflow
│       └── release.yml       # Release workflow
├── openclaw.plugin.json
├── package.json
└── README.md / README.zh-CN.md
```

## 📚 Usage Examples

### Example 1: IoT Device Integration

**Config:**
```json
{
  "channels": {
    "rabbitmq": {
      "url": "amqp://localhost",
      "exchange": "openclaw",
      "subscribeTopics": ["devices/+/status"],
      "topicBindings": [
        {
          "topicPattern": "devices/+/status",
          "agentId": "iot-agent",
          "replyTopicPattern": "devices/${peerId}/command"
        }
      ]
    }
  }
}
```

**Device sends status:**
```javascript
// Topic: devices/sensor-001/status
// Payload: {"text": "Temperature: 25°C, Humidity: 60%"}
```

**Agent replies with command:**
```javascript
// Topic: devices/sensor-001/command
// Payload: {"text": "Set temperature threshold to 28°C"}
```

### Example 2: Multi-Agent Collaboration

**Config:**
```json
{
  "channels": {
    "rabbitmq": {
      "url": "amqp://localhost",
      "exchange": "openclaw",
      "subscribeTopics": [
        "openclaw.agent.*/in",
        "team/+/tasks"
      ],
      "topicBindings": [
        {
          "topicPattern": "team/frontend/tasks",
          "agentId": "frontend-agent"
        },
        {
          "topicPattern": "team/backend/tasks",
          "agentId": "backend-agent"
        }
      ]
    }
  }
}
```

**Team leader sends task:**
```javascript
// Topic: team/frontend/tasks
// Payload: {"text": "Implement login page UI"}
```

**Frontend agent replies:**
```javascript
// Topic: openclaw.agent.team-leader.in
// Payload: {"text": "Login page UI implementation started"}
```

### Example 3: System Monitoring

**Config:**
```json
{
  "channels": {
    "rabbitmq": {
      "url": "amqp://localhost",
      "exchange": "openclaw",
      "subscribeTopics": ["system/alert/*"],
      "topicBindings": [
        {
          "topicPattern": "system/alert/security",
          "agentId": "security-agent"
        },
        {
          "topicPattern": "system/alert/performance",
          "agentId": "ops-agent"
        },
        {
          "topicPattern": "system/alert/*",
          "agentId": "admin-agent"
        }
      ]
    }
  }
}
```

**Monitoring system sends alert:**
```javascript
// Topic: system/alert/security
// Payload: {"text": "Unauthorized access detected"}
```

**Security agent receives and processes alert**

## OpenClaw documentation

Official docs for plugins, the SDK, and this channel's building blocks:

### Plugins

- [Tools — Plugins](https://docs.openclaw.ai/tools/plugin)
- [Community plugins](https://docs.openclaw.ai/plugins/community)
- [Bundles](https://docs.openclaw.ai/plugins/bundles)
- [Voice call](https://docs.openclaw.ai/plugins/voice-call)

### Building plugins

- [Building plugins](https://docs.openclaw.ai/plugins/building-plugins)
- [SDK — Channel plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins) (this package is a **channel** plugin)
- [SDK — Provider plugins](https://docs.openclaw.ai/plugins/sdk-provider-plugins)
- [SDK — Migration](https://docs.openclaw.ai/plugins/sdk-migration)

### SDK reference

- [SDK overview](https://docs.openclaw.ai/plugins/sdk-overview)
- [SDK entry points](https://docs.openclaw.ai/plugins/sdk-entrypoints) (`defineChannelPluginEntry`, `registerFull`, etc.)
- [SDK runtime](https://docs.openclaw.ai/plugins/sdk-runtime)
- [SDK setup](https://docs.openclaw.ai/plugins/sdk-setup)
- [SDK testing](https://docs.openclaw.ai/plugins/sdk-testing)
- [Manifest](https://docs.openclaw.ai/plugins/manifest) (`openclaw.plugin.json`, `package.json` `openclaw` field)
- [Architecture](https://docs.openclaw.ai/plugins/architecture)

## ❓ FAQ

### Does this plugin require an external RabbitMQ server?

Yes. It connects to an existing RabbitMQ server.

### How is payload parsed?

Default mode is `jsonTextOrPlain`: parse `JSON.text` first, otherwise use raw text.

### How do I bind one topic to one agent?

Use `topicBindings` with `topicPattern` and `agentId`; optionally set `replyTopicPattern`.

### How do I support multiple agents receiving the same message?

Use a topic pattern with wildcard and bind multiple agents to the same pattern, or use a fanout exchange.

### How does session isolation work?

Session key scope follows OpenClaw global `session.dmScope` (e.g., `per-channel-peer`), ensuring messages are processed in the correct session context.

### Can I use TLS for RabbitMQ connection?

Yes, use `amqps://` URL scheme and configure RabbitMQ server with TLS.

## 📄 License

MIT

## Message Format Guide

RabbitMQ uses the shared OpenClaw queue wire contract for inbound parsing and reply serialization. See [OpenClaw Queue Message Format Guide](../../doc/OpenClaw-Queue-Message-Format-Guide.en.md) for standard `MessageEnvelope` payloads, non-standard normalization, `payload.outboundFormat`, and cross-language SDK adapter guidance.
