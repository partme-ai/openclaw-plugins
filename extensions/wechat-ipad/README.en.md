<div align="center">

# OpenClaw WeChat iPad

**OpenClaw bridge plugin for personal WeChat accounts through an external iPad protocol service**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fwechat--ipad-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)

[简体中文](./README.md) | [English](./README.en.md)

</div>

`@partme.ai/wechat-ipad` is a bridge between an external WeChat iPad protocol service and OpenClaw Agents. The plugin does not implement low-level MMTLS, Protobuf, or 07/08 algorithms. It receives inbound events over WebSocket and sends outbound messages through the protocol service HTTP API.

> Compliance note: the iPad protocol is unofficial and may carry account and compliance risks. Prefer official WeCom APIs for production customer-service scenarios.

## Architecture

```text
WeChat servers
    ↕ MMTLS / Protobuf (handled by the external bridge)
iPad protocol service
    ↕ WebSocket events + HTTP API sends
openclaw_wechat_ipad
    ↕ OpenClaw Runtime message pipeline
OpenClaw Gateway → Agent
```

## Capabilities

- Bridge-only adapter for an external iPad protocol service.
- Inbound text, image, voice, video, link, contact card, location, mini-program, and sticker events.
- Outbound text messages through HTTP API, with extension points for more message types.
- Optional group-message handling with a group wxid whitelist.
- `wxid` to `sessionKey` mapping for direct and group chats.
- Exponential reconnect and status endpoints.

## Install and Update

```bash
openclaw plugins install @partme.ai/wechat-ipad
openclaw plugins update @partme.ai/wechat-ipad
```

## Quick Start

1. Start your external iPad protocol service.
2. Configure OpenClaw:

```bash
openclaw config set channels.wechat-ipad.serviceUrl "ws://127.0.0.1:5555"
openclaw config set channels.wechat-ipad.apiUrl "http://127.0.0.1:5556"
openclaw config set channels.wechat-ipad.reconnect.enabled true
openclaw gateway restart
openclaw channels status --probe
```

Minimal JSON:

```json
{
  "channels": {
    "wechat-ipad": {
      "serviceUrl": "ws://127.0.0.1:5555",
      "apiUrl": "http://127.0.0.1:5556",
      "reconnect": {
        "enabled": true,
        "intervalMs": 5000,
        "maxRetries": 30
      },
      "message": {
        "handleGroup": false,
        "groupWhitelist": [],
        "ignoreself": true
      }
    }
  }
}
```

## Production Config

```json
{
  "channels": {
    "wechat-ipad": {
      "serviceUrl": "ws://wechat-ipad-bridge.internal:5555",
      "apiUrl": "http://wechat-ipad-bridge.internal:5556",
      "auth": {
        "token": "<BRIDGE_SERVICE_TOKEN>"
      },
      "reconnect": {
        "enabled": true,
        "intervalMs": 5000,
        "maxRetries": 0
      },
      "message": {
        "handleGroup": true,
        "groupWhitelist": ["<GROUP_WXID_1>", "<GROUP_WXID_2>"],
        "ignoreself": true
      }
    }
  }
}
```

## Protocol Service Contract

WebSocket event example:

```json
{
  "type": "message",
  "data": {
    "msgId": "<MESSAGE_ID>",
    "fromWxid": "wxid_xxx",
    "toWxid": "wxid_yyy",
    "msgType": 1,
    "content": "hello",
    "createTime": 1709456789,
    "isGroup": false,
    "isSelf": false
  },
  "timestamp": 1709456789000
}
```

HTTP API:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/send` | `POST` | Send a message |
| `/api/status` | `GET` | Get service status |

OpenClaw status endpoints:

- `GET /wechat-ipad/status`
- `GET /wechat-ipad/sessions`

## Verification and Development

```bash
openclaw gateway restart
openclaw channels status --probe
openclaw plugins doctor

cd extensions/wechat-ipad
pnpm install
pnpm dev
pnpm build
pnpm typecheck
pnpm test
pnpm test:coverage
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Cannot connect to bridge | Check `serviceUrl`, bridge process status, and network reachability |
| Receives messages but cannot send | Check `apiUrl`, `auth.token`, and bridge HTTP logs |
| Group messages ignored | Enable `message.handleGroup` and configure `groupWhitelist` |
| Reply goes to the wrong session | Inspect `GET /wechat-ipad/sessions` and bridge wxid stability |
| Frequent reconnects | Check bridge heartbeat, network stability, and reconnect settings |

## License

MIT
