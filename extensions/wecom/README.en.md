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

## Important Behavior

- Bot WebSocket wins when `botId` + `secret` exist. Even if `connectionMode` is `webhook`, the runtime starts WS when those credentials are present. For pure Bot Webhook, omit both fields.
- `agent.agentId` is required for proactive sends, Cron, and Agent fallback delivery.
- Bot WebSocket active sends use the raw WeCom `userid`; do not prefix it with `user:`.
- Markdown rendering depends on the outbound path and WeCom client behavior.

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

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `60020 not allow to access from your ip` | WeCom API call from an untrusted egress IP | Add the Gateway IP in WeCom admin or set `channels.wecom.network.egressProxyUrl` |
| `93006 invalid chatid` | Bot WS active send used `user:<id>` | Use raw userid for Bot WS active sends |
| `Kicked by server` | Multiple Gateway instances or duplicate credentials | Keep one active WS connection per Bot account |
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

## More Docs

- [Configuration guide](../../doc/wecom/OpenClaw-WeCom-Configuration.md)
- [Integration checklist](../../doc/wecom/OpenClaw-WeCom-Integration-Checklist.md)
- [Architecture](../../doc/wecom/OpenClaw-WeCom-Architecture.md)
- [Streaming architecture](../../doc/wecom/OpenClaw-WeCom-Streaming-Architecture.md)
- [Testing and debugging](../../doc/wecom/OpenClaw-WeCom-Testing.md)

## License

ISC
