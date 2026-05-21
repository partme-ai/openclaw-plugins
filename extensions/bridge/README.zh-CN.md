# OpenClaw Bridge

**OpenClaw 插件 -- 覆盖 21 个 IM 渠道的 PartMe.AI 生态统一接入层**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--bridge-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)

[English](./README.en.md) | [简体中文](./README.md)

---

## 功能特性

| 模块 | 说明 |
|------|------|
| **上下文注入** | 按渠道预设自动注入平台特定的系统上下文（消息格式、工具使用、群聊规则） |
| **消息桥接** | `agent_end` -> UnifiedMessage -> MQ，配置驱动，支持多 MQ 渠道 |

## 覆盖渠道（21 个）

### 外部官方插件（需单独安装）

| 平台 | 渠道 ID | 官方仓库 | npm 包 |
|------|---------|---------|--------|
| 钉钉 | `dingtalk-connector` | [DingTalk-Real-AI/dingtalk-openclaw-connector](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector) | `@dingtalk-real-ai/dingtalk-connector` |
| 飞书/Lark | `openclaw-lark` | [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark) | `@larksuite/openclaw-lark` |
| QQ | `qqbot` | [tencent-connect/openclaw-qqbot](https://github.com/tencent-connect/openclaw-qqbot) | `@tencent-connect/openclaw-qqbot` |

> 飞书官方文档：https://bytedance.larkoffice.com/docx/MFK7dDFLFoVlOGxWCv5cTXKmnMh
>
> 钉钉 CLI 工具 dws：https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli

### Bundled 渠道（随 OpenClaw 内置，无需额外安装）

`discord` `slack` `telegram` `whatsapp` `signal` `line` `matrix` `irc` `msteams` `googlechat` `imessage` `mattermost` `nextcloud-talk` `nostr` `zalo` `twitch` `tlon` `synology-chat`

## 快速开始

### 安装

```bash
# 安装适配层（仅此一个）
openclaw plugins install @partme.ai/openclaw-bridge

# 如使用外部官方渠道，需另外安装：
openclaw plugins install @dingtalk-real-ai/dingtalk-connector   # 钉钉
openclaw plugins install @larksuite/openclaw-lark               # 飞书
openclaw plugins install @tencent-connect/openclaw-qqbot        # QQ
```

### 启动

```bash
openclaw gateway restart
```

## 配置参考

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

### 每渠道配置项

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 是否激活此渠道的 bridge |
| `forwardToMq` | boolean | `true` | 是否转发消息到 MQ |
| `mqChannel` | string | `"mqtt"` | 目标 MQ 渠道 |
| `contextInjection` | boolean | `true` | 是否注入系统上下文 |

### 可用 MQ 渠道

`mqtt` `rabbitmq` `redis-stream` `rocketmq` `stomp` `web-mqtt` `web-stomp`

## 技术架构

本插件作为 OpenClaw 的五层模型中的 Layer 3-4 适配层：

- **Layer 5** -- 业务应用（SCRM、仪表盘、分析）
- **Layer 4** -- Router + Bridge（规则引擎、转发、审计、跨渠道上下文注入）
- **Layer 3** -- OpenClaw Agents
- **Layer 2** -- 能力层（知识库、记忆、追踪、OAuth2）
- **Layer 1** -- 渠道层（IM、MQ）

Bridge 插件的核心职责：

1. **上下文注入**：在 `before_prompt_build` 钩子中，根据渠道类型注入对应的系统提示，包括消息格式说明、工具使用规则、群聊行为约束等
2. **消息桥接**：在 `agent_end` 事件中，将 Agent 回复转换为统一消息格式（UnifiedMessage），并按配置转发到指定 MQ 渠道，实现跨渠道消息分发

## 许可证

MIT
