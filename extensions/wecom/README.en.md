<div align="center">

# OpenClaw WeCom

**OpenClaw channel plugin for WeCom Bot WebSocket, Bot Webhook, and self-built Agent app delivery**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fwecom-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-ISC-green)

[简体中文](./README.md) | [English](./README.en.md)

</div>

`@partme.ai/wecom` connects OpenClaw to WeCom / WeChat Work. It supports Bot WebSocket, Bot HTTP Webhook, and self-built Agent app modes. Use Bot WebSocket for low-friction interactive chat and streaming replies; add Agent mode for proactive sends, Cron delivery, departments, tags, and full outbound file fallback.

Current version: `2026.5.25`. Message SDK version: `2026.5.24`. The test suite currently has about 330 Vitest cases.

## ✨ Features

`@partme.ai/wecom` absorbs the strong capability set from the WeCom research plugin while matching the current OpenClaw plugin facts: package `@partme.ai/wecom@2026.5.25`, message SDK `2026.5.24`, flat `channels.wecom` config, Bot WS priority when `botId` + `secret` exist, Agent coexistence for proactive delivery, roughly 330 Vitest tests, and knowledge handled by the independent knowledge plugin.

- 🔗 **Dual-mode**: Bot (WebSocket / Webhook) and Agent (HTTP webhook) can run independently or together.
- 💬 Supports both direct messages (DM) and group chat.
- 📤 Proactive messaging to specific users, groups, departments, or tags.
- 🖼️ Receives and processes image, voice, video, file, and **mixed (图文混排)** messages with automatic downloading where the inbound path supports media access.
- 🗣️ Voice-to-text: automatically extracts transcribed text from voice messages when Agent ASR is enabled.
- 💬 Quote message support: processes quoted text, image, voice, and file messages.
- ⏳ Streaming replies with "thinking" placeholder messages (Bot mode).
- 🔐 Agent mode: AES-256-CBC encrypted XML callbacks with SHA1 signature verification.
- 📝 Markdown/text formatting support for replies; Agent HTTP text sends strip Markdown to plain text, and rich rendering depends on the outbound path and WeCom client.
- 🃏 Template card messages (`text_notice`, `news_notice`, `button_interaction`, `vote_interaction`, `multiple_interaction`) with **event callback handling**.
- 🔒 Built-in access control: DM Policy (`pairing` / `open` / `allowlist` / `disabled`) and Group Policy (`open` / `allowlist` / `disabled`).
- 🔑 Command authorization: per-account command permission control with access group support.
- 👥 Multi-account support: run multiple WeCom accounts with independent bot/agent configs.
- 🧩 MCP tool integration (`wecom_mcp`) with interceptor pipeline (`biz-error`, `doc-auth-error`, `msg-media`, `smartpage-create`, `smartpage-export`, `smartsheet-upload`).
- 🎯 **11 built-in Skill packs**: media sending, template cards, contact lookup, doc management, todo, meeting, schedule, messaging, smartsheet, preflight, and unified WeCom operations.
- 🔀 Dynamic Agent routing: auto-create isolated agents per user/group.
- 📁 Local file sending with configurable media path allowlist (`mediaLocalRoots`).
- 📊 Smart media size limits with auto-downgrade (image 10MB → file, video 10MB → file, voice 2MB / AMR-only → file, max 20MB).
- 🔄 **Bot-first, Agent-fallback** outbound delivery: auto fallback to Agent HTTP API when Bot WS is unavailable.
- ⚡ Auto heartbeat keep-alive and reconnection (up to 10 reconnect attempts, 5 auth failure retries).
- 🛡️ Anti-kick protection: suppresses auto-restart on server-side disconnection to prevent mutual kicking loops.

Capability boundaries:

| Capability | Bot WebSocket | Bot Webhook | Agent app |
|------------|---------------|-------------|-----------|
| DM / group inbound | Supported | Supported | Supported through app callbacks |
| Streaming replies | Preferred path | Supported by Webhook stream path | Primarily final-message API sends |
| Proactive sends | Supported for connected sessions | Not recommended as the main path | Supports users, departments, tags, and group chats |
| Cron delivery | Can participate as a chat path | Not recommended as the main path | Recommended; requires `agent.agentId` |
| Media and file fallback | Supports common media limits | Supports common media limits | Recommended for uploads and fallback |
| WeCom trusted IP | Usually not needed | Callback must be public | API calls need trusted egress IP or proxy |

## Important Behavior

- Bot WebSocket wins when `botId` + `secret` exist. Even if `connectionMode` is `webhook`, the runtime starts WS when those credentials are present. For pure Bot Webhook, omit both fields.
- `agent.agentId` is required for proactive sends, Cron, and Agent fallback delivery.
- Bot WebSocket active sends use the raw WeCom `userid`; do not prefix it with `user:`.
- Markdown rendering depends on the outbound path and WeCom client behavior.

## Architecture and Delivery Priority

`@partme.ai/wecom` is an OpenClaw Gateway channel plugin. Inbound messages are normalized into the OpenClaw message model, routed to a bound Agent or dynamic Agent, then outbound messages are delivered through the best available account capability.

```text
WeCom Bot WS / Bot Webhook / Agent Webhook
        ↓
WeCom channel runtime
        ↓
OpenClaw message-sdk normalization
        ↓
Agent binding / Dynamic Agent routing / MCP tools
        ↓
Outbound delivery: Bot WS first, Agent HTTP fallback
```

Outbound delivery order:

1. If the same account has an online Bot WebSocket, the plugin sends through WS first. This is best for interactive replies and streaming.
2. If Bot WS is unavailable and `agent.*` is configured, the plugin falls back to the Agent HTTP API. This is best for proactive sends, Cron, department/tag broadcasts, and files.
3. If media upload fails, the plugin tries to downgrade to a file or text link while still respecting WeCom file size and type limits.

## Install and Update

```bash
openclaw plugins install @partme.ai/wecom
openclaw plugins update @partme.ai/wecom
```

For trusted local development only:

```bash
openclaw plugins install @partme.ai/wecom@latest --dangerously-force-unsafe-install
```

## Quick Start: Bot WebSocket

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.connectionMode websocket
openclaw config set channels.wecom.botId "<YOUR_BOT_ID>"
openclaw config set channels.wecom.secret "<YOUR_BOT_SECRET>"
openclaw gateway restart
openclaw channels status --probe
```

Minimal JSON:

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

Send a DM to the WeCom Smart Robot. Gateway logs should show WebSocket connection and authentication success.

## Production Dual-Mode Config

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "streaming": true,
      "footer": {
        "status": true,
        "elapsed": true
      },
      "sendThinkingMessage": true,
      "streamPlaceholderText": "1",
      "mediaLocalRoots": ["/data/wecom-media"],
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

## Mode Overview

The plugin supports Bot WebSocket, Bot Webhook, and self-built Agent app connection paths. You can use them independently or combine them for production: Bot handles low-latency chat and streaming, while Agent handles WeCom API delivery, Cron, department/tag broadcasts, and media fallback.

| Mode | Connection | Message Format | Credentials | Best For |
|------|------------|----------------|-------------|----------|
| Bot WebSocket | Long-lived WeCom WS | JSON | `botId` + `secret` | Fast setup, DM/group messages, streaming replies |
| Bot Webhook | HTTPS callback | JSON | `token` + `encodingAESKey` + optional `receiveId` | Deployments that cannot keep WS connections |
| Agent app | HTTPS callback + WeCom HTTP API | Encrypted XML | `corpId` + `corpSecret` + `agentId` + `token` + `encodingAESKey` | Proactive sends, Cron, departments, tags, file fallback |
| Dual mode | Bot WS + Agent | JSON + XML | Bot credentials plus `agent.*` | Production default |

> Note: Bot connection mode is selected by `channels.wecom.connectionMode`, but when the same account has `botId` + `secret`, runtime starts Bot WebSocket first. For pure Bot Webhook, omit both fields.

### Bot WebSocket

Bot WebSocket is the default and recommended interactive chat entry point. It does not require a public callback URL and is the fastest way to enable Smart Robot DM/group chat and streaming replies.

#### Setup Steps

1. Get the **Bot ID** and **Secret** from the WeCom Smart Robot console.
2. Write flat `channels.wecom` config and restart Gateway:

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.connectionMode websocket
openclaw config set channels.wecom.botId "<YOUR_BOT_ID>"
openclaw config set channels.wecom.secret "<YOUR_BOT_SECRET>"
openclaw gateway restart
openclaw channels status --probe
```

3. Send a message to the Smart Robot in WeCom. Gateway logs should show WebSocket connection and authentication success.

### Bot Webhook

Bot Webhook is for deployments that cannot keep a WebSocket connection. It uses WeCom JSON callbacks and supports `stream` / `stream_refresh`, but Bot WS is usually preferred for production chat.

#### Setup Steps

1. Make sure Gateway has a public HTTPS URL.
2. Prepare **Token**, **EncodingAESKey**, and optional **ReceiveId** in WeCom Admin.
3. Do not configure `botId` or `secret`; set only the Webhook fields:

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.connectionMode webhook
openclaw config set channels.wecom.token "<YOUR_CALLBACK_TOKEN>"
openclaw config set channels.wecom.encodingAESKey "<YOUR_43_CHAR_ENCODING_AES_KEY>"
openclaw config set channels.wecom.receiveId "<YOUR_RECEIVE_ID>"
openclaw gateway restart
```

4. Save this callback URL in WeCom Admin:

```text
https://<GATEWAY_HOST>/plugins/wecom/bot/<accountId>
```

Single-account setups can use the compatible `/plugins/wecom/bot` path. New deployments should include `<accountId>`.

### Agent App

Agent mode uses self-built app encrypted XML callbacks and the WeCom HTTP API. It is the main path for proactive sends, Cron, department/tag broadcasts, group delivery, and file fallback.

#### Setup Steps

1. Create a self-built app in [WeCom Admin Console](https://work.weixin.qq.com/wework_admin/frame#apps).
2. Record the **CorpID**, app **Secret**, and **AgentId**.
3. In the app's "API Receive" settings, prepare **Token** and **EncodingAESKey**, but do not save yet.
4. Configure `agent.*` in Gateway first, then restart:

```bash
openclaw config set channels.wecom.agent.corpId "<YOUR_CORP_ID>"
openclaw config set channels.wecom.agent.corpSecret "<YOUR_CORP_SECRET>"
openclaw config set channels.wecom.agent.agentId "<YOUR_AGENT_ID>"
openclaw config set channels.wecom.agent.token "<YOUR_CALLBACK_TOKEN>"
openclaw config set channels.wecom.agent.encodingAESKey "<YOUR_43_CHAR_ENCODING_AES_KEY>"
openclaw config set channels.wecom.enabled true
openclaw gateway restart
```

5. Go back to WeCom Admin and save this callback URL:

```text
https://<GATEWAY_HOST>/plugins/wecom/agent/<accountId>
```

WeCom sends an `echostr` verification request immediately when you save. Gateway must already have Token and EncodingAESKey configured so it can decrypt and respond correctly.

### Dual Mode

Bot and Agent can run together on the same account. Bot WS handles interactive chat and streaming first; Agent API handles proactive sends, Cron, department/tag broadcasts, and HTTP fallback when Bot WS is unavailable.

#### Setup Steps

1. Configure `botId` + `secret` using the Bot WebSocket steps.
2. Add `agent.corpId`, `agent.corpSecret`, `agent.agentId`, `agent.token`, and `agent.encodingAESKey` using the Agent steps.
3. Save `/plugins/wecom/agent/<accountId>` as the Agent callback URL.
4. For Cron or proactive delivery, target the correct Agent, for example with `--agent main` or explicit `bindings`.

Recommended callback URLs:

| Path | Recommended URL |
|------|-----------------|
| Bot Webhook | `https://<GATEWAY_HOST>/plugins/wecom/bot/<accountId>` |
| Agent Webhook | `https://<GATEWAY_HOST>/plugins/wecom/agent/<accountId>` |

Legacy paths `/wecom`, `/wecom/bot`, and `/wecom/agent` remain compatible. New deployments should use `/plugins/wecom/...`.

## Configuration Reference

### Bot Basics

| Config | Description | Default |
|--------|-------------|---------|
| `channels.wecom.enabled` | Enable the WeCom channel | `false` |
| `channels.wecom.connectionMode` | Bot connection mode: `websocket` or `webhook` | `websocket` |
| `channels.wecom.name` | Channel display name | `企业微信` |
| `channels.wecom.botId` | Smart Robot Bot ID; makes WS the priority path when present | None |
| `channels.wecom.secret` | Smart Robot secret; makes WS the priority path when present | None |
| `channels.wecom.websocketUrl` | Bot WebSocket endpoint | WeCom default |

### Bot Webhook Config

Use this only when your deployment cannot keep a WebSocket connection. For pure Bot Webhook mode, do not configure `botId` or `secret`.

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "webhook",
      "token": "<YOUR_CALLBACK_TOKEN>",
      "encodingAESKey": "<YOUR_43_CHAR_ENCODING_AES_KEY>",
      "receiveId": "<YOUR_RECEIVE_ID>"
    }
  }
}
```

| Config | Description |
|--------|-------------|
| `channels.wecom.token` | Bot Webhook callback verification token |
| `channels.wecom.encodingAESKey` | 43-character EncodingAESKey |
| `channels.wecom.receiveId` | Receiver ID used for callback decrypt verification |
| `channels.wecom.welcomeText` | Welcome text for enter-chat events |
| `channels.wecom.streamPlaceholderText` | Bot stream first-frame placeholder (protocol layer) |
| `channels.wecom.sendThinkingMessage` | Send stream placeholder before first Agent token, default `true` |
| `channels.wecom.streaming` | Streaming master switch: `false` / `true` / `{ status?, content?, enabled? }` |
| `channels.wecom.footer.status` | Include status line in stream bubble, default `true` |
| `channels.wecom.footer.elapsed` | Show elapsed footer on close, default `false` |

### Bot Basics (streaming-related)

| Config | Description | Default |
|--------|-------------|---------|
| `channels.wecom.sendThinkingMessage` | WS sends first-frame placeholder before reply starts | `true` |
| `channels.wecom.streamPlaceholderText` | Placeholder text; WS default `<think></think>`, Webhook often `"1"` | none |
| `channels.wecom.streaming` | Streaming mode, see [Streaming Output](#streaming-output) | `false` |
| `channels.wecom.footer` | Status and elapsed footer, see [Streaming Output](#streaming-output) | `{ status: true, elapsed: false }` |

### Agent App Config

Agent mode uses encrypted XML callbacks and WeCom HTTP APIs. It handles proactive sends, Cron, department/tag delivery, and file fallback.

Configuration order matters: write `agent.*` into Gateway and restart it before saving the callback URL in WeCom Admin. WeCom sends an `echostr` verification request immediately when you save the URL, and Gateway must already have the token and EncodingAESKey.

```bash
openclaw config set channels.wecom.agent.corpId "<YOUR_CORP_ID>"
openclaw config set channels.wecom.agent.corpSecret "<YOUR_CORP_SECRET>"
openclaw config set channels.wecom.agent.agentId "<YOUR_AGENT_ID>"
openclaw config set channels.wecom.agent.token "<YOUR_CALLBACK_TOKEN>"
openclaw config set channels.wecom.agent.encodingAESKey "<YOUR_43_CHAR_ENCODING_AES_KEY>"
openclaw config set channels.wecom.enabled true
openclaw gateway restart
```

Use this callback URL in WeCom Admin:

```text
https://<GATEWAY_HOST>/plugins/wecom/agent/<accountId>
```

Single-account setups can also use the compatible `/plugins/wecom/agent` path. Multi-account setups should always include `<accountId>`.

| Config | Description | Commonly Required |
|--------|-------------|-------------------|
| `channels.wecom.agent.corpId` | Enterprise CorpID | Yes |
| `channels.wecom.agent.corpSecret` | Self-built app secret | Yes |
| `channels.wecom.agent.agentId` | Self-built app AgentId | Required for proactive sends and Cron |
| `channels.wecom.agent.token` | Callback token | Yes |
| `channels.wecom.agent.encodingAESKey` | Callback EncodingAESKey | Yes |
| `channels.wecom.agent.welcomeText` | Agent callback welcome text | No |
| `channels.wecom.agent.dmPolicy` | Agent DM policy override | No |
| `channels.wecom.agent.allowFrom` | Agent DM allowlist override | No |

### Access Control

| Config | Description | Values | Default |
|--------|-------------|--------|---------|
| `channels.wecom.dmPolicy` | DM access policy | `open` / `pairing` / `allowlist` / `disabled` | `open` |
| `channels.wecom.allowFrom` | DM user allowlist | User ID array | `[]` |
| `channels.wecom.groupPolicy` | Group access policy | `open` / `allowlist` / `disabled` | `open` |
| `channels.wecom.groupAllowFrom` | Group allowlist | Group ID array | `[]` |
| `channels.wecom.groups` | Per-group config, such as sender allowlists | Object | `{}` |

Allow only specific groups and specific senders:

```json
{
  "channels": {
    "wecom": {
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["group_id_1"],
      "groups": {
        "group_id_1": {
          "allowFrom": ["user_id_1", "user_id_2"]
        }
      }
    }
  }
}
```

### Network and Proxy

| Config | Description |
|--------|-------------|
| `channels.wecom.network.timeoutMs` | WeCom HTTP request timeout |
| `channels.wecom.network.retries` | HTTP retry count |
| `channels.wecom.network.retryDelayMs` | Retry delay |
| `channels.wecom.network.agentReplyTimeoutMs` | Agent reply wait timeout |
| `channels.wecom.network.egressProxyUrl` | Fixed egress proxy, commonly used for trusted-IP requirements |

Egress proxy priority: `channels.wecom.network.egressProxyUrl` > `OPENCLAW_WECOM_EGRESS_PROXY_URL` > `WECOM_EGRESS_PROXY_URL` > `HTTPS_PROXY` > `ALL_PROXY` > `HTTP_PROXY`.

## Welcome Messages (enter_chat / subscribe)

When a user opens a Bot session or subscribes to an Agent app, the plugin can send a configurable welcome message. Welcome text is separate from stream first-frame placeholders (`streamPlaceholderText`) and status-line copy (`thinkingText`).

### When It Triggers

| Mode | Event | Code Path | Delivery |
|------|-------|-----------|----------|
| Bot WebSocket | `event.enter_chat` | `dispatch/ws-monitor.ts` listens for `event.enter_chat` | SDK `replyWelcome(frame, { msgtype: "text", ... })` |
| Bot Webhook | `msgtype=event` with `eventtype=enter_chat` | `webhook/monitor.ts` → `handleEnterChat` | Synchronous HTTP callback `{ msgtype: "text", text: { content } }` |
| Agent app | `msgType=event` with `enter_chat` or `subscribe` | `agent/handler.ts` → `agent/welcome.ts` | Agent API `sendText` proactive send |

If `welcomeText` is not configured: **Bot WS skips**; **Bot Webhook returns null**; **Agent does not call sendText**.

### Config Keys and Priority

| Config | Scope | Description |
|--------|-------|-------------|
| `channels.wecom.welcomeText` | Bot WS / Bot Webhook | enter_chat welcome text |
| `channels.wecom.agent.welcomeText` | Agent callback | **Takes priority** over channel-level `welcomeText` |
| `channels.wecom.accounts.<accountId>.welcomeText` | Multi-account | Account-level override |
| `channels.wecom.accounts.<accountId>.agent.welcomeText` | Multi-account Agent | Account-level Agent welcome |

Agent welcome resolution (`resolveAgentWelcomeText`): use `agent.welcomeText` when set; otherwise fall back to `channels.wecom.welcomeText`.

### Example and Verification

```bash
openclaw config set channels.wecom.welcomeText "Hello, I am your WeCom assistant."
openclaw config set channels.wecom.agent.welcomeText "Welcome to the self-built app."
openclaw gateway restart
```

Verification:

1. Open the Smart Robot chat in WeCom (triggers enter_chat).
2. Check Gateway logs:
   - Bot WS: `[<accountId>] ws-event: sent enter_chat welcome`
   - Bot Webhook: `[webhook] enter_chat (userId=..., account=...)`
   - Agent: user receives text, or `[wecom-agent] welcome message failed` on error
3. Run tests: `pnpm test src/agent/welcome.test.ts src/config/streaming-config.test.ts`

## User-Visible Text Templates

All `*Text` fields are flat under `channels.wecom` (or account overrides). They map through `config/text-config.ts` to internal templates; defaults live in `WECOM_DEFAULT_TEMPLATES` in `config/templates.ts`.

### Config Keys

| Config key | Internal key | Default (zh) | Typical use |
|------------|--------------|--------------|-------------|
| `welcomeText` | welcome | (empty) | enter_chat / subscribe welcome |
| `streamPlaceholderText` | — | see below | Bot stream **protocol first frame**, not welcome |
| `thinkingText` | thinking | 正在思考… | Status: Agent started reasoning |
| `receivedText` | received | 已收到，正在处理… | WS status: after policy pass, before Agent starts |
| `toolStatusText` | tool | 正在查资料… | Status: tool call in progress |
| `readingText` | reading | 正在阅读附件… | Status: reading attachment |
| `generatingText` | generating | 正在输入… | Status: answer block streaming |
| `compactionText` | compaction | 📦 正在压缩上下文… | Status: context compaction |
| `emptyReplyText` | emptyReply | ⚠️ 未能生成可展示的回复… | Fallback when closing stream with no body |
| `finishFooterText` | finishFooter | ⏱ {elapsed}s · 已完成 | Elapsed-time footer on close |
| `cardSentText` | cardSent | 📋 卡片消息已发送。 | Template card delivered |
| `mediaSentText` | mediaSent | 📎 文件已发送，请查收。 | Media sent successfully |
| `mediaParseFailedText` | mediaParseFailed | ⚠️ 未能解析该媒体…{emptyReply} | Inbound media parse failed |
| `mediaDeliveredText` | mediaDelivered | ✅ 文件已发送。 | Webhook close when media sent separately |
| `processedCompleteText` | processedComplete | ✅ 已处理完成。 | Webhook empty-content close fallback |
| `timeoutText` | timeout | ⚠️ 处理超时（约 {minutes} 分钟）… | Agent reply timeout (default 6 min) |
| `dispatchErrorText` | dispatchError | ⚠️ 回复生成失败（{kind}）：{detail} | OpenClaw dispatch error |
| `mediaErrorNoAccessText` | mediaErrorNoAccess | ⚠️ 文件发送失败：没有权限访问路径 {mediaUrl}… | Path outside `mediaLocalRoots` |
| `mediaErrorReasonText` | mediaErrorReason | ⚠️ 文件发送失败：{reason} | Media send rejected |
| `mediaErrorGenericText` | mediaErrorGeneric | ⚠️ 文件发送失败：无法处理文件 {mediaUrl}… | Other media errors |
| `queuedText` | queued | 已收到，已排队处理中... | Same-session queue (WS status / Webhook placeholder) |
| `mergedQueuedText` | mergedQueued | 已收到，已合并排队处理中... | Merged queue |
| `mergedDoneText` | mergedDone | ✅ 已合并处理完成… | Merge complete |
| `sessionResetText` | sessionReset | ✅ 已重置会话。 | Session reset command |
| `sessionNewText` | sessionNew | ✅ 已开启新会话。 | New session command |

### Placeholders

Runtime substitution uses `formatWecomTemplate` / message-sdk. Keys not listed below are **static copy** (no `{…}` placeholders).

| Placeholder | Config keys | Meaning |
|-------------|-------------|---------|
| `{toolName}` | `toolStatusText` | Current tool name; replaced when the template includes this token and a name is provided, otherwise the full static string is used |
| `{elapsed}` | `finishFooterText` | Elapsed seconds on stream close (minimum 1s; see `formatWecomElapsedFooter`) |
| `{minutes}` | `timeoutText` | Agent reply timeout threshold in minutes (`timeoutMs / 60000`, rounded) |
| `{kind}` | `dispatchErrorText` | OpenClaw dispatch error category |
| `{detail}` | `dispatchErrorText` | Truncated error detail (default max 200 characters) |
| `{emptyReply}` | `mediaParseFailedText` | Resolved `emptyReplyText` injected at runtime |
| `{mediaUrl}` | `mediaErrorNoAccessText`, `mediaErrorGenericText` | Local media path or URL |
| `{reason}` | `mediaErrorReasonText` | Media send rejection reason (`rejectReason` or `error`) |

### Full example (all 25 `*Text` keys)

JSON does not allow comments. Keys are ordered by role: **welcome & stream protocol** → **status line** → **close / fallback** → **cards & media** → **errors** → **queue & session commands**. Omit keys you do not need; unset keys fall back to `WECOM_DEFAULT_TEMPLATES`.

```json
{
  "channels": {
    "wecom": {
      "welcomeText": "Hello! I'm your assistant—send a message to get started.",
      "streamPlaceholderText": "1",
      "thinkingText": "Thinking…",
      "receivedText": "Got it, processing…",
      "toolStatusText": "Running {toolName}…",
      "readingText": "Reading attachment…",
      "generatingText": "Writing reply…",
      "compactionText": "📦 Compacting context…",
      "emptyReplyText": "⚠️ No reply could be generated. Please retry or send a text message.",
      "finishFooterText": "⏱ {elapsed}s · Done",
      "cardSentText": "📋 Card message sent.",
      "mediaSentText": "📎 File sent—please check your chat.",
      "mediaParseFailedText": "⚠️ Could not parse this media for a reply. {emptyReply}",
      "mediaDeliveredText": "✅ File delivered.",
      "processedCompleteText": "✅ Processing complete.",
      "timeoutText": "⚠️ Timed out (~{minutes} min). Please retry or send a text message.",
      "dispatchErrorText": "⚠️ Reply failed ({kind}): {detail}",
      "mediaErrorNoAccessText": "⚠️ File send failed: no access to {mediaUrl}\nAdd the parent directory to mediaLocalRoots in openclaw.json and restart.",
      "mediaErrorReasonText": "⚠️ File send failed: {reason}",
      "mediaErrorGenericText": "⚠️ File send failed: could not handle {mediaUrl}. Please try again later.",
      "queuedText": "Received—queued for processing…",
      "mergedQueuedText": "Received—merged and queued…",
      "mergedDoneText": "✅ Merged processing complete—see the previous reply.",
      "sessionResetText": "✅ Session reset.",
      "sessionNewText": "✅ New session started."
    }
  }
}
```

## Streaming Output

Only **Bot WebSocket** and **Bot Webhook** support WeCom `stream` / `replyStream`. **Agent inbound chat does not use Bot-style streaming**; outbound delivery is primarily one-shot Markdown / media via the Agent API.

### Streaming Configuration Quick Reference

The commands below come from the [Streaming architecture](../../doc/wecom/OpenClaw-WeCom-Streaming-Architecture.md) guide and are safe to copy when switching runtime behavior.

```bash
# Default mode: status line during work + final bundled answer
openclaw config set channels.wecom.streaming false
openclaw config set channels.wecom.footer.status true
openclaw config set channels.wecom.footer.elapsed true

# Enable streaming: status progress + typewriter answer content
openclaw config set channels.wecom.streaming true
openclaw config set channels.wecom.streaming.status true
openclaw config set channels.wecom.streaming.content true

# Content-only typewriter mode: no intermediate status line refresh
openclaw config set channels.wecom.streaming true
openclaw config set channels.wecom.streaming.status false
openclaw config set channels.wecom.streaming.content true

# Disable streaming
openclaw config set channels.wecom.streaming false

# Thinking placeholder
openclaw config set channels.wecom.sendThinkingMessage true
```

Equivalent JSON:

```json
{
  "channels": {
    "wecom": {
      "streaming": {
        "status": true,
        "content": true
      },
      "footer": {
        "status": true,
        "elapsed": true
      },
      "sendThinkingMessage": true
    }
  }
}
```

`streaming` accepts either a boolean or an object. CLI paths such as `channels.wecom.streaming.status` and `channels.wecom.streaming.content` write the object shape; runtime parsing accepts `true`, `false`, and `{ "enabled"?, "status"?, "content"? }`. To explicitly disable object-form streaming, use `{ "enabled": false }` or run `openclaw config set channels.wecom.streaming false`.

### Config Shape

`channels.wecom.streaming` accepts boolean or object:

| Value | Meaning |
|-------|---------|
| omitted / `false` | **Default mode**: status line + final bundled answer (`streamingContent=false`) |
| `true` | **Streaming mode**: both status and answer block increments enabled |
| `{ "status": false, "content": true }` | Answer increments only, no status line refresh |
| `{ "enabled": false }` | Explicitly disable streaming in object form (`WecomStreamingNestedConfig`) |

`channels.wecom.footer`:

| Key | Default | Description |
|-----|---------|-------------|
| `footer.status` | `true` | Show status line (thinking / tool / reading) in the bubble |
| `footer.elapsed` | `false` | Append elapsed footer (`finishFooterText`) on close |

`sendThinkingMessage` (default `true`): when `true`, WS sends a **protocol first frame** via `sendThinkingReply` (`streamPlaceholderText` or built-in `<think></think>`) before the first Agent token; when `false`, it skips that thinking first frame.

`streamPlaceholderText`: first `finish=false` stream content; distinct from `welcomeText` and `thinkingText`. Webhook often falls back to `"1"` when unset.

Composition logic: `config/streaming-config.ts` (via `@partme.ai/openclaw-message-sdk/transcript`) merges status / answer / footer into a **single plain-text** `replyStream` payload.

### Mode Differences

| Capability | Bot WebSocket | Bot Webhook | Agent |
|------------|---------------|-------------|-------|
| Stream carrier | `replyStream` / `replyStreamNonBlocking` | HTTP `msgtype: stream` + `stream_refresh` | No Bot stream |
| First frame | `sendThinkingReply` + `streamPlaceholderText` | `resolveWecomStreamPlaceholderText`, default `"1"` | N/A |
| Status line | `footer.status` or `streaming.status` | Same, via `webhook/reply-pipeline.ts` | N/A |
| Media outbound | proactive `aibot_send_msg`, does not overwrite thinking stream | `outbound/reply-deliver.ts` updates streamStore | Agent API upload |
| Close text | `dispatch/finish-thinking.ts` → `resolveThinkingFinishText` | same + `applyWecomWebhookEmptyContentFallback` | final API message |

### Hard Limits and Fallback

- **Plain text only** in `replyStream`; Markdown rendering depends on fallback paths (e.g. `sendMessage` markdown).
- **6-minute window**: no stream update for 6 minutes → WeCom **errcode 846608** (`STREAM_EXPIRED_ERRCODE`). `finishWsThinkingStream` catches this and falls back to proactive `sendMessage`.
- **Agent reply timeout**: default `network.agentReplyTimeoutMs` = 360000 ms; user sees `timeoutText`.
- **Blank close**: empty content cannot `finish=true`; plugin uses `emptyReplyText` and other visible fallbacks.

### Sample Configs

**Stable non-streaming (default, good for atomic business replies):**

```json
{
  "channels": {
    "wecom": {
      "streaming": false,
      "footer": { "status": true, "elapsed": true }
    }
  }
}
```

**Typewriter + tool progress:**

```json
{
  "channels": {
    "wecom": {
      "streaming": true,
      "footer": { "status": true, "elapsed": true },
      "sendThinkingMessage": true
    }
  }
}
```

**Status line only, answer on close:**

```json
{
  "channels": {
    "wecom": {
      "streaming": { "status": true, "content": false },
      "footer": { "status": true, "elapsed": false }
    }
  }
}
```

### Verification

```bash
cd extensions/wecom
pnpm test src/config/streaming-config.test.ts src/dispatch/finish-thinking.test.ts
openclaw gateway restart
grep -E '846608|stream expired|sendThinkingReply|enter_chat welcome|finish=true' /tmp/openclaw/openclaw-*.log
```

See [Streaming architecture](../../doc/wecom/OpenClaw-WeCom-Streaming-Architecture.md).

## Knowledge / RAG

**Accurate statement**: `@partme.ai/wecom` does **not** embed knowledge hooks. There is **no** `channels.wecom.knowledge` or `registerKnowledgeHooks` in this extension. Setting `channels.wecom.knowledge.*` alone **does not** enable RAG.

Knowledge is provided by the separate **`@partme.ai/openclaw-knowledge`** plugin (`before_prompt_build` auto-retrieval + `knowledge_query` / `knowledge_add` tools). WeCom only transports messages into the OpenClaw Agent runtime; once the Agent loads the knowledge plugin, WeCom conversations can be answered from the knowledge base.

### Message Flow

```text
WeCom user message
  → WeCom inbound (WS / Webhook / Agent callback)
  → OpenClaw dispatch (bindings / dynamicAgents)
  → Agent Runtime
       ├─ [knowledge plugin] before_prompt_build retrieval → system injection
       └─ [optional] Agent calls knowledge_* tools
  → Reply via WeCom outbound (Bot stream or Agent API)
```

### Config Example

Configure WeCom and knowledge **separately**:

```json
{
  "plugins": {
    "entries": {
      "knowledge": {
        "enabled": true,
        "config": {
          "enabled": true,
          "embedding": {
            "provider": "openai",
            "model": "text-embedding-3-small",
            "dimensions": 1536
          },
          "store": {
            "provider": "zvec",
            "dbPath": "./data/knowledge-wecom.db"
          },
          "retrieval": {
            "strategy": "hybrid",
            "topK": 5,
            "minScore": 0.3
          },
          "injection": {
            "position": "system",
            "maxContextLength": 2000
          }
        }
      }
    }
  },
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>"
    }
  },
  "bindings": [
    {
      "agentId": "main",
      "match": { "channel": "wecom", "accountId": "default" }
    }
  ]
}
```

### Verification

```bash
openclaw plugins install @partme.ai/openclaw-knowledge
openclaw gateway restart
openclaw run knowledge:stats
```

Ask the assistant to remember a test fact in WeCom, then ask again in a new message; the answer should use the configured knowledge store.

Further reading:

- [Knowledge RAG guide](../../doc/knowledge/OpenClaw-Knowledge-RAG-Guide_CN.md)
- [Knowledge RAG integration](../../doc/knowledge/OpenClaw-Knowledge-RAG-Integration_CN.md)
- [Configuration guide §9 Knowledge](../../doc/wecom/OpenClaw-WeCom-Configuration.md#9-knowledge--rag-integration)

## Media, MEDIA Directive, Template Cards, MCP, and Skills

### before_prompt_build Injection

In `index.ts`, the plugin registers `before_prompt_build` (only when `channelId === wecom`) and appends to Agent system context:

- Use the **`MEDIA:`** directive to send image/video/voice/file → see `wecom-send-media` skill
- Output a **JSON code block** with `card_type` for structured cards → see `wecom-send-template-card` skill

This guides LLM output format; it does not send media or cards by itself.

### MEDIA Directive

Line-level directives in Agent replies:

```text
MEDIA: /absolute/path/to/file.png
MEDIA: `/path/with spaces/report.pdf`
```

Parsed by `outbound/media-deliver.ts`, `media/media-uploader.ts`, and `agent/handler.ts`. Local paths must be under `mediaLocalRoots`. Media is sent via **proactive WS `aibot_send_msg`** so it does not overwrite the `replyStream` thinking flow.

### Template Cards

Markdown JSON code blocks in LLM output are extracted by `outbound/template-card-parser.ts`. Valid `card_type` values are in `VALID_CARD_TYPES` in `types/const.ts`. Incomplete JSON is masked during streaming via `maskTemplateCardBlocks`. After send, `cardSentText` can inform the user.

### wecom_mcp Tool

In full mode the plugin registers Agent tool **`wecom_mcp`** (`mcp/tool.ts`):

| Action | Usage |
|--------|-------|
| `list` | List MCP tools for a category |
| `call` | Invoke doc, contact, msg, etc. MCP methods |

Session context is injected automatically: `requesterUserId`, `accountId`, `chatId`, `chatType`. Doc MCP endpoints can be fetched via Bot WS command `aibot_get_mcp_config` and persisted under state dir `wecomConfig/config.json` (`mcp/config-fetch.ts`).

### Built-in Skills (extensions/wecom/skills/)

| Skill | Purpose |
|-------|---------|
| `wecom-send-media` | MEDIA directive for local files |
| `wecom-send-template-card` | Template card JSON format |
| `wecom-doc` | WeCom document MCP |
| `wecom-contact` | Contacts |
| `wecom-schedule` / `wecom-meeting` / `wecom-todo` | Schedule, meeting, todo |
| `wecom-msg` | Chat history and media download |
| `wecom-smartsheet` | Smart sheet |
| `wecom-preflight` | Pre-send checks |
| `wecom-unified` | Unified operation references |

Temporary HTTP media: `/wecom-media` route (15-minute TTL) for outbound links.

## Nested `bot` config compatibility (backward compatible)

From `@partme.ai/wecom@2026.5.25-1`, the plugin **normalizes legacy nested `bot` blocks at read time** into flat runtime fields. **Prefer flat keys for new configs** (`channels.wecom.botId` / `accounts.<id>.botId`); nested `bot` remains accepted for older or CLI-generated layouts.

| Nested path (compat) | Flat runtime key (canonical) | Notes |
|----------------------|------------------------------|-------|
| `bot.botId` | `botId` | WebSocket Bot credentials |
| `bot.secret` | `secret` | WebSocket Bot credentials |
| `bot.connectionMode` | `connectionMode` | `websocket` / `webhook` |
| `bot.welcomeText` | `welcomeText` | enter_chat welcome |
| `bot.streamPlaceholderContent` | `streamPlaceholderText` | Stream first-frame placeholder (legacy alias) |
| `bot.dm.policy` | `dmPolicy` | DM policy |
| `bot.dm.allowFrom` / `bot.dm.allow` | `allowFrom` | DM allowlist |

**Priority**: flat keys at the same level **override** nested `bot.*` (incremental migration). Both `channels.wecom.bot.*` and `accounts.<id>.bot.*` are supported; nested `agent` is unchanged.

Migration example (nested → flat):

```json
{
  "channels": {
    "wecom": {
      "accounts": {
        "cs-assistant": {
          "name": "CS Assistant",
          "enabled": true,
          "botId": "<BOT_ID>",
          "secret": "<BOT_SECRET>",
          "connectionMode": "websocket",
          "welcomeText": "Hello!",
          "streamPlaceholderText": "Working on it...",
          "dmPolicy": "open"
        }
      }
    }
  }
}
```

## Multi-Account and Dynamic Agents

Use multi-account configuration for multiple enterprises, Bots, or team-level isolation. Account-level fields override top-level fields with the same name.

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "main",
      "accounts": {
        "main": {
          "botId": "<BOT_ID_MAIN>",
          "secret": "<BOT_SECRET_MAIN>",
          "agent": {
            "corpId": "<CORP_ID>",
            "corpSecret": "<CORP_SECRET_MAIN>",
            "agentId": "<AGENT_ID_MAIN>",
            "token": "<TOKEN_MAIN>",
            "encodingAESKey": "<AES_KEY_MAIN>"
          }
        },
        "support": {
          "dmPolicy": "allowlist",
          "allowFrom": ["admin_user_id"],
          "agent": {
            "corpId": "<CORP_ID>",
            "corpSecret": "<CORP_SECRET_SUPPORT>",
            "agentId": "<AGENT_ID_SUPPORT>",
            "token": "<TOKEN_SUPPORT>",
            "encodingAESKey": "<AES_KEY_SUPPORT>"
          }
        }
      }
    }
  }
}
```

For production multi-account setups, configure explicit bindings so messages do not route to an unexpected Agent:

```json
{
  "bindings": [
    {
      "agentId": "main",
      "match": {
        "channel": "wecom",
        "accountId": "main"
      }
    }
  ]
}
```

Dynamic Agents create isolated sessions by user or group. Use them when different users or groups must not share context.

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

| Config | Description | Default |
|--------|-------------|---------|
| `channels.wecom.dynamicAgents.enabled` | Enable dynamic Agent routing | `false` |
| `channels.wecom.dynamicAgents.dmCreateAgent` | Create one isolated Agent per DM user | `true` |
| `channels.wecom.dynamicAgents.groupEnabled` | Enable dynamic Agents for groups | `true` |
| `channels.wecom.dynamicAgents.adminUsers` | Admin users that bypass dynamic routing and use the main Agent | `[]` |

## Practical CLI Quick Reference

### Welcome and User-Visible Text

```bash
openclaw config set channels.wecom.welcomeText "Hello, I am your WeCom assistant."
openclaw config set channels.wecom.agent.welcomeText "Welcome to the self-built app."
openclaw config set channels.wecom.thinkingText "Thinking…"
openclaw config set channels.wecom.toolStatusText "Running {toolName}…"
openclaw config set channels.wecom.finishFooterText "⏱ {elapsed}s · Done"
openclaw gateway restart
```

To verify, re-open the Bot chat to trigger `enter_chat`, then check logs for `enter_chat welcome`. `welcomeText` is the enter-chat welcome message; `streamPlaceholderText` is the Bot stream protocol first frame.

### Access Control and Pairing

```bash
# Require pairing approval for new DM users
openclaw config set channels.wecom.dmPolicy pairing

# Allow only selected groups
openclaw config set channels.wecom.groupPolicy allowlist
openclaw config set channels.wecom.groupAllowFrom '["<GROUP_CHAT_ID>"]'

# Review and approve pairing requests
openclaw pairing list wecom
openclaw pairing approve wecom <PAIRING_CODE>
```

Bot WS and Bot Webhook use `channels.wecom.dmPolicy` / `channels.wecom.groupPolicy`. Agent DMs can override with `channels.wecom.agent.dmPolicy` and `channels.wecom.agent.allowFrom`.

### Knowledge / RAG

The WeCom plugin does not embed `channels.wecom.knowledge.*`. Install and configure the knowledge plugin separately; WeCom only transports messages into the Agent Runtime.

```bash
openclaw plugins install @partme.ai/openclaw-knowledge
openclaw gateway restart
openclaw run knowledge:stats
```

See [Knowledge / RAG](#knowledge--rag) and [Configuration guide §9](../../doc/wecom/OpenClaw-WeCom-Configuration.md#9-knowledge--rag-integration).

### Media Tests and Limits

```bash
openclaw config set channels.wecom.mediaLocalRoots '["/data/wecom-media"]'
openclaw config set channels.wecom.media.maxBytes 20971520
openclaw gateway restart
```

Recommended checks:

1. Send an image, file, and voice message to the Bot; logs should show media download or save records.
2. Ask the Agent to reply with `MEDIA: /data/wecom-media/report.pdf`; allowlisted files should send.
3. Try a path outside `mediaLocalRoots`; the user should see a `mediaErrorNoAccessText`-style message.
4. Test near-limit image / video / file behavior: common image and video limits are 10 MB, voice is commonly 2 MB AMR, and files are controlled by `media.maxBytes`.

### Verification and Troubleshooting Commands

```bash
# Basic health checks
openclaw channels list
openclaw channels status --probe
openclaw plugins doctor

# CLI device authorization: message send / agent --deliver need operator.write
openclaw devices list
openclaw devices approve --latest

# Bot WS active send: use raw userid, not user:<id>
openclaw message send --channel wecom --account default --target <USERID> --message "Bot WS test"

# Agent / Cron targets support explicit prefixes
openclaw message send --channel wecom --account default --target user:<USER_ID> --message "Agent outbound test"

# Useful log grep commands
LOG=/tmp/openclaw/openclaw-$(date +%Y-%m-%d).log
grep -E 'Authentication successful|WebSocket connected|Kicked by server|\[webhook\]' "$LOG"
grep -E 'aibot_callback|policy blocked|authz:|duplicate msgId' "$LOG"
grep -E '846608|stream expired|stream_refresh|finalizeWsWecomReply|active-reply' "$LOG"
grep -E '\[wecom-agent\]|gettoken|60020|93006|Agent reply timed out' "$LOG"
```

## Verification and CLI Usage

```bash
openclaw channels list
openclaw channels status --probe
openclaw plugins doctor

# Bot WS active send: raw userid, not user:<id>.
openclaw message send --channel wecom --account default --target <USERID> --message "Bot WS test"

# Agent/Cron target formats support explicit prefixes.
openclaw message send --channel wecom --account default --target user:<USER_ID> --message "Agent outbound test"
```

Cron delivery requires Agent mode:

| Target Format | Meaning | Example |
|---------------|---------|---------|
| `party:<id>` | Department | `party:1` |
| `dept:<id>` | Department alias | `dept:5` |
| `tag:<id>` | Tag | `tag:Ops` |
| `user:<id>` | Specific user | `user:zhangsan` |
| `group:<id>` | Group chat | `group:wr123abc` |
| `chat:<id>` | Group chat alias | `chat:wc456def` |
| Numeric string | Auto-detected as department | `1` |

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

## Media and Files

| Direction | Type | Behavior |
|-----------|------|----------|
| Inbound | Image, voice, video, file | Downloads/decrypts and writes into inbound context when the current path supports it |
| Inbound | Mixed and quoted messages | Parsed when the Bot payload includes the content |
| Outbound | Image/video | Common Bot limit is 10 MB; oversized items are downgraded to files when possible |
| Outbound | Voice | AMR and common 2 MB limit; non-AMR or oversized items are handled as files |
| Outbound | File | Limited by `media.maxBytes`; full capability depends on Agent API or fallback |
| Local path | Any local file | Must be under `mediaLocalRoots`; paths outside the allowlist are rejected |

```bash
openclaw config set channels.wecom.mediaLocalRoots '["/data/wecom-media"]'
openclaw config set channels.wecom.media.maxBytes 20971520
```

Common size policy:

| Type | Common Limit | Plugin Behavior |
|------|--------------|-----------------|
| Image | 10 MB | Downgrade to file when possible |
| Video | 10 MB | Downgrade to file when possible |
| Voice | 2 MB, usually AMR | Non-AMR or oversized items are handled as files |
| File | 20 MB | Rejected or downgraded when above `media.maxBytes` |

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `60020 not allow to access from your ip` | WeCom API call from an untrusted egress IP | Add the Gateway IP in WeCom admin or set `channels.wecom.network.egressProxyUrl` |
| `93006 invalid chatid` | Bot WS active send used `user:<id>` | Use raw userid for Bot WS active sends |
| `Kicked by server` | Multiple Gateway instances or duplicate credentials | Keep one active WS connection per Bot account |
| Bot Webhook unexpectedly bypassed | The same account still has `botId` + `secret` | Remove Bot WS credentials for pure Webhook mode |
| Agent callback save fails in WeCom Admin | Gateway was not preconfigured with Token/AESKey or the URL is not public | Configure and restart Gateway first, then save `/plugins/wecom/agent/<accountId>` |
| Local media path denied | File is outside `mediaLocalRoots` | Add a trusted directory to `mediaLocalRoots` |
| Cron does not deliver | Missing Agent mode or `agent.agentId` | Configure full `agent.*` fields and verify target visibility |

## Development

```bash
cd extensions/wecom
pnpm build
pnpm typecheck
pnpm test
pnpm run pack-dry
```

Suggested validation order:

1. Run `pnpm test` and confirm the roughly 330 Vitest cases still pass.
2. Run `openclaw channels status --probe` and confirm the WeCom channel and account status.
3. For Bot WS, check Gateway logs for connection and authentication success.
4. For Agent, first verify callback URL saving in WeCom Admin, then test proactive delivery.
5. For media, test an allowlisted local file, an oversized image, and a normal file.

## More Docs

- [Configuration guide](../../doc/wecom/OpenClaw-WeCom-Configuration.md)
- [Integration checklist](../../doc/wecom/OpenClaw-WeCom-Integration-Checklist.md)
- [Architecture](../../doc/wecom/OpenClaw-WeCom-Architecture.md)
- [Streaming architecture](../../doc/wecom/OpenClaw-WeCom-Streaming-Architecture.md)
- [Testing and debugging](../../doc/wecom/OpenClaw-WeCom-Testing.md)

## License

ISC
