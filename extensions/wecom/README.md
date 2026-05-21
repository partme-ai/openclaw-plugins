# WeCom (WeChat Work)

**OpenClaw channel plugin -- Enterprise WeChat Work Bot + Agent dual-mode integration**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fwecom-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-ISC-green)

[English](./README.en.md) | [简体中文](./README.md)

---

## Features

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

## Mode Overview

| Mode | Connection | Message Format | Use Case |
|------|-----------|----------------|----------|
| **Bot** (Smart Robot) | WebSocket (default) or HTTP Webhook | JSON | Quick integration, streaming replies |
| **Agent** (Self-built App) | HTTP Webhook | XML (encrypted) | Enterprise apps, API-driven messaging |

> Bot's `connectionMode` supports:
> - `websocket` (default) -- long-lived WS, requires `botId` + `secret`
> - `webhook` -- HTTP callback, requires `token` + `encodingAESKey`

## Bot Mode Configuration

### Core Settings

| Config | Description | Values | Default |
|--------|-------------|--------|---------|
| `channels.wecom.enabled` | Enable channel | `true` / `false` | `false` |
| `channels.wecom.connectionMode` | Bot connection mode | `websocket` / `webhook` | `websocket` |
| `channels.wecom.name` | Display name | - | `WeCom` |

#### WebSocket Mode (default)

| Config | Description | Default |
|--------|-------------|---------|
| `channels.wecom.botId` | WeCom Bot ID | - |
| `channels.wecom.secret` | WeCom Bot Secret | - |
| `channels.wecom.websocketUrl` | WebSocket endpoint | `wss://openws.work.weixin.qq.com` |
| `channels.wecom.sendThinkingMessage` | Send "thinking" placeholder | `true` |

#### Webhook Mode (`connectionMode: "webhook"`)

| Config | Description |
|--------|-------------|
| `channels.wecom.token` | Webhook verification token |
| `channels.wecom.encodingAESKey` | AES encryption key (43-char Base64) |
| `channels.wecom.receiveId` | Receive ID (decryption verification) |
| `channels.wecom.welcomeText` | Welcome message on enter-chat event |
| `channels.wecom.streamPlaceholderContent` | Streaming placeholder content |

#### Access Control

| Config | Description | Values | Default |
|--------|-------------|--------|---------|
| `channels.wecom.dmPolicy` | DM access policy | `pairing` / `open` / `allowlist` / `disabled` | `open` |
| `channels.wecom.allowFrom` | DM allowlist (user IDs) | - | `[]` |
| `channels.wecom.groupPolicy` | Group chat policy | `open` / `allowlist` / `disabled` | `open` |
| `channels.wecom.groupAllowFrom` | Group allowlist (group IDs) | - | `[]` |
| `channels.wecom.groups` | Per-group config (sender allowlist) | - | `{}` |

#### Media Settings

| Config | Description | Default |
|--------|-------------|---------|
| `channels.wecom.mediaLocalRoots` | Additional local paths for file sending | `[]` |
| `channels.wecom.media.maxBytes` | Max media file size (bytes) | `20971520` (20MB) |
| `channels.wecom.media.tempDir` | Media processing temp directory | - |
| `channels.wecom.media.retentionHours` | Media retention hours | - |
| `channels.wecom.media.cleanupOnStart` | Clean temp media on startup | - |

**Media size limits and auto-downgrade:**

| Media Type | Max Limit | Downgrade |
|------------|-----------|-----------|
| Image | 10 MB | Exceed -> sent as file |
| Video | 10 MB | Exceed -> sent as file |
| Voice | 2 MB (AMR only) | Non-AMR or exceed -> sent as file |
| File | 20 MB | Exceed -> rejected |

#### Network Settings

| Config | Description |
|--------|-------------|
| `channels.wecom.network.timeoutMs` | HTTP request timeout (ms) |
| `channels.wecom.network.retries` | Retry count |
| `channels.wecom.network.retryDelayMs` | Retry delay (ms) |
| `channels.wecom.network.egressProxyUrl` | Egress proxy URL (fixed IP scenarios) |

> **Egress proxy priority**: `channels.wecom.network.egressProxyUrl` > `OPENCLAW_WECOM_EGRESS_PROXY_URL` > `WECOM_EGRESS_PROXY_URL` > `HTTPS_PROXY` > `ALL_PROXY` > `HTTP_PROXY`

## Agent Mode Configuration

Agent mode uses HTTP webhook callbacks with encrypted XML payloads. Configure the callback URL in the WeCom admin console under "API Receive Messages".

### Prerequisites

1. Create a self-built app in the [WeCom Admin Console](https://work.weixin.qq.com/wework_admin/frame#apps)
2. Note your **CorpID**, **CorpSecret**, and **AgentId**
3. Under app settings -> "API Receive Messages", record the **Token** and **EncodingAESKey**

### Setup Steps

> **Important**: Configure the Gateway first, then save the callback URL in the WeCom admin console.

**Step 1: Configure Gateway**

```bash
openclaw config set channels.wecom.agent.corpId <YOUR_CORP_ID>
openclaw config set channels.wecom.agent.corpSecret <YOUR_CORP_SECRET>
openclaw config set channels.wecom.agent.agentId <YOUR_AGENT_ID>
openclaw config set channels.wecom.agent.token <YOUR_CALLBACK_TOKEN>
openclaw config set channels.wecom.agent.encodingAESKey <YOUR_ENCODING_AES_KEY>
openclaw config set channels.wecom.enabled true
openclaw gateway restart
```

**Step 2: Save callback URL in WeCom admin**

URL: `https://<your-gateway-host>/plugins/wecom/agent/<accountId>`

### Dual-mode combination

Bot and Agent can run simultaneously on the same account:

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "botId": "your-bot-id",
      "secret": "your-bot-secret",
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "your-corp-secret",
        "agentId": 1000002,
        "token": "your-callback-token",
        "encodingAESKey": "your-encoding-aes-key-43-chars"
      }
    }
  }
}
```

### Multi-account configuration

Configure multiple WeCom accounts via `accounts`, each with independent Bot and/or Agent settings:

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "main",
      "accounts": {
        "main": { "botId": "...", "agent": { ... } },
        "support": { "dmPolicy": "allowlist", "agent": { ... } }
      }
    }
  }
}
```

### Dynamic Agent routing

Auto-create isolated Agent instances per user/group:

```json
{
  "channels": {
    "wecom": {
      "dynamicAgents": {
        "enabled": true,
        "dmCreateAgent": true,
        "groupEnabled": true,
        "adminUsers": ["admin_user_id"]
      }
    }
  }
}
```

Generated Agent ID format: `wecom-{type}-{peerId}` (e.g., `wecom-dm-zhangsan`, `wecom-group-wr123456`).

## Access Control

### DM Policies

- **open** (default) -- All users can send DMs freely
- **pairing** -- Requires admin approval: `openclaw pairing list wecom` / `openclaw pairing approve wecom <CODE>`
- **allowlist** -- Only users in `channels.wecom.allowFrom`
- **disabled** -- All DMs blocked

### Group Chat Policies

- `"open"` -- All group messages allowed (default)
- `"allowlist"` -- Only groups in `groupAllowFrom`
- `"disabled"` -- All group messages blocked

Per-group sender allowlist: `groups.<chatId>.allowFrom` limits which members can interact.

## Cron Jobs

Cron jobs use the **Agent outbound channel**, so Agent mode must be configured.

### Target format

`delivery.to` supports: `party:<id>`, `tag:<id>`, `user:<id>`, `group:<id>`, `chat:<id>`, and auto-detection.

### CLI (instant effect)

```bash
openclaw cron add \
  --name "daily-report" \
  --agent main \
  --cron "0 9 * * 1-5" \
  --tz "Asia/Shanghai" \
  --message "Generate today's briefing" \
  --announce \
  --channel wecom \
  --to "party:1"
```

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
openclaw plugins install @partme.ai/nacos
openclaw plugins install @partme.ai/wecom
```

**PartMe.AI** specializes in AI customer service and enterprise AI agent infrastructure, providing end-to-end solutions from WeChat Work/DingTalk/Feishu/QQ channel integration to RAG knowledge bases, multi-layer memory, and production monitoring.

> Contact: partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)

## License

ISC
