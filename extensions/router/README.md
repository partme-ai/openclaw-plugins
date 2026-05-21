# @partme.ai/openclaw-router

> Enterprise Message Routing Engine — cross-channel message forwarding, IM to MQ, MQ to IM, config-driven rules, and audit logging.

[![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--router-blue)](https://www.npmjs.com/package/@partme.ai/openclaw-router)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

[简体中文](./README.md) | [English](./README.en.md)

---

## Overview

`@partme.ai/openclaw-router` is the enterprise-grade message routing engine for OpenClaw. It listens to `agent_end` events and dispatches messages to multiple targets based on configurable rules. It supports IM-to-MQ forwarding (forward copies to message queues) and MQ-to-IM replying (reply back to channels).

**Pure configuration-driven** — no channel plugin code modification needed. All routing rules are defined in JSON config.

## Features

- **agent_end Event Listener** — Automatically captures completed conversations
- **Rule Engine** — Multi-condition matching: `channels`, `direction`, `topic`, `accountId`
- **Template Topics** — Dynamic topic strings with `{{channel}}`, `{{direction}}`, `{{account}}` variables
- **IM to MQ Forwarding** — Forward user messages and agent replies to message queue channels
- **MQ to IM Replying** — Route agent replies back to specific IM channels and accounts
- **Audit Logging** — Optional console audit trail for all routed messages
- **Pure Configuration** — No code changes needed in channel plugins
- **Lightweight** — Zero external dependencies, single event handler

## Quick Start

### Installation

```bash
openclaw plugins install @partme.ai/openclaw-router
```

### Minimal Configuration

```json
{
  "plugins": {
    "entries": {
      "router": {
        "enabled": true,
        "config": {
          "rules": [
            {
              "id": "wecom-to-mqtt",
              "match": { "channels": ["wecom"], "direction": "both" },
              "actions": [
                { "type": "forward", "target": "mqtt", "topic": "openclaw/audit/wecom" }
              ]
            }
          ]
        }
      }
    }
  }
}
```

## Configuration Reference

```jsonc
{
  "plugins": {
    "entries": {
      "router": {
        "enabled": true,
        "config": {
          "rules": [
            {
              "id": "wecom-inbound-to-rabbitmq",
              "match": {
                "channels": ["wecom"],            // Channel source filter
                "direction": "inbound",           // "inbound" | "outbound" | "both"
                "topic": "support",               // Topic filter (optional)
                "accountId": "account_001"        // Account filter (optional)
              },
              "actions": [
                {
                  "type": "forward",             // Forward to MQ channel
                  "target": "rabbitmq",
                  "topic": "openclaw/router/{{channel}}/{{direction}}"  // Template topic
                }
              ]
            },
            {
              "id": "agent-reply-to-wecom",
              "match": {
                "channels": ["mqtt"],
                "direction": "outbound"
              },
              "actions": [
                {
                  "type": "reply-via",           // Reply to IM channel
                  "target": "wecom",
                  "accountId": "default"
                }
              ]
            }
          ],
          "audit": {
            "enabled": true,
            "logToConsole": true                 // Log routing actions to console
          }
        }
      }
    }
  }
}
```

### Rule Match Fields

| Field | Type | Description |
|-------|------|-------------|
| `channels` | string[] | Filter by source channel IDs (e.g., `["wecom", "dingtalk"]`). Empty/absent means any channel. |
| `direction` | "inbound" \| "outbound" \| "both" | Message direction. `inbound` = user message, `outbound` = agent reply. |
| `topic` | string | Filter by event topic. Exact match only. |
| `accountId` | string | Filter by agent account ID. |

### Action Types

| Action | Type | Description |
|--------|------|-------------|
| Forward | `"forward"` | Forward a copy of the message to a target MQ channel. Topics support template variables `{{channel}}`, `{{direction}}`, `{{account}}`. |
| Reply-via | `"reply-via"` | Reply to a message through the specified IM channel. Requires `target` and optionally `accountId` and `to`. |

### Template Variables for Topics

| Variable | Description |
|----------|-------------|
| `{{channel}}` | Source channel ID (e.g., `wecom`) |
| `{{direction}}` | Message direction (`inbound` / `outbound`) |
| `{{account}}` | Agent account ID (or `default`) |

Default topics:
- Inbound: `openclaw/router/{channel}/inbound`
- Outbound: `openclaw/router/{channel}/outbound`

### Audit Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `audit.enabled` | boolean | `false` | Enable audit logging |
| `audit.logToConsole` | boolean | `false` | Log routing actions to console |

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │           OpenClaw Runtime          │
                    │                                      │
  User ──► IM Channel ──► Agent ──► agent_end event         │
                    │         │                            │
                    │         ▼                            │
                    │    ┌──────────┐                      │
                    │    │  Router  │                      │
                    │    │ (Rules)  │                      │
                    │    └────┬─────┘                      │
                    │         │                            │
                    │    ┌────┴─────┐                      │
                    │    │    |     │                      │
                    │    ▼    ▼     ▼                      │
                    │  MQ_A  MQ_B  Reply-Via              │
                    └─────────────────────────────────────┘
```

## Use Cases

- **Audit Trail**: Forward all WeCom conversations to a RabbitMQ/MQTT audit queue
- **Multi-Channel Broadcast**: Send agent replies to multiple messaging channels simultaneously
- **External Processing**: Route messages to external systems for NLP, sentiment analysis, or data enrichment
- **Cross-Channel Reply**: Receive an MQTT message, have the agent process it, then reply via WeCom

## Scoping Notes

- Knowledge base (RAG) and long-term memory auto-injection are handled by the OpenClaw core framework and the `openclaw-memory` plugin respectively. The router does not participate.
- The router requires target MQ channels (mqtt, rabbitmq, redis-stream, etc.) to be installed and configured separately.
- Template variables in topic strings are replaced at runtime with actual values from the event context.

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Watch mode
pnpm dev

# Type check
pnpm typecheck
```

## License

Licensed under the [MIT License](LICENSE).

## About openclaw-plugins

This plugin is part of [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) — an enterprise OpenClaw plugin collection developed and maintained by the **PartMe.AI team**, featuring 30+ plugins across IM channels, message queues, AI capabilities, and infrastructure.

Each plugin is published independently on npm under the `@partme.ai` scope:

```bash
openclaw plugins install @partme.ai/openclaw-router
```

**PartMe.AI** specializes in AI customer service and enterprise AI agent infrastructure, providing end-to-end solutions from WeChat Work/DingTalk/Feishu/QQ channel integration to RAG knowledge bases, multi-layer memory, and production monitoring.

> Contact: partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)
