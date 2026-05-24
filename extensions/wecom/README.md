# WeCom

**OpenClaw channel plugin -- Enterprise WeChat Work Bot + Agent dual-mode integration**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fwecom-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-ISC-green)

[English](./README.md) | [简体中文](./README.zh-CN.md)

---

## Features

- **Bot + Agent dual-mode**: WebSocket real-time streaming + HTTP API for file/broadcast fallback
- **Multi-account matrix**: Independent bot/agent configs per account with full isolation
- **Webhook + WebSocket**: Bot supports both WebSocket long-connection and HTTP webhook modes
- **11 built-in Skills**: Contacts, docs, calendar, tasks, meetings, smartsheet, messaging, template cards, preflight
- **Full media support**: Image/video/voice/file receive and send with auto-downgrade
- **Streaming replies**: Bot `replyStream` plain-text streaming with "thinking" placeholder (see Streaming doc)
- **Access control**: Per-account DM/group policies (open, pairing, allowlist, disabled)
- **Dynamic Agent routing**: Auto-create isolated agents per user/group
- **MCP tool**: `wecom_mcp` for direct WeCom API access with interceptor pipeline
- **CLI setup wizard**: Interactive configuration with multi-mode credential prompts
- **Template card messages**: text_notice, news_notice, button_interaction, vote_interaction, multiple_interaction with event callback handling
- **Auto-fallback**: Bot WS unavailable -> transparent fallback to Agent HTTP API
- **Heartbeat keepalive**: Auto-reconnect with exponential backoff (max 10 retries, 5 auth retries)
- **Kick protection**: No auto-restart on server-initiated disconnect to avoid re-kick loops

## Quick Start

### Requirements

- Node.js >= 22.0.0
- OpenClaw >= 2026.4.12

### Install

```bash
openclaw plugins install @partme.ai/wecom
```

Requires `@partme.ai/openclaw-message-sdk >= 2026.5.22`.

### Configuration

#### Option A: Interactive wizard

```bash
openclaw channels add
```

Follow the prompts to enter your WeCom Bot ID and Secret.

#### Option B: CLI quick config

```bash
openclaw config set channels.wecom.botId <YOUR_BOT_ID>
openclaw config set channels.wecom.secret <YOUR_BOT_SECRET>
openclaw config set channels.wecom.enabled true
openclaw gateway restart
```

#### Option C: Scenario-based guide (recommended)

Copy-paste configs from minimal Bot WS through dual-mode, multi-account, RAG, and advanced options:

**[WeCom Configuration Guide (Levels 1–11)](../../doc/wecom/OpenClaw-WeCom-Configuration.md)**

Minimum setup (Scenario 1):

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.botId "<YOUR_BOT_ID>"
openclaw config set channels.wecom.secret "<YOUR_BOT_SECRET>"
openclaw gateway restart
openclaw channels status --probe
```

## Mode Overview

| Mode | Connection | Message Format | Use Case |
|------|-----------|----------------|----------|
| **Bot** (Smart Robot) | WebSocket (default) or HTTP Webhook | JSON | Quick integration, streaming replies |
| **Agent** (Self-built App) | HTTP Webhook | XML (encrypted) | Enterprise apps, API-driven messaging |

> Bot's `connectionMode` supports:
> - `websocket` (default) -- long-lived WS, requires `botId` + `secret`
> - `webhook` -- HTTP callback, requires `token` + `encodingAESKey`

## Configuration reference

Full JSON examples and field-by-field reference for Bot, Agent, dual-mode, multi-account, streaming, access control, media, RAG, and advanced options:

**[WeCom Configuration Guide](../../doc/wecom/OpenClaw-WeCom-Configuration.md)**

Quick CLI:

```bash
# Bot WebSocket (Scenario 1)
openclaw config set channels.wecom.botId "<YOUR_BOT_ID>"
openclaw config set channels.wecom.secret "<YOUR_BOT_SECRET>"

# Agent callback (Scenario 6) — configure Gateway before saving URL in WeCom admin
openclaw config set channels.wecom.agent.corpId "<CORP_ID>"
openclaw config set channels.wecom.agent.corpSecret "<SECRET>"
openclaw config set channels.wecom.agent.agentId 1000002
openclaw config set channels.wecom.agent.token "<TOKEN>"
openclaw config set channels.wecom.agent.encodingAESKey "<AES_KEY>"

# Egress proxy (error 60020)
openclaw config set channels.wecom.network.egressProxyUrl "http://proxy.company.local:3128"
```

## Documentation

In-repo guides under [`doc/wecom/`](../../doc/wecom/):

| Document | Description |
|----------|-------------|
| [**Configuration guide (authoritative)**](../../doc/wecom/OpenClaw-WeCom-Configuration.md) | Levels 1–11 JSON, bilingual field reference, verify steps, FAQ |
| [Architecture](../../doc/wecom/OpenClaw-WeCom-Architecture.md) | Dual-mode topology, source module map, inbound flows, streaming overview |
| [Streaming architecture](../../doc/wecom/OpenClaw-WeCom-Streaming-Architecture.md) | `replyStream` lifecycle, 6-minute window, 846608 fallback, state machine |
| [Testing & debugging](../../doc/wecom/OpenClaw-WeCom-Testing.md) | `message send`, `agent --deliver`, `user:` prefix (93006), pairing |
| [Feishu SDK inventory](../../doc/wecom/OpenClaw-WeCom-Feishu-SDK-Inventory.md) | OpenClaw plugin-sdk mapping vs Feishu channel |

## Access control & Cron

DM/group policies, pairing commands, and Cron target formats: see [Scenario 4](../../doc/wecom/OpenClaw-WeCom-Configuration.md#场景-4--访问控制--access-control) and [Scenario 11](../../doc/wecom/OpenClaw-WeCom-Configuration.md#场景-11--cron-定时推送--cron-scheduled-delivery) in the configuration guide.

## Testing

Manual Gateway debugging (`message send`, multi-bot, `user:` vs raw userid / 93006): see [OpenClaw-WeCom-Testing.md](../../doc/wecom/OpenClaw-WeCom-Testing.md).

## Technical Details

### Security

- **Signature verification**: SHA1(token, timestamp, nonce, encrypt)
- **Encryption**: AES-256-CBC with PKCS#7 padding
- **Webhook paths**: `/wecom`, `/wecom/bot`, `/wecom/agent`, `/plugins/wecom/bot/*`, `/plugins/wecom/agent/*`

### Timeout handling

Bot webhook mode has a 6-minute (360s) window for streaming responses. Auto-fallback to Agent mode 30s before deadline.

### Media processing

- **Inbound**: AES-256-CBC decrypt WeCom encrypted media URLs
- **Outbound images**: Base64 via `msg_item` in stream
- **Outbound files**: Requires Agent mode (`media/upload` + `message/send`)

### Proxy for dynamic IPs

For error `60020 not allow to access from your ip`:

```bash
openclaw config set channels.wecom.network.egressProxyUrl "http://proxy.company.local:3128"
```

## Build & Test

```bash
pnpm build          # tsc -> dist/
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run (279 tests)
pnpm run pack-dry   # Preview package contents before publish
```

## Update

```bash
openclaw plugins update @partme.ai/wecom
```

## About openclaw-plugins

This plugin is part of [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) -- an enterprise OpenClaw plugin collection developed and maintained by the **PartMe.AI team**, featuring 27+ plugins across IM channels, message queues, AI capabilities, and infrastructure.

Each plugin is published independently on npm under the `@partme.ai` scope:

```bash
openclaw plugins install @partme.ai/openclaw-nacos
openclaw plugins install @partme.ai/wecom
```

**PartMe.AI** specializes in AI customer service and enterprise AI agent infrastructure, providing end-to-end solutions from WeChat Work/DingTalk/Feishu/QQ channel integration to RAG knowledge bases, multi-layer memory, and production monitoring.

> Contact: partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)

## License

ISC
