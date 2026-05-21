# @partme.ai/openclaw-router（消息路由引擎）

**OpenClaw 插件 — 企业级跨渠道消息路由，纯配置驱动，支持审计日志**

[![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--router-blue)](https://www.npmjs.com/package/@partme.ai/openclaw-router)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

[简体中文](./README.md) | [English](./README.en.md)

---

## 概述

`@partme.ai/openclaw-router` 是 OpenClaw 的企业级消息路由引擎。它监听 `agent_end` 事件，根据可配置的规则将消息多路分发到多个目标。支持 IM→MQ（转发到消息队列）和 MQ→IM（回复到 IM 渠道）。

**纯配置驱动** — 无需修改任何渠道插件代码。所有路由规则通过 JSON 配置定义。

## 特性

- **agent_end 事件监听** — 自动捕获完成对话
- **规则引擎** — 多条件匹配：`channels`、`direction`、`topic`、`accountId`
- **模板主题** — 支持 `{{channel}}`、`{{direction}}`、`{{account}}` 动态变量
- **IM 到 MQ 转发** — 将用户消息和 Agent 回复转发到 MQ 渠道
- **MQ 到 IM 回复** — 将 Agent 回复路由回指定 IM 渠道和账号
- **审计日志** — 可选的控制台审计追踪
- **纯配置驱动** — 无需修改渠道插件代码
- **轻量级** — 零外部依赖，单一事件处理器

## 快速开始

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-router
```

### 最小配置

```json
{
  "plugins": {
    "entries": {
      "router": {
        "enabled": true,
        "config": {
          "rules": [
            {
              "id": "wecom-to-mqtt",
              "match": { "channels": ["wecom"], "direction": "both" },
              "actions": [
                { "type": "forward", "target": "mqtt", "topic": "openclaw/audit/wecom" }
              ]
            }
          ]
        }
      }
    }
  }
}
```

## 配置参考

```jsonc
{
  "plugins": {
    "entries": {
      "router": {
        "enabled": true,
        "config": {
          "rules": [
            {
              "id": "wecom-inbound-to-rabbitmq",
              "match": {
                "channels": ["wecom"],            // 来源渠道过滤
                "direction": "inbound",           // "inbound" | "outbound" | "both"
                "topic": "support",               // 主题过滤（可选）
                "accountId": "account_001"        // 账号过滤（可选）
              },
              "actions": [
                {
                  "type": "forward",             // 转发到 MQ 渠道
                  "target": "rabbitmq",
                  "topic": "openclaw/router/{{channel}}/{{direction}}"  // 模板主题
                }
              ]
            },
            {
              "id": "agent-reply-to-wecom",
              "match": {
                "channels": ["mqtt"],
                "direction": "outbound"
              },
              "actions": [
                {
                  "type": "reply-via",           // 回复到 IM 渠道
                  "target": "wecom",
                  "accountId": "default"
                }
              ]
            }
          ],
          "audit": {
            "enabled": true,
            "logToConsole": true                 // 将路由动作记录到控制台
          }
        }
      }
    }
  }
}
```

### 规则匹配字段

| 字段 | 类型 | 描述 |
|-------|------|-------------|
| `channels` | string[] | 按来源渠道 ID 过滤（如 `["wecom", "dingtalk"]`）。为空/缺失表示匹配所有渠道。 |
| `direction` | "inbound" \| "outbound" \| "both" | 消息方向。`inbound` = 用户消息，`outbound` = Agent 回复。 |
| `topic` | string | 按事件主题过滤。精确匹配。 |
| `accountId` | string | 按 Agent 账号 ID 过滤。 |

### 动作类型

| 动作 | 类型值 | 描述 |
|--------|------|-------------|
| 转发 | `"forward"` | 将消息副本转发到目标 MQ 渠道。主题支持模板变量 `{{channel}}`、`{{direction}}`、`{{account}}`。 |
| 回回复 | `"reply-via"` | 通过指定 IM 渠道回复消息。需要 `target` 参数，可选 `accountId` 和 `to`。 |

### 主题模板变量

| 变量 | 描述 |
|----------|-------------|
| `{{channel}}` | 来源渠道 ID（如 `wecom`） |
| `{{direction}}` | 消息方向（`inbound` / `outbound`） |
| `{{account}}` | Agent 账号 ID（或 `default`） |

默认主题：
- 入站：`openclaw/router/{channel}/inbound`
- 出站：`openclaw/router/{channel}/outbound`

### 审计配置

| 字段 | 类型 | 默认值 | 描述 |
|-------|------|---------|-------------|
| `audit.enabled` | boolean | `false` | 启用审计日志 |
| `audit.logToConsole` | boolean | `false` | 将路由动作记录到控制台 |

## 架构

```
                    ┌─────────────────────────────────────┐
                    │          OpenClaw 运行时             │
                    │                                      │
  用户 ──► IM 渠道 ──► Agent ──► agent_end 事件           │
                    │         │                            │
                    │         ▼                            │
                    │    ┌──────────┐                      │
                    │    │  Router  │                      │
                    │    │ (规则)    │                      │
                    │    └────┬─────┘                      │
                    │         │                            │
                    │    ┌────┴─────┐                      │
                    │    │    |     │                      │
                    │    ▼    ▼     ▼                      │
                    │  MQ_A  MQ_B  回复到渠道              │
                    └─────────────────────────────────────┘
```

## 使用场景

- **审计追踪**：将所有企微对话转发到 RabbitMQ/MQTT 审计队列
- **多渠道广播**：将 Agent 回复同时发送到多个消息渠道
- **外部处理**：将消息路由到外部系统进行 NLP、情感分析或数据增强
- **跨渠道回复**：收到 MQTT 消息，由 Agent 处理后通过企微回复

## 注意事项

- 知识库（RAG）和长期记忆的自动注入由 OpenClaw 核心框架和 `openclaw-memory` 插件分别处理，router 不参与。
- Router 需要目标 MQ 渠道（mqtt、rabbitmq、redis-stream 等）已安装并配置。
- 主题模板变量在运行时根据实际事件上下文替换。

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 运行测试
pnpm test

# 监听模式
pnpm dev

# 类型检查
pnpm typecheck
```

## 许可证

基于 [MIT License](LICENSE) 开源。

## 关于 openclaw-plugins

本项目是 [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) monorepo 的一员 — 由 **PartMe.AI 团队** 研发与二次开发的 OpenClaw 企业级插件集合，包含 30+ 独立插件，覆盖 IM 渠道、消息队列、AI 能力、基础设施四大领域。

每个插件独立发布到 npm（`@partme.ai` scope），可单独安装：

```bash
openclaw plugins install @partme.ai/openclaw-router
```

**PartMe.AI** 专注于 AI 智能客服与企业级 AI Agent 基础设施，提供从企微/钉钉/飞书/QQ 渠道接入，到 RAG 知识库、多级记忆、监控运维的全栈解决方案。

> 联系我们：partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)
