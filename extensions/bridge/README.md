# OpenClaw Bridge

一个插件，覆盖所有 OpenClaw IM 渠道的 PartMe.AI 生态接入。

## 覆盖渠道（21 个）

### 外部官方插件（需单独安装）

| 平台 | 渠道 ID | 官方仓库 | npm 包 |
|------|---------|---------|--------|
| 钉钉 | `dingtalk-connector` | [DingTalk-Real-AI/dingtalk-openclaw-connector](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector) | `@dingtalk-real-ai/dingtalk-connector` |
| 飞书/Lark | `openclaw-lark` | [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark) | `@larksuite/openclaw-lark` |
| QQ | `qqbot` | [tencent-connect/openclaw-qqbot](https://github.com/tencent-connect/openclaw-qqbot) | `@tencent-connect/openclaw-qqbot` |

> 飞书官方文档: https://bytedance.larkoffice.com/docx/MFK7dDFLFoVlOGxWCv5cTXKmnMh
>
> 钉钉 CLI 工具 dws: https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli

### Bundled 渠道（随 OpenClaw 内置，无需额外安装）

`discord` `slack` `telegram` `whatsapp` `signal` `line` `matrix` `irc` `msteams` `googlechat` `imessage` `mattermost` `nextcloud-talk` `nostr` `zalo` `twitch` `tlon` `synology-chat`

## 功能

| 模块 | 说明 |
|------|------|
| **上下文注入** | 按渠道预设自动注入平台特定的系统上下文（消息格式、工具使用、群聊规则） |
| **消息桥接** | `agent_end` → UnifiedMessage → MQ，配置驱动 |

## 安装

```bash
# 安装适配层（仅此一个）
openclaw plugins install @partme.ai/openclaw-bridge

# 如使用外部官方渠道，需另外安装：
openclaw plugins install @dingtalk-real-ai/dingtalk-connector   # 钉钉
openclaw plugins install @larksuite/openclaw-lark               # 飞书
openclaw plugins install @tencent-connect/openclaw-qqbot        # QQ
```

## 配置

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

### 每渠道配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 是否激活此渠道的 bridge |
| `forwardToMq` | boolean | `true` | 是否转发消息到 MQ |
| `mqChannel` | string | `"mqtt"` | 目标 MQ 渠道 |
| `contextInjection` | boolean | `true` | 是否注入系统上下文 |

### 可用 MQ 渠道

`mqtt` `rabbitmq` `redis-stream` `rocketmq` `stomp` `web-mqtt` `web-stomp`

## 启动

```bash
openclaw gateway restart
```
