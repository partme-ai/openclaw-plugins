# OpenClaw Plugins — Architecture

## Overview

openclaw-plugins is partme.ai's collection of OpenClaw enterprise plugins — 30+ plugins developed and adapted from third-party open-source projects, covering IM channels, message queues, AI capabilities, and infrastructure.

Each plugin is published as a standalone npm package under `@partme.ai`:

```bash
openclaw plugins install @partme.ai/wecom
openclaw plugins install @partme.ai/mqtt
npm install @partme.ai/nacos
```

---

## Design Principles

### Independent & Self-Contained

Zero cross-plugin dependencies. Users install only what they need — nothing extra.

### One Standard

Every plugin follows the same [spec](../spec/PLUGIN_SPEC.md):
- Same directory layout
- Same config format (Zod + JSON Schema)
- Same error handling (typed Error classes)
- Same lifecycle (setStatus reporting)
- Same test conventions (co-located, Vitest, 80%+)

### Production-Ready

Built for production from day one:
- Multi-account support (matrix isolation)
- DM/Group four-tier policies (open/pairing/allowlist/disabled)
- Streaming + timeout degradation
- Media size validation + auto-downgrade
- Structured logging + status reporting

---

## Plugin Categories

### 📱 IM Channels

| Plugin | Platform | SDK | Modes |
|--------|----------|-----|-------|
| wecom | WeChat Work | `@wecom/aibot-node-sdk` | WebSocket / Webhook / Agent |
| dingtalk | DingTalk | `dingtalk-stream` | Stream |
| lark | Feishu/Lark | `@larksuiteoapi/node-sdk` | WebSocket / Webhook |
| qqbot | QQ Bot | Custom HTTP | WebSocket |
| wechat | WeChat Official | Custom HTTP | Passive / Active reply |
| wecom-kf | WeChat Customer Service | Custom HTTP | Webhook callback |
| wechat-ipad | WeChat iPad | Custom | iPad protocol |

### 🔌 Message Queues & IoT

| Plugin | Protocol | Feature |
|--------|----------|---------|
| mqtt | MQTT 3.1.1/5.0 | Embedded Aedes Broker |
| web-mqtt | MQTT over WebSocket | Browser-side |
| stomp | STOMP | Message broker |
| web-stomp | STOMP over WebSocket | Browser-side |
| rabbitmq | AMQP 0-9-1 | RabbitMQ |
| redis-stream | Redis Stream | Pub/Sub + Consumer Groups |
| rocketmq | RocketMQ | Alibaba Cloud MQ |
| cluster | Cluster sync | Multi-node coordination |
| ics | ICS | Intelligent Customer Service API |

### 🏗️ Infrastructure

| Plugin | Function | Use Case |
|--------|----------|----------|
| nacos | Config center + Service registry | Microservices |
| prometheus | Metrics collection + export | Monitoring |
| tracing | OpenTelemetry distributed tracing | Call chain analysis |
| mtls | Mutual TLS authentication | Zero-trust networks |
| oauth2 | OAuth 2.0 / Sa-Token | Unified auth |

### 🧠 AI Capabilities

| Plugin | Function |
|--------|----------|
| knowledge | RAG engine (embedding + vector + hybrid retrieval) |
| memory | Multi-layer memory system (planned) |

---

## Directory Structure

```
openclaw-plugins/
├── extensions/          # All plugins (30)
│   ├── _template/       # New plugin scaffold
│   └── wecom/ dingtalk/ ...
├── doc/                 # Documentation
│   ├── README.md        # Doc index
│   ├── OpenClaw-Plugins-Architecture.md     (this file)
│   ├── OpenClaw-Plugins-Getting-Started.md
│   ├── OpenClaw-Plugins-Contributing.md
│   ├── zh/              # Chinese translations
│   └── guides/          # Per-plugin guides
├── spec/                # Plugin specification
├── scripts/             # CI/CD tooling
└── test-utils/          # Shared test helpers
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js >= 22, ES Modules |
| Language | TypeScript 5.7+, strict |
| Build | tsup (ESM output) |
| Test | Vitest, co-located |
| Config validation | Zod + JSON Schema |
| Package manager | pnpm workspace |
| CI/CD | GitHub Actions (matrix build) |

## Design Decisions

### Why no shared library?

The community approach (openclaw-china) uses `packages/shared` for cross-plugin code sharing. We chose **not to**:

- Shared libraries create version coupling — changing shared forces coordinated releases
- Independent plugins are user-friendly — installing A doesn't pull in B, C, D
- Specification over shared code — `spec/` ensures consistency without code coupling

### Date-based versioning?

Channel plugins track platform API changes, not feature releases. `2026.5.12` answers "when was this released and is it still compatible?" better than `2.3.1`.

Infrastructure plugins use semver (`0.1.0` → `0.2.0`).
