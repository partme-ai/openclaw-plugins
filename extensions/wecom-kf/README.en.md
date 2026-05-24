<div align="center">

# OpenClaw WeCom KF

**WeChat Work Customer Service channel plugin for AI reception, human handoff, KF account routing, and event messages**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fwecom--kf-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)

[简体中文](./README.md) | [English](./README.en.md)

</div>

`@partme.ai/wecom-kf` connects WeChat Work Customer Service (微信客服) to OpenClaw. It lets AI Agents handle customer inquiries from official-account, mini-program, video-channel, and other KF entry points, then transfer to human agents when needed.

**Scope**: this plugin is KF-only. It covers callback verification, `sync_msg`, `send_msg`, event messages, servicer list, account list, contact-way links, and session assignment. It does not include WeCom Bot/Agent customer-contact features, account CRUD, knowledge-base management, or statistics APIs.

## Capabilities

- KF-only runtime separated from the `wecom` Bot/Agent plugin.
- Hybrid callback plus `kf/sync_msg` message pulling.
- One `open_kfid` can route to one OpenClaw Agent.
- Control Tools: `wecom_kf_list_servicers`, `wecom_kf_list_accounts`, `wecom_kf_get_account_link`, and `wecom_kf_transfer_session`.
- Human handoff, queueing, session ending, and event-message support.
- Recommended per-account/channel/peer session isolation.
- Optional Agent templates and transfer-to-human skills.

## Install and Update

```bash
openclaw plugins install @partme.ai/wecom-kf
openclaw plugins update @partme.ai/wecom-kf
```

## Quick Start

1. In WeCom admin, create or select a self-built app.
2. Add the app to **WeChat Customer Service - Apps allowed to call APIs**.
3. Authorize at least one KF account to the app.
4. Configure message receiving with:
   - URL: `https://<YOUR_GATEWAY_HOST>/wecom/kefu`
   - Token: same as `channels.wecom-kf.token`
   - EncodingAESKey: same as `channels.wecom-kf.encodingAESKey`

Configure OpenClaw:

```bash
openclaw config set channels.wecom-kf.corpId "<YOUR_CORP_ID>"
openclaw config set channels.wecom-kf.corpSecret "<YOUR_CORP_SECRET>"
openclaw config set channels.wecom-kf.token "<YOUR_CALLBACK_TOKEN>"
openclaw config set channels.wecom-kf.encodingAESKey "<YOUR_43_CHAR_ENCODING_AES_KEY>"
openclaw config set session.dmScope per-account-channel-peer
openclaw gateway restart
openclaw channels status --probe
```

Minimal JSON:

```json
{
  "channels": {
    "wecom-kf": {
      "corpId": "<YOUR_CORP_ID>",
      "corpSecret": "<YOUR_CORP_SECRET>",
      "token": "<YOUR_CALLBACK_TOKEN>",
      "encodingAESKey": "<YOUR_43_CHAR_ENCODING_AES_KEY>"
    }
  },
  "session": {
    "dmScope": "per-account-channel-peer",
    "resetByChannel": {
      "wecom-kf": {
        "mode": "idle",
        "idleMinutes": 2880
      }
    }
  }
}
```

## Agent Binding

```json
{
  "bindings": [
    {
      "channel": "wecom-kf",
      "peer": "kf_presale_001",
      "agent": "presale-agent"
    },
    {
      "channel": "wecom-kf",
      "peer": "kf_support_001",
      "agent": "support-agent"
    }
  ]
}
```

`peer` is usually the KF account `open_kfid`.

## Full Config Example

```json
{
  "channels": {
    "wecom-kf": {
      "corpId": "<YOUR_CORP_ID>",
      "corpSecret": "<YOUR_CORP_SECRET>",
      "token": "<YOUR_CALLBACK_TOKEN>",
      "encodingAESKey": "<YOUR_43_CHAR_ENCODING_AES_KEY>",
      "eventMessages": {
        "welcome": {
          "enabled": true,
          "msgtype": "text",
          "content": {
            "content": "Hello, I am your AI customer service assistant."
          }
        },
        "ending": {
          "enabled": true,
          "msgtype": "text",
          "content": {
            "content": "Thanks for contacting us. Have a great day."
          }
        },
        "satisfaction": {
          "enabled": true,
          "head_content": "Please rate this service",
          "options": [
            { "id": "1", "content": "Satisfied" },
            { "id": "2", "content": "Average" },
            { "id": "3", "content": "Unsatisfied" }
          ]
        }
      },
      "humanTransfer": {
        "enabled": true,
        "keywords": ["human agent", "manual support"],
        "waitTimeout": 300
      }
    }
  }
}
```

Never commit real `corpSecret`, `token`, or `encodingAESKey` values.

## Message and Handoff Flow

```text
Customer message
  → WeCom callback /wecom/kefu
  → signature verification and decryption
  → sync_msg pulls a message batch
  → msgid dedup and cursor persistence
  → open_kfid / bindings route to an Agent
  → Agent response
  → kf/send_msg delivers to the customer
```

Human handoff usually calls `wecom_kf_list_servicers` first, then `wecom_kf_transfer_session`.

## API Coverage and Limits

| Capability | WeCom API | Notes |
|------------|-----------|-------|
| Callback | `/wecom/kefu` | Receives message/event notifications |
| Sync messages | `kf/sync_msg` | Pulls messages within 3 days |
| Send message | `kf/send_msg` | Up to 5 replies within 48h after the customer message |
| Event message | `kf/send_msg_on_event` | Welcome, queue, ending, satisfaction messages |
| Session state | `kf/service_state/get` | Reads current service state |
| Transfer | `kf/service_state/trans` | Transfers, queues, or ends sessions |
| Account list | `kf/account/list` | Discovers KF accounts |
| Servicer list | `kf/servicer/list` | Finds available human agents |
| Contact way | `kf/add_contact_way` | Creates KF account links |

## Verification and Development

```bash
openclaw channels list
openclaw channels status --probe
openclaw plugins doctor
openclaw gateway restart

cd extensions/wecom-kf
pnpm build
pnpm dev
pnpm typecheck
pnpm test
pnpm test:coverage
```

In chat, `/kf-status` returns KF account connection status and online servicer counts.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Callback never fires | App not added to KF API app list or no KF account authorized | Recheck WeCom admin setup |
| Callback verification fails | URL, Token, or EncodingAESKey mismatch | Check Gateway domain, TLS, token, and AES key |
| Callback received but no messages | `sync_msg` token, open_kfid, or cursor issue | Inspect Gateway logs and cursor state |
| Customer receives no reply | 48h window exceeded, 5-message limit, or `send_msg` error | Check WeCom API error code |
| Handoff fails with `95014/95015` | Servicer inactive or not receiving | Use `wecom_kf_list_servicers` first |
| `60030` on servicer API | App visibility does not include the servicer | Adjust WeCom app visibility |
| Context leaks across customers | Session isolation is too broad | Set `session.dmScope=per-account-channel-peer` |

## More Docs

- [Master architecture](../../doc/wecom-kf/OpenClaw-WeCom-KF-Master-Architecture.md)
- [Tools architecture](../../doc/wecom-kf/OpenClaw-WeCom-KF-Tools-Architecture.md)
- [Roadmap](../../doc/wecom-kf/OpenClaw-WeCom-KF-Roadmap.md)
- [Agent templates](./agents/README.md)

## Relationship with `wecom`

| Area | `wecom` | `wecom-kf` |
|------|---------|------------|
| Main scenario | WeCom Bot/Agent and proactive sends | WeChat Customer Service, AI reception, human handoff |
| Callback path | `/plugins/wecom/bot/<accountId>`, `/plugins/wecom/agent/<accountId>` | `/wecom/kefu` |
| Customer source | WeCom internal/customer-contact users and groups | External customers entering via WeChat Customer Service |
| Coexistence | Supported | Supported; use separate self-built apps and callback URLs |

## License

MIT
