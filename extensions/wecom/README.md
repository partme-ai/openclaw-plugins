<div align="center">

# OpenClaw WeCom

**OpenClaw channel plugin for WeCom Bot WebSocket, Bot Webhook, and Agent self-built app delivery**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fwecom-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-ISC-green)

[English](./README.md) | [Simplified Chinese](./README.zh-CN.md)

</div>

`@partme.ai/wecom` connects [OpenClaw](https://github.com/openclaw/openclaw) to WeCom / WeChat Work through Smart Robot Bot and self-built Agent app modes. Use Bot WebSocket for low-friction interactive chat and streaming replies; add Agent mode when you need proactive sends, Cron delivery, department or tag broadcasts, and full outbound file support.

## Introduction

The plugin is a production-oriented WeCom channel bridge for OpenClaw Gateway. It keeps runtime configuration flat under `channels.wecom`, supports account-level overrides under `channels.wecom.accounts.<accountId>`, and lets Bot and Agent coexist in the same account.

Key behavior to know before you configure it:

- **Bot WebSocket wins when `botId` + `secret` exist**. Even if `connectionMode` is set to `webhook`, the runtime starts Bot WS when those credentials are present. For pure Bot Webhook, omit `botId` and `secret`.
- **Agent can coexist with Bot**. In production, Bot usually handles interactive chat while Agent handles proactive send, Cron, file fallback, and API-driven delivery.
- **`agent.agentId` is required for proactive paths**. Agent inbound can be configured with callback credentials, but proactive send, Cron, and fallback delivery also need `agent.agentId`.
- **Markdown support depends on the outbound path**. Bot stream paths are plain-text stream carriers; Agent API and some active send paths can send Markdown, but WeCom may still normalize or strip formatting depending on message type and client behavior.

## Core Capabilities

- **Three runtime paths**: Bot WebSocket, Bot HTTP Webhook, and Agent encrypted XML Webhook.
- **Streaming Bot replies**: `replyStream` / Webhook `stream` with thinking placeholders, status text, footer, and 846608 fallback handling.
- **Multi-account routing**: `defaultAccount` plus `accounts.<id>` for separate teams, tenants, environments, or Bot/Agent credentials.
- **Access control**: DM policies (`open`, `pairing`, `allowlist`, `disabled`) and group policies (`open`, `allowlist`, `disabled`).
- **Media handling**: inbound image, voice, video, file, mixed content, quoted messages, and guarded local-file outbound through `mediaLocalRoots`.
- **Template cards**: `text_notice`, `news_notice`, `button_interaction`, `vote_interaction`, and `multiple_interaction` with callback handling.
- **Dynamic Agent routing**: optional per-user and per-group isolated Agent/session routing.
- **MCP and Skills**: `wecom_mcp` tool plus built-in WeCom Skills for contact, docs, schedule, meeting, message, media, template cards, smartsheet, todo, preflight, and unified operations.
- **Operational safeguards**: heartbeat, exponential reconnect, persisted dedup, keyed chat queue, timeout fallback, and kicked-connection protection.

## Quick Start

### Prerequisites

- OpenClaw `>= 2026.4.12`
- Node.js `22+`
- `@partme.ai/openclaw-message-sdk >= 2026.5.24`
- WeCom admin access for Smart Robot API mode or self-built Agent app setup

### Install

```bash
openclaw plugins install @partme.ai/wecom
```

If local plugin security scanning blocks installation during development, review the warning first, then use the unsafe install flag only in trusted environments:

```bash
openclaw plugins install @partme.ai/wecom@latest --dangerously-force-unsafe-install
```

### Choose a Setup Path

| Path | Use When | Command or Doc |
|------|----------|----------------|
| Interactive wizard | You want guided setup from the CLI | `openclaw channels add` |
| Minimal CLI | You already have Bot ID and Secret | See [Bot WebSocket CLI](#bot-websocket-cli) |
| Scenario guide | You need Bot, Agent, dual-mode, multi-account, media, RAG, proxy, or Cron examples | [Configuration guide](../../doc/wecom/OpenClaw-WeCom-Configuration.md) |
| Production acceptance | You need real WeCom tenant verification | [Integration checklist](../../doc/wecom/OpenClaw-WeCom-Integration-Checklist.md) |

### Bot WebSocket CLI

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.connectionMode websocket
openclaw config set channels.wecom.botId "<YOUR_BOT_ID>"
openclaw config set channels.wecom.secret "<YOUR_BOT_SECRET>"
openclaw gateway restart
openclaw channels status --probe
```

Send a DM to the WeCom Smart Robot. Gateway logs should show WebSocket connection and authentication success.

### Minimal JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>"
    }
  }
}
```

Runtime config is flat under `channels.wecom.*`. Do not use nested `bot.*`, `botIds`, or `aibotid` as the primary runtime shape.

## Mode Selection

| Mode | Connection | Credentials | Best For | Notes |
|------|------------|-------------|----------|-------|
| Bot WebSocket | Long-lived WS | `botId` + `secret` | Fastest interactive setup, DM/group chat, streaming replies | Default and preferred for chat; no public callback URL required. |
| Bot Webhook | HTTPS callback | `token` + `encodingAESKey` + optional `receiveId` | Environments that cannot keep WS connections | Requires public callback URL and stream refresh handling. |
| Agent app | HTTPS callback + WeCom API | `corpId` + `corpSecret` + `agentId` + `token` + `encodingAESKey` | Proactive send, Cron, departments, tags, full file fallback | Agent inbound is not Bot-style streaming; replies are sent through API. |
| Dual mode | Bot WS + Agent | Bot credentials plus `agent.*` | Production default | Bot handles conversation; Agent handles push, Cron, and fallback. |

Callback paths:

| Runtime Path | Recommended URL |
|--------------|-----------------|
| Bot Webhook | `https://<GATEWAY_HOST>/plugins/wecom/bot/<accountId>` |
| Agent Webhook | `https://<GATEWAY_HOST>/plugins/wecom/agent/<accountId>` |

Legacy paths such as `/wecom`, `/wecom/bot`, and `/wecom/agent` remain for compatibility, but new deployments should prefer `/plugins/wecom/...`.

## Production Dual-Mode Config

Use this shape when you want Bot streaming chat plus Agent proactive and fallback delivery:

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "streaming": {
        "enabled": true,
        "status": true,
        "content": true
      },
      "footer": {
        "status": true,
        "elapsed": true
      },
      "mediaLocalRoots": ["~/Downloads"],
      "media": {
        "maxBytes": 20971520
      },
      "agent": {
        "corpId": "<YOUR_CORP_ID>",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": "<YOUR_AGENT_ID>",
        "token": "<YOUR_CALLBACK_TOKEN>",
        "encodingAESKey": "<YOUR_43_CHAR_ENCODING_AES_KEY>"
      },
      "network": {
        "agentReplyTimeoutMs": 360000,
        "egressProxyUrl": "http://proxy.company.local:3128"
      }
    }
  }
}
```

Remove `network.egressProxyUrl` if you do not need a fixed egress proxy. Never commit real WeCom credentials.

## Common CLI Tasks

```bash
# Agent callback fields; configure Gateway before saving URL in WeCom admin.
openclaw config set channels.wecom.agent.corpId "<CORP_ID>"
openclaw config set channels.wecom.agent.corpSecret "<SECRET>"
openclaw config set channels.wecom.agent.agentId 1000002
openclaw config set channels.wecom.agent.token "<TOKEN>"
openclaw config set channels.wecom.agent.encodingAESKey "<AES_KEY>"

# Egress proxy for 60020 fixed-IP errors.
openclaw config set channels.wecom.network.egressProxyUrl "http://proxy.company.local:3128"

# Bot WS active send uses a raw userid, not user:<id>.
openclaw message send --channel wecom --account default --target <USERID> --message "Bot WS test"

# Agent/Cron target formats support explicit prefixes.
openclaw message send --channel wecom --account default --target user:<USER_ID> --message "Agent outbound test"
```

For Bot WebSocket active sends, `user:<id>` can produce `93006 invalid chatid`; use the raw WeCom userid. For Agent and Cron delivery, use `user:<id>`, `party:<id>`, `tag:<id>`, `group:<id>`, or `chat:<id>`.

## Streaming and Text Formatting

| Path | Streaming | Formatting Reality |
|------|:---------:|--------------------|
| Bot WebSocket | Yes | `replyStream` is a plain-text stream carrier. Markdown-like text may be shown as plain text or normalized by WeCom. |
| Bot Webhook | Yes | Uses encrypted `msgtype: stream` plus `stream_refresh`; content is stream text with a 6-minute Bot window. |
| Agent inbound reply | No | Sends one final API message; Markdown support depends on WeCom API message type and client rendering. |
| Active outbound / fallback | Not Bot stream | Bot WS `sendMessage` or Agent API is selected by availability; WeCom may strip or normalize formatting by path. |

Default behavior is `streaming: false` with status/footer updates and one complete final answer. Set `streaming: true` when you want typewriter-style content updates. See the [Streaming architecture](../../doc/wecom/OpenClaw-WeCom-Streaming-Architecture.md) for `footer.status`, `footer.elapsed`, `streaming.status`, and `streaming.content`.

## Media Capabilities

| Direction | Type | Limit or Behavior | Notes |
|-----------|------|-------------------|-------|
| Inbound | Image, voice, video, file | Download/decrypt when supported by the current path | Media is added to the inbound context for the Agent. |
| Inbound | Mixed and quoted messages | Parsed when present in Bot payloads | Exact fields depend on WeCom event shape. |
| Outbound | Image | 10 MB Bot limit before fallback | Oversized image can fall back to file where possible. |
| Outbound | Voice | 2 MB AMR | Non-AMR or oversized voice is treated as file. |
| Outbound | Video | 10 MB Bot limit before fallback | Oversized video can fall back to file where possible. |
| Outbound | File | `media.maxBytes`, commonly 20 MB | Full outbound file delivery requires Agent API or fallback support. |
| Local path | Any local file | Must be under `mediaLocalRoots` | Paths outside allowlist are rejected before upload. |

For safe local file sends:

```bash
openclaw config set channels.wecom.mediaLocalRoots '["/data/wecom-media"]'
openclaw config set channels.wecom.media.maxBytes 20971520
```

## Access Control, Multi-Account, and Cron

| Topic | Configuration |
|-------|---------------|
| DM policy | `channels.wecom.dmPolicy`: `open`, `pairing`, `allowlist`, `disabled` |
| Group policy | `channels.wecom.groupPolicy`: `open`, `allowlist`, `disabled` |
| User allowlist | `channels.wecom.allowFrom` |
| Group allowlist | `channels.wecom.groupAllowFrom` and `channels.wecom.groups.<chatId>.allowFrom` |
| Multi-account | `channels.wecom.defaultAccount` plus `channels.wecom.accounts.<accountId>` |
| Cron delivery | Requires Agent mode and `agent.agentId` |

Cron scheduled delivery is proactive outbound messaging, so it must use Agent mode:

```bash
openclaw cron add \
  --name "wecom-daily-brief" \
  --agent main \
  --cron "0 9 * * 1-5" \
  --tz "Asia/Shanghai" \
  --message "Daily brief" \
  --announce \
  --channel wecom \
  --to "party:<PARTY_ID>"
```

## MCP and Skills

The plugin registers `wecom_mcp` for direct WeCom API access through the OpenClaw tool pipeline. The MCP transport includes interceptors for business errors, media handling, smart page creation, and smart page export.

Built-in Skills include `wecom-contact`, `wecom-doc`, `wecom-meeting`, `wecom-msg`, `wecom-preflight`, `wecom-schedule`, `wecom-send-media`, `wecom-send-template-card`, `wecom-smartsheet`, `wecom-todo`, and `wecom-unified`.

## Troubleshooting

| Symptom | Likely Cause | Quick Fix |
|---------|--------------|-----------|
| `60020 not allow to access from your ip` | WeCom API call from an untrusted egress IP | Add the Gateway IP in WeCom admin or set `channels.wecom.network.egressProxyUrl`. |
| `93006 invalid chatid` | Bot WS active send used `user:<id>` instead of raw userid | Use `--target <USERID>` for Bot WS active sends. |
| `Kicked by server: a new connection was established elsewhere` | Multiple Gateway instances or duplicate account credentials | Keep one active WS connection per Bot account; the plugin avoids immediate restart loops. |
| Bot Webhook never streams final content | Callback verification, dedup, or stream refresh path is wrong | Use the [Integration checklist](../../doc/wecom/OpenClaw-WeCom-Integration-Checklist.md#2-webhook-bot-mode). |
| Local media path denied | File is outside `mediaLocalRoots` | Add a trusted directory to `mediaLocalRoots`; do not disable the guard. |
| Cron does not deliver | Agent mode missing or `agent.agentId` omitted | Configure full `agent.*` fields and verify target visibility in WeCom. |

Debug commands:

```bash
openclaw channels list
openclaw channels status --probe
openclaw plugins doctor
openclaw pairing list wecom
```

## Documentation

In-repo guides under [`doc/wecom/`](../../doc/wecom/):

| Document | Description |
|----------|-------------|
| [Configuration guide](../../doc/wecom/OpenClaw-WeCom-Configuration.md) | Authoritative scenario-based config for Bot WS, Bot Webhook, Agent, dual mode, multi-account, media, RAG, proxy, and Cron. |
| [Integration checklist](../../doc/wecom/OpenClaw-WeCom-Integration-Checklist.md) | Real WeCom tenant acceptance checklist for Bot WS, Bot Webhook, Agent, security, smoke tests, and grep keywords. |
| [Architecture](../../doc/wecom/OpenClaw-WeCom-Architecture.md) | Dual-mode topology, source module map, inbound flows, outbound priority, MCP, and Skills. |
| [Streaming architecture](../../doc/wecom/OpenClaw-WeCom-Streaming-Architecture.md) | Bot stream protocol, state model, 6-minute window, 846608 fallback, footer/status configuration. |
| [Testing and debugging](../../doc/wecom/OpenClaw-WeCom-Testing.md) | Manual Gateway debugging, `message send`, `agent --deliver`, `user:` prefix / 93006, media checks. |

Some ecosystem references linked from the configuration guide, such as knowledge plugin docs, are currently Chinese-only.

## Build and Test

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm run pack-dry
```

`pnpm test` currently runs around 330 Vitest cases; the exact count changes as source coverage changes.

## Update

```bash
openclaw plugins update @partme.ai/wecom
```

## About openclaw-plugins

This plugin is part of [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins), an enterprise OpenClaw plugin collection maintained by the **PartMe.AI team**. The collection covers IM channels, message queues, AI capabilities, and infrastructure integrations.

Each plugin is published independently on npm under the `@partme.ai` scope:

```bash
openclaw plugins install @partme.ai/openclaw-nacos
openclaw plugins install @partme.ai/wecom
```

PartMe.AI specializes in AI customer service and enterprise AI Agent infrastructure, from WeCom / DingTalk / Feishu / QQ channel integration to RAG knowledge bases, memory, and production monitoring.

Contact: partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)

## License

ISC
