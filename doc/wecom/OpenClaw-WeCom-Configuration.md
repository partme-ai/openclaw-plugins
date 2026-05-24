# OpenClaw WeCom Configuration Guide

This guide is the authoritative English configuration reference for `@partme.ai/wecom`. It uses concise, scenario-based examples that you can paste into `~/.openclaw/openclaw.json` or your Gateway configuration.

Configuration lives under `channels.wecom.*`. Multi-account setups use `channels.wecom.accounts.<accountId>`, where account-level fields override top-level fields.

Related docs: [Architecture](./OpenClaw-WeCom-Architecture.md), [Streaming](./OpenClaw-WeCom-Streaming-Architecture.md), [Testing](./OpenClaw-WeCom-Testing.md), [README](../../extensions/wecom/README.md)

## Scenario Index

1. [Minimal Bot WebSocket / basic DM conversation](#1-minimal-bot-websocket--basic-dm-conversation)
2. [Welcome message and user-facing templates](#2-welcome-message-and-user-facing-templates)
3. [Streaming output / footer / thinking messages](#3-streaming-output--footer--thinking-messages)
4. [Access control: DM and group policies](#4-access-control-dm-and-group-policies)
5. [Media: image, file, audio, video, local roots, max bytes](#5-media-image-file-audio-video-local-roots-max-bytes)
6. [Agent mode / corp app / proactive push](#6-agent-mode--corp-app--proactive-push)
7. [Dual mode Bot WebSocket + Agent production setup](#7-dual-mode-bot-websocket--agent-production-setup)
8. [Multi-account](#8-multi-account)
9. [Knowledge / RAG integration](#9-knowledge--rag-integration)
10. [Advanced: dynamicAgents, egress proxy, ASR, Bot Webhook alternative](#10-advanced-dynamicagents-egress-proxy-asr-bot-webhook-alternative)
11. [Cron scheduled delivery](#11-cron-scheduled-delivery)

## How to Use This Guide

Start with Scenario 1 for Bot WebSocket, Scenario 6 for Agent, or Scenario 7 when you need both. Copy one complete JSON block, replace placeholders, restart Gateway, then run the verification commands in that scenario.

Runtime configuration is flat under `channels.wecom.*` and `channels.wecom.accounts.<accountId>.*`. Do not use nested `bot.*`, `botIds`, or `aibotid` as primary runtime configuration; Bot WebSocket uses `botId` + `secret`, while Bot Webhook uses `token` + `encodingAESKey`.

## 1. Minimal Bot WebSocket / Basic DM Conversation

### When to Use

Use this when you want the shortest path to a WeCom smart robot DM conversation. Bot WebSocket does not require a public callback URL.

### Prerequisites

- Install the plugin: `openclaw plugins install @partme.ai/wecom`
- In WeCom admin, go to **Security and Management -> Management Tools -> Smart Robot**, create a robot in **API mode**, then copy the generated Bot ID and Secret. API mode means OpenClaw connects with the official Bot API instead of a group webhook URL.
- Copy the Bot ID and Secret from WeCom admin.
- Use Node.js 22+ and OpenClaw 2026.4.12+.

### Complete JSON

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

### Field Explanation

| Field | Required | Description |
|-------|----------|-------------|
| `enabled` | Yes | Enables the WeCom channel. |
| `connectionMode` | No | Use `websocket` for Bot WebSocket. This is the default mode. |
| `botId` | Yes | WeCom smart robot Bot ID. |
| `secret` | Yes | WeCom smart robot Secret. |

If `botId` + `secret` are present, the plugin starts Bot WebSocket even when `connectionMode` is set to `webhook`. For a pure Bot Webhook setup, omit `botId` and `secret`; see Scenario 10.

### Verification

```bash
openclaw gateway restart
openclaw channels status --probe
```

Send `hello` to the Bot in WeCom. You should receive an AI reply, and Gateway logs should show WebSocket authentication success.

## 2. Welcome Message and User-Facing Templates

### When to Use

Use this when you need to customize the message users see when they enter a chat, while the assistant is thinking, when a tool runs, or when a request times out.

### Prerequisites

- Scenario 1 is working.
- Decide the user-facing text your organization wants to show.

### Complete JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "welcomeText": "Hello, I am your enterprise AI assistant. How can I help?",
      "receivedText": "Received. Processing...",
      "thinkingText": "Thinking...",
      "toolStatusText": "Using {toolName}...",
      "readingText": "Reading attachments...",
      "generatingText": "Generating an answer...",
      "compactionText": "Compacting context...",
      "queuedText": "Queued. I will process this soon.",
      "mergedQueuedText": "Received another message. Merging it into the current request...",
      "mergedDoneText": "Merged your recent messages.",
      "streamPlaceholderText": "1",
      "emptyReplyText": "Sorry, I could not produce an answer this time.",
      "timeoutText": "The request timed out. Please try again later."
    }
  }
}
```

### Field Explanation

| Field | Description |
|-------|-------------|
| `welcomeText` | Message sent when the user enters or subscribes to the chat. |
| `receivedText` | Optional acknowledgement when an inbound message is accepted. |
| `thinkingText` | Status text while the assistant is preparing an answer. |
| `toolStatusText` | Tool-call status text. Supports `{toolName}`. |
| `readingText` | Status text while attachments are being read. |
| `generatingText` | Status text when answer generation starts. |
| `compactionText` | Status text while long context is being compacted. |
| `queuedText` | Queue acknowledgement for delayed processing. |
| `mergedQueuedText` / `mergedDoneText` | Bot Webhook debounce and merge messages. |
| `streamPlaceholderText` | Protocol placeholder for the first Bot stream frame; this is not a welcome message. |
| `emptyReplyText` | Fallback text when the agent returns no content. |
| `timeoutText` | Fallback text when processing exceeds the timeout. |

Other supported flat text keys are `cardSentText`, `mediaSentText`, `mediaParseFailedText`, `mediaDeliveredText`, `processedCompleteText`, `dispatchErrorText`, `mediaErrorNoAccessText`, `mediaErrorReasonText`, `mediaErrorGenericText`, `sessionResetText`, and `sessionNewText`. Account-level values override top-level values.

### Verification

1. Restart Gateway.
2. Open or re-open the Bot DM in WeCom.
3. Confirm the welcome text appears.
4. Ask a question that triggers model reasoning or tools, and confirm the status text is customized.

## 3. Streaming Output / Footer / Thinking Messages

### When to Use

Use this when you want typewriter-style incremental Bot replies, a completion footer, elapsed time, or control over thinking placeholder messages.

### Prerequisites

- Scenario 1 is working.
- Bot WebSocket is recommended for the best streaming experience.

### Complete JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "sendThinkingMessage": true,
      "thinkingText": "Thinking...",
      "streaming": {
        "enabled": true,
        "status": true,
        "content": true
      },
      "footer": {
        "status": true,
        "elapsed": true
      },
      "finishFooterText": "Completed in {elapsed}s"
    }
  }
}
```

`streaming` also accepts a boolean. Use `false` for status/final-only behavior, or `true` for the default streaming sub-options. The canonical object form is shown above because it lets you control status updates and answer-content updates independently.

### Field Explanation

| Field | Description |
|-------|-------------|
| `sendThinkingMessage` | Sends a thinking placeholder before the final answer. Defaults to `true`. |
| `streaming` | Boolean or object. Object form is canonical: `{ "enabled": true, "status": true, "content": true }`. |
| `streaming.enabled` | Enables incremental streaming. |
| `streaming.status` | Streams status updates such as tool or phase changes. |
| `streaming.content` | Streams answer content incrementally. |
| `footer.status` | Keeps status/footer rendering enabled. |
| `footer.elapsed` | Shows elapsed time when the stream closes. |
| `finishFooterText` | Footer template. Supports `{elapsed}`. |

### Verification

```bash
openclaw gateway restart
```

Send a long question. The Bot should update the answer incrementally and close with the configured footer.

## 4. Access Control: DM and Group Policies

### When to Use

Use this when only selected users or groups should be allowed to talk to the Bot or Agent.

### Prerequisites

- Scenario 1 is working.
- You know the WeCom user IDs and group chat IDs that should be allowed.

### Complete JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "dmPolicy": "pairing",
      "allowFrom": ["<USER_ID_1>", "<USER_ID_2>"],
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["<GROUP_CHAT_ID>"],
      "groups": {
        "<GROUP_CHAT_ID>": {
          "allowFrom": ["<USER_ID_1>", "<ADMIN_USER_ID>"]
        }
      }
    }
  }
}
```

### Field Explanation

| Field | Description |
|-------|-------------|
| `dmPolicy` | DM policy: `open`, `pairing`, `allowlist`, or `disabled`. |
| `allowFrom` | User allowlist for DM access. Used by `allowlist` and authorization flows. |
| `groupPolicy` | Group policy: `open`, `allowlist`, or `disabled`. |
| `groupAllowFrom` | Allowed group chat IDs when `groupPolicy` is `allowlist`. |
| `groups.<chatId>.allowFrom` | Per-group sender allowlist. |

### Verification

```bash
openclaw gateway restart
openclaw pairing list wecom
openclaw pairing approve wecom <PAIRING_CODE>
```

An unauthorized DM user should receive a pairing code. Authorized users should receive normal replies. In groups, only configured groups and users should trigger the Bot.

Policy paths differ by runtime path:

| Runtime path | DM policy key | Group policy key | Pairing delivery |
|--------------|---------------|------------------|------------------|
| Bot WebSocket | `channels.wecom.dmPolicy` | `channels.wecom.groupPolicy` | Bot WS DM |
| Bot Webhook | `channels.wecom.dmPolicy` | `channels.wecom.groupPolicy` | Webhook response/stream |
| Agent | `channels.wecom.agent.dmPolicy` | Not applicable | Agent API DM |

## 5. Media: Image, File, Audio, Video, Local Roots, Max Bytes

### When to Use

Use this when users send media to WeCom, or when Agent replies need to send local files from trusted paths.

### Prerequisites

- Scenario 1 is working for inbound media.
- Scenario 6 is required for full outbound file delivery through Agent mode.
- Create local directories that are safe for the plugin to read.

### Complete JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "mediaLocalRoots": [
        "~/Downloads",
        "~/Documents/openclaw-reports"
      ],
      "media": {
        "maxBytes": 20971520
      },
      "mediaErrorNoAccessText": "This file path is not allowed. Ask an administrator to update mediaLocalRoots."
    }
  }
}
```

### Field Explanation

| Field | Description |
|-------|-------------|
| `mediaLocalRoots` | Whitelisted local directories for outbound file reads. Supports `~`. |
| `media.maxBytes` | Maximum file size in bytes. The example uses 20 MB. |
| `mediaErrorNoAccessText` | User-facing message when a file path is outside the whitelist. |

Media behavior:

| Direction | Type | Limit | Fallback |
|-----------|------|-------|----------|
| Inbound | Image, voice, video, file | WeCom platform limits | Download/decrypt into inbound context when supported. |
| Outbound | Image | 10 MB | Send as file when possible. |
| Outbound | Video | 10 MB | Send as file when possible. |
| Outbound | Voice | 2 MB AMR | Non-AMR or oversized voice is treated as file. |
| Outbound | File | `media.maxBytes` | Rejected when too large. |

Local file sending is guarded by `mediaLocalRoots`; paths outside the allowlist are rejected before upload. `media.tempDir`, `media.retentionHours`, and `media.cleanupOnStart` are TypeScript/planned keys and are not wired as runtime cleanup behavior yet.

### Verification

1. Restart Gateway.
2. Send an image to the Bot and confirm the assistant can read it.
3. Ask the Agent to send a file under `mediaLocalRoots` and confirm delivery.
4. Try a file outside `mediaLocalRoots`; the configured error text should appear.

## 6. Agent Mode / Corp App / Proactive Push

### When to Use

Use this when you need a WeCom self-built app, proactive push, scheduled delivery, department or tag broadcast, or full-format outbound media.

### Prerequisites

- Create a WeCom self-built app.
- In WeCom admin, create a **self-built app**, record Corp ID, Secret, and Agent ID, then set the app visible range to include your test users.
- Enable **API message receiving**, copy Token and EncodingAESKey, and save the callback URL only after Gateway has the same values configured.
- Gateway must be reachable from WeCom by public URL or tunnel.
- Configure Gateway first, then save the callback URL in WeCom admin.

### Complete JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "agent": {
        "corpId": "<YOUR_CORP_ID>",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": "<YOUR_AGENT_ID>",
        "token": "<YOUR_CALLBACK_TOKEN>",
        "encodingAESKey": "<YOUR_43_CHAR_ENCODING_AES_KEY>",
        "welcomeText": "Welcome to the enterprise app assistant."
      },
      "network": {
        "agentReplyTimeoutMs": 360000
      }
    }
  }
}
```

Callback URL:

```text
https://<GATEWAY_HOST>/plugins/wecom/agent/default
```

### Field Explanation

| Field | Description |
|-------|-------------|
| `agent.corpId` | WeCom Corp ID. |
| `agent.corpSecret` | Self-built app secret. |
| `agent.agentId` | Self-built app Agent ID. |
| `agent.token` | Callback verification token. |
| `agent.encodingAESKey` | 43-character callback AES key. |
| `agent.welcomeText` | Agent-mode welcome text. |
| `network.agentReplyTimeoutMs` | Agent reply timeout in milliseconds. |

Inbound Agent replies require `corpId`, `corpSecret`, `token`, and `encodingAESKey`. Proactive send, Cron, and delivery fallback also require `agent.agentId`. If WeCom returns `60020 not allow to access from your ip`, add a trusted IP in WeCom admin or configure `network.egressProxyUrl`.

### Verification

```bash
openclaw gateway restart
openclaw channels status --probe
openclaw message send --channel wecom --account default --target user:<USER_ID> --message "Agent outbound test"
```

Open the self-built app in WeCom and send a DM. You should receive an Agent reply.

Supported proactive target formats include `user:<id>`, `party:<id>`, `tag:<id>`, `group:<id>`, and `chat:<id>`.

## 7. Dual Mode Bot WebSocket + Agent Production Setup

### When to Use

Use this for production. Bot WebSocket handles interactive streaming chat, while Agent handles proactive push, Cron, file fallback, and full-format outbound delivery.

### Prerequisites

- Scenario 1 Bot credentials are ready.
- Scenario 6 Agent credentials are ready.
- `mediaLocalRoots` is set if local file delivery is needed.

### Complete JSON

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
        "egressProxyUrl": "http://<YOUR_PROXY_HOST>:3128"
      }
    }
  }
}
```

### Field Explanation

| Field | Description |
|-------|-------------|
| `botId` / `secret` | Bot WebSocket credentials for interactive chat. |
| `streaming` | Enables incremental Bot replies. |
| `footer` | Enables stream footer/status rendering. |
| `mediaLocalRoots` / `media.maxBytes` | Controls local media delivery. |
| `agent.*` | Self-built app credentials for proactive and fallback delivery. |
| `network.egressProxyUrl` | Optional HTTP proxy for fixed egress IP requirements. |
| `network.agentReplyTimeoutMs` | Timeout budget for Agent replies. |

### Verification

1. Restart Gateway.
2. Send a Bot DM and confirm streaming works.
3. Send a local file through Agent and confirm it delivers.
4. If using Cron, verify scheduled delivery with Scenario 11.

Fallback order is Bot WS first, then Agent HTTP API. A common trap is setting `connectionMode: "webhook"` while leaving `botId` + `secret` in the same account: Bot WS still starts because those credentials take priority in runtime startup.

## 8. Multi-Account

### When to Use

Use this when separate teams or environments need different Bot/Agent credentials, policies, and outbound defaults.

### Prerequisites

- Create credentials for each WeCom Bot or self-built app.
- Choose a stable account ID such as `ops`, `sales`, or `prod`.

### Complete JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "ops",
      "dmPolicy": "open",
      "streaming": {
        "enabled": true,
        "status": true,
        "content": true
      },
      "accounts": {
        "ops": {
          "name": "Ops Assistant",
          "botId": "<OPS_BOT_ID>",
          "secret": "<OPS_BOT_SECRET>",
          "agent": {
            "corpId": "<OPS_CORP_ID>",
            "corpSecret": "<OPS_CORP_SECRET>",
            "agentId": "<OPS_AGENT_ID>",
            "token": "<OPS_CALLBACK_TOKEN>",
            "encodingAESKey": "<OPS_43_CHAR_ENCODING_AES_KEY>"
          }
        },
        "sales": {
          "name": "Sales Assistant",
          "dmPolicy": "allowlist",
          "allowFrom": ["<SALES_USER_ID>"],
          "botId": "<SALES_BOT_ID>",
          "secret": "<SALES_BOT_SECRET>"
        }
      }
    }
  }
}
```

### Field Explanation

| Field | Description |
|-------|-------------|
| `defaultAccount` | Default account for CLI and scheduled outbound delivery. |
| `accounts.<accountId>` | Per-account WeCom configuration. |
| `accounts.<accountId>.name` | Display name for humans and logs. |
| Account-level `botId`, `secret`, `agent`, `dmPolicy` | Override top-level fields for that account. |

Override precedence is account value first, then top-level `channels.wecom` value, then runtime default. Multi-account callback URLs include the account ID, for example `/plugins/wecom/bot/ops` and `/plugins/wecom/agent/ops`; the default account may also receive `/default` aliases.

### Verification

```bash
openclaw gateway restart
openclaw channels list
openclaw message send --channel wecom --account ops --target user:<USER_ID> --message "Ops test"
openclaw message send --channel wecom --account sales --target user:<USER_ID> --message "Sales test"
```

Logs should identify the selected account for each outbound message.

## 9. Knowledge / RAG Integration

### When to Use

Use this when WeCom conversations should retrieve knowledge before model generation or expose `knowledge_*` tools to the assistant.

### Prerequisites

- WeCom Bot or Agent is already working.
- Install and configure the knowledge plugin separately. Start with [Knowledge RAG Guide](../knowledge/OpenClaw-Knowledge-RAG-Guide_CN.md) and [Knowledge RAG Integration](../knowledge/OpenClaw-Knowledge-RAG-Integration_CN.md).
- Important: `@partme.ai/wecom` does not embed knowledge hooks. `channels.wecom.knowledge.*` does not enable RAG by itself unless a knowledge plugin is configured and wired by the runtime.

### Complete JSON

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
  "agents": {
    "defaults": {
      "model": "<YOUR_MODEL_NAME>"
    }
  }
}
```

### Field Explanation

| Field | Description |
|-------|-------------|
| `plugins.entries.knowledge.enabled` | Loads the knowledge plugin. |
| `plugins.entries.knowledge.config.embedding` | Embedding provider and model settings. |
| `plugins.entries.knowledge.config.store` | Vector or local store settings. |
| `plugins.entries.knowledge.config.retrieval` | Retrieval strategy, result count, and score threshold. |
| `plugins.entries.knowledge.config.injection` | Controls where and how retrieved context is injected. |
| `channels.wecom.*` | Keeps WeCom transport configuration separate from knowledge configuration. |

### Verification

```bash
openclaw plugins install @partme.ai/openclaw-knowledge
openclaw gateway restart
openclaw run knowledge:stats
```

In WeCom, ask the assistant to remember a test fact, then ask for that fact in a new message. The answer should use the configured knowledge plugin.

## 10. Advanced: dynamicAgents, Egress Proxy, ASR, Bot Webhook Alternative

### When to Use

Use this when you need isolated agents per user or group, fixed egress IP for WeCom API calls, Agent voice transcription, or HTTP Bot Webhook instead of Bot WebSocket.

### Prerequisites

- Bot or Agent mode is already working.
- For egress proxy, you have a proxy URL allowed by your enterprise network.
- For ASR, you have Tencent Cloud ASR credentials.
- For Bot Webhook, Gateway must be reachable by WeCom.

### Complete JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "webhook",
      "token": "<YOUR_BOT_WEBHOOK_TOKEN>",
      "encodingAESKey": "<YOUR_BOT_43_CHAR_ENCODING_AES_KEY>",
      "receiveId": "<YOUR_BOT_RECEIVE_ID>",
      "dynamicAgents": {
        "enabled": true,
        "dmCreateAgent": true,
        "groupEnabled": true,
        "adminUsers": ["<ADMIN_USER_ID>"]
      },
      "network": {
        "egressProxyUrl": "http://<YOUR_PROXY_HOST>:3128",
        "agentReplyTimeoutMs": 360000
      },
      "agent": {
        "corpId": "<YOUR_CORP_ID>",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": "<YOUR_AGENT_ID>",
        "token": "<YOUR_AGENT_CALLBACK_TOKEN>",
        "encodingAESKey": "<YOUR_AGENT_43_CHAR_ENCODING_AES_KEY>",
        "asr": {
          "appId": "<YOUR_TENCENT_ASR_APP_ID>",
          "secretId": "<YOUR_TENCENT_SECRET_ID>",
          "secretKey": "<YOUR_TENCENT_SECRET_KEY>",
          "engineType": "16k_zh",
          "voiceFormat": "amr"
        }
      }
    }
  }
}
```

Bot Webhook callback URL:

```text
https://<GATEWAY_HOST>/plugins/wecom/bot/default
```

This example combines four advanced concerns in one copyable block. You can use them independently:

- `dynamicAgents` controls per-DM or per-group agent/session isolation.
- `network.egressProxyUrl` is for fixed egress IP and WeCom `60020` errors.
- `agent.asr.*` applies to Agent voice transcription.
- Bot Webhook is the `connectionMode: "webhook"` alternative and requires no `botId`/`secret`.

### Field Explanation

| Field | Description |
|-------|-------------|
| `connectionMode` | Set to `webhook` to use Bot HTTP callback instead of WebSocket. |
| `token` | Bot Webhook verification token. |
| `encodingAESKey` | Bot Webhook AES key. |
| `receiveId` | Bot or receiver ID used for callback decryption validation. |
| `dynamicAgents.enabled` | Enables dynamic agent routing. |
| `dynamicAgents.dmCreateAgent` | Creates isolated agents per DM user. |
| `dynamicAgents.groupEnabled` | Enables isolated agents per group. |
| `dynamicAgents.adminUsers` | Users that always use the main agent. |
| `network.egressProxyUrl` | HTTP proxy for fixed egress IP. Useful for WeCom `60020` errors. |
| `network.timeoutMs` | Planned/unwired for general HTTP retry behavior; do not rely on it yet. |
| `agent.asr.*` | Tencent Cloud ASR settings for Agent voice transcription. |

`network.retries` and `network.retryDelayMs` are also planned/unwired. The currently wired network keys are `network.agentReplyTimeoutMs` and `network.egressProxyUrl`.

### Verification

1. Restart Gateway.
2. Save the Bot Webhook URL in WeCom admin and send a DM. It should work without a WebSocket connection.
3. Send DMs from two users and confirm logs show separate dynamic agent/session IDs.
4. If you previously saw `60020 not allow to access from your ip`, confirm Agent API calls succeed through the proxy.
5. Send a voice message to the Agent app and confirm ASR text appears in logs before model processing.

## 11. Cron Scheduled Delivery

### When to Use

Use this when OpenClaw should deliver scheduled WeCom messages to users, departments, tags, or groups. Cron delivery requires Agent mode because scheduled delivery is proactive outbound messaging.

### Prerequisites

- Scenario 6 or 7 is working.
- The Agent app can send messages to the target user, department, tag, or group.
- Gateway and the scheduler are running in the expected timezone.

### Complete JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "default",
      "agent": {
        "corpId": "<YOUR_CORP_ID>",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": "<YOUR_AGENT_ID>",
        "token": "<YOUR_CALLBACK_TOKEN>",
        "encodingAESKey": "<YOUR_43_CHAR_ENCODING_AES_KEY>"
      }
    }
  }
}
```

### Field Explanation

| Field | Description |
|-------|-------------|
| `defaultAccount` | Account used when a Cron job does not specify `--account`. |
| `agent.*` | Required for proactive outbound scheduled delivery. |
| `--channel wecom` | Selects WeCom for scheduled delivery. |
| `--to user:<id>` | Sends to a user. |
| `--to party:<id>` | Sends to a department. |
| `--to tag:<id>` | Sends to a tag. |
| `--to group:<id>` or `--to chat:<id>` | Sends to a group chat. |

### Verification

```bash
openclaw gateway restart
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

Confirm the job is registered, then wait for the schedule or trigger it through your OpenClaw Cron workflow. The message should be delivered by the configured Agent account.

Useful verification commands:

```bash
openclaw channels status --probe
openclaw message send --channel wecom --account default --target user:<USER_ID> --message "Cron target smoke test"
```

## Notes and Troubleshooting

### Bot Versus Agent

Bot WebSocket is best for interactive streaming chat. Agent mode is required for proactive push, Cron delivery, and full outbound file support.

### Egress Error 60020

If WeCom returns `60020 not allow to access from your ip`, configure `network.egressProxyUrl` or run Gateway from an allowed fixed IP.

### Source of Truth

Configuration types live in `extensions/wecom/src/config/wecom-config.ts` and `extensions/wecom/src/types/config.ts`.

### Probe Semantics

`openclaw channels status --probe` checks whether accounts are configured and reports Bot WS connection state. It is not a replacement for WeCom console callback verification or an end-to-end message test.
