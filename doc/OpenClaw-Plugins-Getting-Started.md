# OpenClaw Plugins — Getting Started

## Installation

Each plugin installs independently:

```bash
# IM Channels
openclaw plugins install @partme.ai/wecom

# DingTalk / Lark / QQ and other upstream channels: use openclaw-bridge, e.g.:
# openclaw plugins install @dingtalk-real-ai/dingtalk-connector

# Infrastructure
openclaw plugins install @partme.ai/openclaw-nacos
openclaw plugins install @partme.ai/openclaw-prometheus

# Message Queues
openclaw plugins install @partme.ai/openclaw-mqtt
```

Restart the Gateway after installation:

```bash
openclaw gateway restart
```

## Configuration

Each plugin has its own configuration guide in the [documentation index](./README.md#plugin-docs). Common pattern:

```json
{
  "channels": {
    "<channel-id>": {
      "enabled": true,
      "dmPolicy": "open",
      "groupPolicy": "open",
      "accounts": {
        "default": { "appId": "...", "appSecret": "..." }
      }
    }
  }
}
```

### Common Fields

| Field | Description | Values |
|-------|------------|--------|
| `enabled` | Master switch | `true` / `false` |
| `dmPolicy` | DM access policy | `open` / `pairing` / `allowlist` / `disabled` |
| `groupPolicy` | Group access policy | `open` / `allowlist` / `disabled` |
| `allowFrom` | DM allowlist | `["user1", "user2"]` |
| `accounts` | Multi-account config | `{ "main": {...}, "support": {...} }` |
| `defaultAccount` | Default account ID | `"main"` |

## Multi-Account

Most plugins support multi-account matrix isolation:

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "ops",
      "accounts": {
        "ops": { "botId": "bot-ops-xxx", "secret": "secret-ops" },
        "sales": { "botId": "bot-sales-xxx", "secret": "secret-sales" }
      }
    }
  }
}
```

Sessions, Agents, and contexts are fully isolated per `accountId`.

## For Developers

Clone and build from source:

```bash
git clone https://github.com/partme-ai/openclaw-plugins.git
cd openclaw-plugins
pnpm install
pnpm build
```

Create a new plugin:

```bash
pnpm new-plugin my-plugin --label "My Plugin" --desc "Description"
```

See [OpenClaw-Plugins-Contributing.md](./OpenClaw-Plugins-Contributing.md) for details.
