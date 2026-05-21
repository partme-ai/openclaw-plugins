# WeCom (WeChat Work)

**OpenClaw channel plugin — Enterprise WeChat Work Bot + Agent dual-mode integration**

[简体中文](./README.md) | English

## Introduction

WeCom (`@partme.ai/wecom`) is the flagship channel plugin for [OpenClaw](https://github.com/partme-ai/openclaw), providing enterprise WeChat Work integration with Bot + Agent dual-mode architecture.

### Highlights

- **Bot + Agent dual-mode**: WebSocket real-time streaming + HTTP API for file/broadcast fallback
- **Multi-account matrix**: Independent bot/agent configs per account with full isolation
- **Webhook + WebSocket**: Bot supports both WebSocket long-connection and HTTP webhook modes
- **10 built-in Skills**: Contacts, docs, calendar, tasks, meetings, smartsheet, messaging, template cards
- **Full media support**: Image/video/voice/file receive and send with auto-downgrade
- **Streaming replies**: Real-time markdown streaming with "thinking" placeholder
- **Access control**: Per-account DM/group policies (open, pairing, allowlist, disabled)
- **Dynamic Agent routing**: Auto-create isolated agents per user/group
- **MCP tool**: `wecom_mcp` for direct WeCom API access with interceptor pipeline
- **CLI setup wizard**: Interactive configuration with multi-mode credential prompts

## Quick Start

```bash
openclaw plugins install @partme.ai/wecom
```

Then configure interactively:

```bash
openclaw channels add
```

Or configure directly:

```bash
openclaw config set channels.wecom.botId <YOUR_BOT_ID>
openclaw config set channels.wecom.secret <YOUR_BOT_SECRET>
openclaw config set channels.wecom.enabled true
openclaw gateway restart
```

For detailed configuration including Agent mode, webhook setup, multi-account, access control, and cron jobs, see the [Chinese documentation](./README.md).

## Requirements

- Node.js >= 22.0.0
- OpenClaw >= 2026.4.12

## Build & Test

```bash
pnpm build          # tsc → dist/
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run (279 tests)
pnpm run pack-dry   # Preview package contents before publish
```

## About openclaw-plugins

This plugin is part of [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) — an enterprise OpenClaw plugin collection developed and maintained by the **PartMe.AI team**, featuring 27+ plugins across IM channels, message queues, AI capabilities, and infrastructure.

Each plugin is published independently on npm under the `@partme.ai` scope:

```bash
openclaw plugins install @partme.ai/nacos
openclaw plugins install @partme.ai/wecom
```

**PartMe.AI** specializes in AI customer service and enterprise AI agent infrastructure, providing end-to-end solutions from WeChat Work/DingTalk/Feishu/QQ channel integration to RAG knowledge bases, multi-layer memory, and production monitoring.

> Contact: partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)
