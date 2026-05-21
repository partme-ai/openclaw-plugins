# @partme.ai/openclaw-rockermq

> RocketMQ Channel Plugin for OpenClaw — producer and push-consumer integration with topic+tag bindings, 3 dispatch modes, health endpoints, and mq.publish tool.

[![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--rocketmq-blue)](https://www.npmjs.com/package/@partme.ai/openclaw-rocketmq)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

[简体中文](./README.md) | [English](./README.en.md)

---

## Overview

`@partme.ai/openclaw-rockermq` bridges external RocketMQ messages into OpenClaw agents and publishes agent replies back to RocketMQ. It uses `rocketmq-client-nodejs` for Producer and PushConsumer, with a full OpenClaw channel plugin lifecycle.

## Features

- **Producer + PushConsumer** — Full RocketMQ production and consumption lifecycle
- **Topic+Tag Bindings** — Explicit `topic + tag -> agentId` routing rules
- **3 Dispatch Modes** — `embedded-agent` (default) / `subagent` / `reply-pipeline`
- **Payload Strategies** — `jsonTextOrPlain` (default) / `jsonOnly` / `plainText`
- **Fallback Topics** — Standard pattern: `openclaw.agent.<agentId>.in[.<peerId>]`
- **Reply Topic Routing** — Agent replies published to configured `replyTopic` / `replyTag`
- **Health Endpoints** — `/rockermq/health`, `/rockermq/stats`, `/rockermq/status`
- **`mq.publish` Tool** — Debug tool for publishing messages to RocketMQ
- **Session Mapping** — Tracks producer-consumer-conversation session mappings
- **Idempotency** — Optional deduplication with configurable TTL
- **Setup Wizard** — Interactive setup via OpenClaw setup wizard

## Quick Start

### Installation

```bash
openclaw plugins install @partme.ai/openclaw-rocketmq
```

### Minimal Configuration

```json
{
  "channels": {
    "rockermq": {
      "endpoints": "127.0.0.1:8081",
      "namespace": "",
      "topicPrefix": "openclaw",
      "producer": {
        "groupId": "openclaw-rockermq-producer"
      },
      "consumer": {
        "groupId": "openclaw-rockermq-consumer",
        "subscriptions": [
          { "topic": "device.status", "filterExpression": "*" }
        ]
      },
      "topicBindings": [
        {
          "topic": "device.status",
          "tag": "iot",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyTopic": "device.command",
          "replyTag": "command"
        }
      ],
      "dispatch": {
        "mode": "embedded-agent",
        "timeoutMs": 120000,
        "reply": { "enabled": true }
      }
    }
  }
}
```

## Configuration Reference

```jsonc
{
  "channels": {
    "rockermq": {
      "endpoints": "127.0.0.1:8081",           // RocketMQ proxy/namesrv endpoint
      "namespace": "",                          // RocketMQ namespace
      "topicPrefix": "openclaw",               // Topic prefix for fallback topics
      "sessionCredentials": {                   // Optional: ACL credentials
        "accessKey": "",
        "accessSecret": "",
        "securityToken": ""
      },
      "producer": {
        "groupId": "openclaw-rockermq-producer", // Producer group ID
        "requestTimeout": 5000                   // Request timeout in ms
      },
      "consumer": {
        "groupId": "openclaw-rockermq-consumer", // Consumer group ID
        "subscriptions": [                       // Topics to subscribe
          { "topic": "my.topic", "filterExpression": "*" }
        ],
        "maxCacheMessageCount": 1024,
        "maxCacheMessageSizeInBytes": 67108864,
        "longPollingTimeout": 30000,
        "requestTimeout": 3000,
        "reconsumeOnError": true                 // Re-consume on dispatch error
      },
      "topicBindings": [                         // Topic-to-agent routing rules
        {
          "topic": "device.status",
          "tag": "iot",
          "agentId": "iot-agent",
          "accountId": "default",
          "peerId": "device-1",                  // Optional: peer identifier
          "replyTopic": "device.command",        // Optional: reply topic
          "replyTag": "command"                   // Optional: reply tag
        }
      ],
      "payload": {
        "mode": "jsonTextOrPlain"                // "jsonTextOrPlain" | "jsonOnly" | "plainText"
      },
      "dispatch": {
        "mode": "embedded-agent",                // "embedded-agent" | "subagent" | "reply-pipeline"
        "timeoutMs": 120000,                      // Agent processing timeout
        "reply": { "enabled": true }              // Enable reply publishing
      },
      "idempotency": {                           // Optional: message dedup
        "enabled": false,
        "ttlMs": 600000,
        "maxEntries": 10000
      }
    }
  }
}
```

### Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `endpoints` | string | `"127.0.0.1:8081"` | RocketMQ proxy/namesrv endpoint |
| `namespace` | string | `""` | RocketMQ namespace |
| `topicPrefix` | string | `"openclaw"` | Topic prefix for fallback message routing |
| `producer.groupId` | string | `"openclaw-rockermq-producer"` | Producer group ID |
| `producer.requestTimeout` | number | `5000` | Producer request timeout (ms) |
| `consumer.groupId` | string | `"openclaw-rockermq-consumer"` | Consumer group ID |
| `consumer.reconsumeOnError` | boolean | `true` | Re-consume message on dispatch error |
| `payload.mode` | string | `"jsonTextOrPlain"` | Payload parsing mode |
| `dispatch.mode` | string | `"embedded-agent"` | Agent dispatch mode |
| `dispatch.timeoutMs` | number | `120000` | Agent processing timeout (ms) |

### Dispatch Modes

| Mode | Description |
|------|-------------|
| `embedded-agent` | Messages are routed to an agent embedded within the current process |
| `subagent` | Messages are routed to a separate subagent instance |
| `reply-pipeline` | Messages are processed through a reply pipeline (request/reply pattern) |

### Payload Modes

| Mode | Description |
|------|-------------|
| `jsonTextOrPlain` | Prefer JSON `text` field, fallback to raw text |
| `jsonOnly` | Parse payload as JSON only |
| `plainText` | Treat entire payload as plain text |

## Message Model

### Inbound (RocketMQ -> Agent)

- **Explicit binding first**: Matched against `topicBindings[].topic + topicBindings[].tag`
- **Standard fallback**: `{topicPrefix}.agent.<agentId>.in[.<peerId>]`
- **Payload parsing**: `jsonTextOrPlain` — reads `text` field from JSON, or uses raw text

### Outbound (Agent -> RocketMQ)

- **Session binding**: Uses `replyTopic` / `replyTag` from active session
- **Standard fallback**: `{topicPrefix}.agent.<agentId>.out[.<peerId>]`
- **Consumption**: PushConsumer with `ConsumeResult.SUCCESS` / `FAILURE` acknowledgment

## Health Endpoints

Available when the plugin registers in "full" mode:

| Endpoint | Description |
|----------|-------------|
| `GET /rockermq/health` | Basic health check (200 = healthy, 503 = unhealthy) |
| `GET /rockermq/stats` | Connection stats and session statistics |
| `GET /rockermq/status` | Full status including config snapshot and session mappings |

## mq.publish Tool

Debug tool for publishing messages directly to RocketMQ:

```json
{
  "name": "mq.publish",
  "description": "Publish a message to RocketMQ",
  "parameters": {
    "topic": "string (required)",
    "tag": "string (optional)",
    "payload": "any (required)",
    "keys": "string[] (optional)"
  }
}
```

## Transport Layer Notes

- Uses `PushConsumer` — message acknowledgment via `ConsumeResult.SUCCESS` / `FAILURE`
- Retries are handled by RocketMQ broker/consumer group mechanism
- No manual retry queue management needed (unlike RabbitMQ)
- Request/reply RPC requires an explicit `replyTopic` + `replyTag` binding (RocketMQ does not natively support direct-reply-to like RabbitMQ)

## Development

```bash
# Install dependencies
pnpm install

# Build (tsup -> dist/)
pnpm build

# Type check
pnpm typecheck

# Run tests
pnpm test

# Watch mode
pnpm dev
```

## License

Licensed under the [MIT License](LICENSE).

## About openclaw-plugins

This plugin is part of [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) — an enterprise OpenClaw plugin collection developed and maintained by the **PartMe.AI team**, featuring 30+ plugins across IM channels, message queues, AI capabilities, and infrastructure.

Each plugin is published independently on npm under the `@partme.ai` scope:

```bash
openclaw plugins install @partme.ai/openclaw-rocketmq
```

**PartMe.AI** specializes in AI customer service and enterprise AI agent infrastructure, providing end-to-end solutions from WeChat Work/DingTalk/Feishu/QQ channel integration to RAG knowledge bases, multi-layer memory, and production monitoring.

> Contact: partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)
