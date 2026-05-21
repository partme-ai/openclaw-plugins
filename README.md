# openclaw-plugins

<p align="center">
  <strong>27+ Enterprise Plugins. One Unified Ecosystem.</strong><br>
  <sub>IM channels · Message queues · AI capabilities · Infrastructure — production-ready, independently published.</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/search?q=%40partme.ai"><img src="https://img.shields.io/badge/npm-@partme.ai-cb3837?logo=npm" alt="npm"></a>
  <a href="https://github.com/partme-ai/openclaw-plugins"><img src="https://img.shields.io/badge/github-partme--ai%2Fopenclaw--plugins-green.svg" alt="GitHub"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg" alt="Node"></a>
  <a href="https://pnpm.io"><img src="https://img.shields.io/badge/pnpm-9-orange.svg" alt="pnpm"></a>
</p>

<p align="center">
  <a href="#-packages">Packages</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#-documentation">Docs</a> ·
  <a href="#-ecosystem">Ecosystem</a> ·
  <a href="#-tech-stack">Tech Stack</a>
</p>

[简体中文](./README_CN.md) | English

---

## What is openclaw-plugins?

**openclaw-plugins** is the official plugin ecosystem for [OpenClaw](https://github.com/partme-ai/openclaw) — a monorepo of 27+ independently published npm packages under the `@partme.ai` scope. Each plugin extends OpenClaw with a specific capability: connect an IM channel, bridge a message queue, add RAG knowledge retrieval, enable distributed tracing, or integrate with third-party platforms.

**Built by PartMe.AI** for enterprise AI agent infrastructure — from WeChat Work customer service to multi-channel message routing, from knowledge-base RAG to production monitoring.

### Why openclaw-plugins?

| You need... | openclaw-plugins gives you |
|-------------|---------------------------|
| Enterprise WeChat / DingTalk / Feishu AI bot | **One `openclaw plugins install`** — no custom code |
| Route messages across 21 IM channels | **Unified Bridge** — one plugin, all channels |
| RAG knowledge base for your agents | **Knowledge plugin** — embedding + hybrid retrieval |
| Multi-layer persistent memory | **Memory plugin** — L0→L3 auto-recall |
| IoT device integration | **MQTT / STOMP / RabbitMQ / Redis / RocketMQ** plugins |
| Production observability | **Prometheus + OpenTelemetry tracing + Nacos** |
| AI-powered platform integrations | **Amap · Douyin · Meituan · Gotify** tool plugins |

**Every plugin is self-contained** — zero cross-plugin dependencies, independently versioned and published.

---

## Architecture

openclaw-plugins follows a **five-layer model** that maps to the OpenClaw gateway architecture:

```
Layer 5 — Business Apps       SCRM, dashboards, analytics
Layer 4 — Router + Bridge     Rule engine, forwarding, audit, cross-channel context
Layer 3 — AI Capabilities     Knowledge/RAG, Memory L0-L3, Tracing, OAuth2
Layer 2 — Infrastructure      Nacos, Prometheus, mTLS, Cluster
Layer 1 — Channels            IM: WeCom/WeChat/Douyin + Bridge (21 upstream)
                               MQ: MQTT/RabbitMQ/Redis/RocketMQ/STOMP/Web-*
```

**Design principles**:
- **Independent**: Each plugin is a standalone npm package — no cross-plugin imports
- **Consistent**: Same config structure, error types, logging, and lifecycle across all plugins
- **Tested**: Co-located Vitest tests, 80%+ coverage target
- **Pluggable**: Install only what you need — no monolithic dependency tree

---

## Packages

### IM Channels

| Package | Description | License |
|---------|------------|---------|
| [@partme.ai/wecom](./extensions/wecom) | WeChat Work Bot + Agent dual-mode, multi-account, 10 Skills | ISC |
| [@partme.ai/weixin](./extensions/wechat) | WeChat Official Account / Customer Service | SEE LICENSE |
| [@partme.ai/wecom-kf](./extensions/wecom-kf) | WeChat Work Customer Service (external users) | MIT |
| [@partme.ai/wechat-ipad](./extensions/wechat-ipad) | WeChat iPad protocol | MIT |
| [@partme.ai/openclaw-bridge](./extensions/bridge) | Unified IM Bridge — 21 channels, one plugin | MIT |

### AI Capabilities

| Package | Description |
|---------|------------|
| [@partme.ai/openclaw-knowledge](./extensions/knowledge) | RAG knowledge base (embedding + vector + hybrid retrieval) |
| [@partme.ai/openclaw-memory](./extensions/memory) | Multi-level long-term memory (L0→L3), auto-recall |
| [@partme.ai/openclaw-router](./extensions/router) | Enterprise cross-channel message routing engine |
| [@partme.ai/openclaw-message-sdk](./extensions/message-sdk) | Unified message format SDK for cross-channel interoperability |

### Message Queues & IoT

| Package | Description |
|---------|------------|
| [@partme.ai/openclaw-mqtt](./extensions/mqtt) | MQTT 3.1.1/5.0 protocol bridge |
| [@partme.ai/openclaw-web-mqtt](./extensions/web-mqtt) | Web MQTT (browser-side) |
| [@partme.ai/openclaw-stomp](./extensions/stomp) | STOMP protocol bridge |
| [@partme.ai/openclaw-web-stomp](./extensions/web-stomp) | Web STOMP (browser-side) |
| [@partme.ai/openclaw-rabbitmq](./extensions/rabbitmq) | RabbitMQ message queue |
| [@partme.ai/openclaw-redis-stream](./extensions/redis-stream) | Redis Stream message queue |
| [@partme.ai/openclaw-rocketmq](./extensions/rocketmq) | RocketMQ message queue |
| [@partme.ai/openclaw-cluster](./extensions/cluster) | Cluster communication |

### Infrastructure

| Package | Description |
|---------|------------|
| [@partme.ai/openclaw-nacos](./extensions/nacos) | Nacos config center & service registration |
| [@partme.ai/openclaw-prometheus](./extensions/prometheus) | Prometheus metrics monitoring |
| [@partme.ai/openclaw-tracing](./extensions/tracing) | OpenTelemetry distributed tracing |
| [@partme.ai/openclaw-mtls](./extensions/mtls) | Mutual TLS authentication |
| [@partme.ai/openclaw-oauth2](./extensions/oauth2) | OAuth 2.0 / Sa-Token integration |

### Platform Integrations

| Package | Description |
|---------|------------|
| [@partme.ai/openclaw-gotify](./extensions/gotify) | Gotify push notifications |
| [@partme.ai/openclaw-amap](./extensions/amap) | Amap (Gaode Map) |
| [@partme.ai/openclaw-douyin](./extensions/douyin) | Douyin (TikTok China) |
| [@partme.ai/openclaw-meituan](./extensions/meituan) | Meituan |
| [@partme.ai/openclaw-rednode](./extensions/rednode) | RedNode integration |

---

## Quick Start

### Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 9
- **OpenClaw** >= 2026.4.12

### Install a Plugin

```bash
# Install directly from npm
openclaw plugins install @partme.ai/wecom

# Or configure interactively
openclaw channels add
```

### Development

```bash
git clone https://github.com/partme-ai/openclaw-plugins.git
cd openclaw-plugins
pnpm install

# Build all plugins
pnpm build

# TypeScript check all plugins
pnpm typecheck

# Run tests for all plugins
pnpm test

# Work on a single plugin
cd extensions/wecom
pnpm dev            # watch mode
pnpm test:watch     # test watch mode
```

### Create a New Plugin

```bash
pnpm new-plugin <name> --label "Display Name" --desc "Description"
```

All plugins follow the [Plugin Specification](./spec/PLUGIN_SPEC.md).

---

## Documentation

| Document | Description |
|----------|------------|
| [Getting Started](./doc/OpenClaw-Plugins-Getting-Started.md) | Install and configure plugins |
| [Architecture](./doc/OpenClaw-Plugins-Architecture.md) (EN) / [架构设计](./doc/OpenClaw-Plugins-Architecture_CN.md) (CN) | Project architecture and design decisions |
| [Contributing](./doc/OpenClaw-Plugins-Contributing.md) | How to add a new plugin |
| [Plugin Spec](./spec/PLUGIN_SPEC.md) | Plugin contract: entry, config, channel, lifecycle |
| [WeCom Guide](./doc/im-channels/wecom/OpenClaw-WeCom-Configuration.md) | WeChat Work full configuration guide |
| [Message SDK](./extensions/message-sdk/README.md) | Unified message format SDK API reference |

### Role-Based Reading

| Role | Start Here |
|------|-----------|
| **New User** | [Getting Started](./doc/OpenClaw-Plugins-Getting-Started.md) → Pick a channel plugin |
| **Plugin Developer** | [Plugin Spec](./spec/PLUGIN_SPEC.md) → [Contributing](./doc/OpenClaw-Plugins-Contributing.md) → Study an existing plugin |
| **Architect** | [Architecture](./doc/OpenClaw-Plugins-Architecture.md) → [Message SDK](./extensions/message-sdk/README.md) |

---

## Ecosystem

### Official Upstream Channels

These IM channels are maintained by their platform teams and integrated into PartMe.AI via `@partme.ai/openclaw-bridge`:

| Channel | Official Plugin | Repository |
|---------|----------------|------------|
| DingTalk | `@dingtalk-real-ai/dingtalk-connector` | [DingTalk-Real-AI/dingtalk-openclaw-connector](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector) |
| Feishu/Lark | `@larksuite/openclaw-lark` | [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark) |
| QQ | `@tencent-connect/openclaw-qqbot` | [tencent-connect/openclaw-qqbot](https://github.com/tencent-connect/openclaw-qqbot) |

Plus 18 bundled channels (Discord, Slack, Telegram, WhatsApp, Signal, LINE, Matrix, iMessage, SMS, Microsoft Teams, Google Chat, WebChat, BlueBubbles, Zalo, Mattermost, Nextcloud Talk, Mastodon, Nostr) — all through `@partme.ai/openclaw-bridge`.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Runtime** | Node.js 22+ (ESM) |
| **Language** | TypeScript 5.x (strict mode) |
| **Package Manager** | pnpm 9 (workspaces) |
| **Build** | tsup (ES2022) / tsc |
| **Test** | Vitest 4.x |
| **Config Validation** | Zod 4.x |
| **HTTP Client** | undici |
| **Message Format** | [@partme.ai/openclaw-message-sdk](./extensions/message-sdk) |
| **CI/CD** | GitHub Actions (matrix build per plugin) |

---

## License

Plugins are released under their respective licenses (see package table above).  
Core infrastructure and self-built plugins: **MIT License**.  
Forked official plugins retain their original licenses.

**Made with ❤️ by PartMe.AI Team**
