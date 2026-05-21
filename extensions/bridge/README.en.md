# OpenClaw Bridge

**OpenClaw plugin -- Unified access layer covering 21 IM channels for the PartMe.AI ecosystem**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--bridge-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)

[English](./README.en.md) | [简体中文](./README.md)

---

## Features

| Module | Description |
|--------|-------------|
| **Context Injection** | Automatically injects platform-specific system context per channel (message format, tool usage, group chat rules) |
| **Message Bridge** | `agent_end` -> UnifiedMessage -> MQ, config-driven, supports multiple MQ channels |

## Covered Channels (21)

### External Official Plugins (need separate installation)

| Platform | Channel ID | Official Repository | npm Package |
|----------|------------|--------------------|-------------|
| DingTalk | `dingtalk-connector` | [DingTalk-Real-AI/dingtalk-openclaw-connector](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector) | `@dingtalk-real-ai/dingtalk-connector` |
| Lark/Feishu | `openclaw-lark` | [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark) | `@larksuite/openclaw-lark` |
| QQ Bot | `qqbot` | [tencent-connect/openclaw-qqbot](https://github.com/tencent-connect/openclaw-qqbot) | `@tencent-connect/openclaw-qqbot` |

> Lark docs: https://bytedance.larkoffice.com/docx/MFK7dDFLFoVlOGxWCv5cTXKmnMh
>
> DingTalk CLI tool dws: https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli

### Bundled Channels (built into OpenClaw, no extra installation)

`discord` `slack` `telegram` `whatsapp` `signal` `line` `matrix` `irc` `msteams` `googlechat` `imessage` `mattermost` `nextcloud-talk` `nostr` `zalo` `twitch` `tlon` `synology-chat`

## Quick Start

### Installation

```bash
# Install the bridge layer (only this one)
openclaw plugins install @partme.ai/openclaw-bridge

# If using external official channels, install separately:
openclaw plugins install @dingtalk-real-ai/dingtalk-connector   # DingTalk
openclaw plugins install @larksuite/openclaw-lark               # Lark
openclaw plugins install @tencent-connect/openclaw-qqbot        # QQ
```

### Start

```bash
openclaw gateway restart
```

## Configuration Reference

```json
{
  "plugins": {
    "entries": {
      "openclaw-bridge": {
        "enabled": true,
        "config": {
          "channels": {
            "dingtalk-connector": {
              "enabled": true,
              "forwardToMq": true,
              "mqChannel": "mqtt"
            },
            "openclaw-lark": {
              "enabled": true,
              "forwardToMq": true,
              "mqChannel": "mqtt"
            },
            "qqbot": {
              "enabled": true,
              "forwardToMq": true,
              "mqChannel": "mqtt"
            },
            "discord": {
              "enabled": true,
              "forwardToMq": true
            },
            "slack": {
              "enabled": true
            },
            "telegram": {
              "enabled": true,
              "forwardToMq": true,
              "mqChannel": "rabbitmq"
            }
          }
        }
      }
    }
  }
}
```

### Per-Channel Config Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Whether to activate bridge for this channel |
| `forwardToMq` | boolean | `true` | Whether to forward messages to MQ |
| `mqChannel` | string | `"mqtt"` | Target MQ channel identifier |
| `contextInjection` | boolean | `true` | Whether to inject system context |

### Available MQ Channels

`mqtt` `rabbitmq` `redis-stream` `rocketmq` `stomp` `web-mqtt` `web-stomp`

## Architecture

This plugin serves as the Layer 3-4 adapter in OpenClaw's five-layer model:

- **Layer 5** -- Business Apps (SCRM, dashboards, analytics)
- **Layer 4** -- Router + Bridge (rule engine, forwarding, audit, cross-channel context injection)
- **Layer 3** -- OpenClaw Agents
- **Layer 2** -- Capabilities (knowledge base, memory, tracing, OAuth2)
- **Layer 1** -- Channels (IM, MQ)

Core responsibilities of the Bridge plugin:

1. **Context Injection**: In the `before_prompt_build` hook, injects channel-specific system prompts including message format instructions, tool usage rules, and group chat behavior constraints
2. **Message Bridging**: On the `agent_end` event, converts Agent replies to a unified message format (UnifiedMessage) and forwards to the configured MQ channel for cross-channel message distribution

## License

MIT
