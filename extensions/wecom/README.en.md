<div align="center">

# OpenClaw WeCom

**OpenClaw channel plugin for WeCom Bot WebSocket, Bot Webhook, and self-built Agent app delivery**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fwecom-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-ISC-green)

[简体中文](./README.md) | [English](./README.en.md)

</div>

`@partme.ai/wecom` connects OpenClaw to WeCom / WeChat Work. It supports Bot WebSocket, Bot HTTP Webhook, and self-built Agent app modes. Use Bot WebSocket for low-friction interactive chat and streaming replies; add Agent mode for proactive sends, Cron delivery, departments, tags, and full outbound file fallback.

Current version: `2026.5.24`. Message SDK version: `2026.5.24`. The test suite currently has about 330 Vitest cases.

## Key Capabilities

- Bot WebSocket, Bot Webhook, and Agent encrypted webhook runtime paths.
- Streaming Bot replies with thinking placeholders, status text, footers, and 846608 fallback.
- Flat runtime config under `channels.wecom`, with account overrides under `channels.wecom.accounts.<accountId>`.
- Bot and Agent coexistence in one account: Bot for conversations, Agent for push, Cron, and fallback.
- DM and group access control, multi-account routing, inbound/outbound media handling, MCP tools, and built-in WeCom Skills.

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
      "streaming": {
        "enabled": true,
        "status": true,
        "content": true
      },
      "footer": {
        "status": true,
        "elapsed": true
      },
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

## Mode Selection

| Mode | Connection | Credentials | Best For |
|------|------------|-------------|----------|
| Bot WebSocket | Long-lived WS | `botId` + `secret` | Interactive chat, DM/group messages, streaming replies |
| Bot Webhook | HTTPS callback | `token` + `encodingAESKey` + optional `receiveId` | Environments that cannot keep WS connections |
| Agent app | HTTPS callback + WeCom API | `corpId` + `corpSecret` + `agentId` + `token` + `encodingAESKey` | Proactive sends, Cron, departments, tags, file fallback |
| Dual mode | Bot WS + Agent | Bot credentials plus `agent.*` | Production default |

Recommended callback URLs:

- Bot Webhook: `https://<GATEWAY_HOST>/plugins/wecom/bot/<accountId>`
- Agent Webhook: `https://<GATEWAY_HOST>/plugins/wecom/agent/<accountId>`

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
