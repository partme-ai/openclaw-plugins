# OpenClaw RocketMQ

**OpenClaw 插件 — 阿里云 RocketMQ 消息队列通道，支持 Producer + PushConsumer、Topic+Tag 绑定、3 种分发模式、健康检查和 mq.publish 工具**

[![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--rocketmq-blue)](https://www.npmjs.com/package/@partme.ai/openclaw-rocketmq)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

[简体中文](./README.md) | [English](./README.en.md)

---

## 概述

`@partme.ai/openclaw-rocketmq` 将外部 RocketMQ 消息桥接到 OpenClaw Agent，并将 Agent 回复重新发布到 RocketMQ。它使用 `rocketmq-client-nodejs` 实现 Producer 和 PushConsumer，遵循完整的 OpenClaw channel 插件生命周期。

## 特性

- **Producer + PushConsumer** — 完整的 RocketMQ 生产和消费生命周期
- **Topic+Tag 绑定** — 显式的 `topic + tag -> agentId` 路由规则
- **3 种分发模式** — `embedded-agent`（默认）/ `subagent` / `reply-pipeline`
- **载荷解析策略** — `jsonTextOrPlain`（默认）/ `jsonOnly` / `plainText`
- **回退主题** — 标准模式：`openclaw.agent.<agentId>.in[.<peerId>]`
- **回复主题路由** — Agent 回复发布到配置的 `replyTopic` / `replyTag`
- **健康端点** — `/rocketmq/health`、`/rocketmq/stats`、`/rocketmq/status`
- **`mq.publish` 工具** — 调试用消息发布工具
- **会话映射** — 追踪 producer-consumer-conversation 会话映射关系
- **幂等性** — 可选的去重机制，支持配置 TTL
- **设置向导** — 通过 OpenClaw setup wizard 进行交互式配置

## 快速开始

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-rocketmq
```

### 最小配置

```json
{
  "channels": {
    "rocketmq": {
      "endpoints": "127.0.0.1:8081",
      "namespace": "",
      "topicPrefix": "openclaw",
      "producer": {
        "groupId": "openclaw-rocketmq-producer"
      },
      "consumer": {
        "groupId": "openclaw-rocketmq-consumer",
        "subscriptions": [
          { "topic": "device.status", "filterExpression": "*" }
        ]
      },
      "topicBindings": [
        {
          "topic": "device.status",
          "tag": "iot",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyTopic": "device.command",
          "replyTag": "command"
        }
      ],
      "dispatch": {
        "mode": "embedded-agent",
        "timeoutMs": 120000,
        "reply": { "enabled": true }
      }
    }
  }
}
```

## 配置参考

```jsonc
{
  "channels": {
    "rocketmq": {
      "endpoints": "127.0.0.1:8081",           // RocketMQ proxy/namesrv 端点
      "namespace": "",                          // RocketMQ 命名空间
      "topicPrefix": "openclaw",               // 回退主题的前缀
      "sessionCredentials": {                   // 可选：ACL 凭证
        "accessKey": "",
        "accessSecret": "",
        "securityToken": ""
      },
      "producer": {
        "groupId": "openclaw-rocketmq-producer", // Producer 组 ID
        "requestTimeout": 5000                   // 请求超时（毫秒）
      },
      "consumer": {
        "groupId": "openclaw-rocketmq-consumer", // Consumer 组 ID
        "subscriptions": [                       // 订阅的主题列表
          { "topic": "my.topic", "filterExpression": "*" }
        ],
        "maxCacheMessageCount": 1024,
        "maxCacheMessageSizeInBytes": 67108864,
        "longPollingTimeout": 30000,
        "requestTimeout": 3000,
        "reconsumeOnError": true                 // 分发失败时重新消费
      },
      "topicBindings": [                         // Topic 到 Agent 的路由规则
        {
          "topic": "device.status",
          "tag": "iot",
          "agentId": "iot-agent",
          "accountId": "default",
          "peerId": "device-1",                  // 可选：对端标识
          "replyTopic": "device.command",        // 可选：回复主题
          "replyTag": "command"                   // 可选：回复标签
        }
      ],
      "payload": {
        "mode": "jsonTextOrPlain"                // "jsonTextOrPlain" | "jsonOnly" | "plainText"
      },
      "dispatch": {
        "mode": "embedded-agent",                // "embedded-agent" | "subagent" | "reply-pipeline"
        "timeoutMs": 120000,                      // Agent 处理超时
        "reply": { "enabled": true }              // 启用回复消息发布
      },
      "idempotency": {                           // 可选：消息去重
        "enabled": false,
        "ttlMs": 600000,
        "maxEntries": 10000
      }
    }
  }
}
```

### 配置字段

| 字段 | 类型 | 默认值 | 描述 |
|-------|------|---------|-------------|
| `endpoints` | string | `"127.0.0.1:8081"` | RocketMQ proxy/namesrv 端点 |
| `namespace` | string | `""` | RocketMQ 命名空间 |
| `topicPrefix` | string | `"openclaw"` | 回退消息路由的主题前缀 |
| `producer.groupId` | string | `"openclaw-rocketmq-producer"` | Producer 组 ID |
| `producer.requestTimeout` | number | `5000` | Producer 请求超时（毫秒） |
| `consumer.groupId` | string | `"openclaw-rocketmq-consumer"` | Consumer 组 ID |
| `consumer.reconsumeOnError` | boolean | `true` | 分发错误时重新消费消息 |
| `payload.mode` | string | `"jsonTextOrPlain"` | 载荷解析模式 |
| `dispatch.mode` | string | `"embedded-agent"` | Agent 分发模式 |
| `dispatch.timeoutMs` | number | `120000` | Agent 处理超时（毫秒） |

### 分发模式

| 模式 | 描述 |
|------|-------------|
| `embedded-agent` | 消息路由到当前进程内的嵌入 Agent |
| `subagent` | 消息路由到独立的子 Agent 实例 |
| `reply-pipeline` | 消息通过回复管道处理（请求/响应模式） |

### 载荷模式

| 模式 | 描述 |
|------|-------------|
| `jsonTextOrPlain` | 优先解析 JSON 中的 `text` 字段，回退到原始文本 |
| `jsonOnly` | 仅解析 JSON 格式载荷 |
| `plainText` | 将整个载荷视为纯文本 |

## 消息模型

### 入站（RocketMQ -> Agent）

- **显式绑定优先**：根据 `topicBindings[].topic + topicBindings[].tag` 匹配
- **标准回退**：`{topicPrefix}.agent.<agentId>.in[.<peerId>]`
- **载荷解析**：`jsonTextOrPlain` — 优先读取 JSON 的 `text` 字段，否则使用原始文本

### 出站（Agent -> RocketMQ）

- **会话绑定**：使用活跃会话中的 `replyTopic` / `replyTag`
- **标准回退**：`{topicPrefix}.agent.<agentId>.out[.<peerId>]`
- **消费确认**：PushConsumer 通过 `ConsumeResult.SUCCESS` / `FAILURE` 确认

## 健康端点

插件以 "full" 模式注册时可用：

| 端点 | 描述 |
|----------|-------------|
| `GET /rocketmq/health` | 基本健康检查（200 = 正常，503 = 异常） |
| `GET /rocketmq/stats` | 连接统计和会话统计 |
| `GET /rocketmq/status` | 完整状态，包括配置快照和会话映射 |

## mq.publish 工具

用于直接发布消息到 RocketMQ 的调试工具：

```json
{
  "name": "mq.publish",
  "description": "发布消息到 RocketMQ",
  "parameters": {
    "topic": "string（必填）",
    "tag": "string（可选）",
    "payload": "any（必填）",
    "keys": "string[]（可选）"
  }
}
```

## 传输层说明

- 使用 `PushConsumer` — 消息确认通过 `ConsumeResult.SUCCESS` / `FAILURE` 完成
- 重试由 RocketMQ broker/consumer group 机制接管，无需手动维护重试队列
- Request/reply RPC 需要显式配置 `replyTopic` + `replyTag` 绑定（RocketMQ 不像 RabbitMQ 那样原生支持 direct-reply-to）

## 开发

```bash
# 安装依赖
pnpm install

# 构建（tsup -> dist/）
pnpm build

# 类型检查
pnpm typecheck

# 运行测试
pnpm test

# 监听模式
pnpm dev
```

## 许可证

基于 [MIT License](LICENSE) 开源。

## 关于 openclaw-plugins

本项目是 [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) monorepo 的一员 — 由 **PartMe.AI 团队** 研发与二次开发的 OpenClaw 企业级插件集合，包含 30+ 独立插件，覆盖 IM 渠道、消息队列、AI 能力、基础设施四大领域。

每个插件独立发布到 npm（`@partme.ai` scope），可单独安装：

```bash
openclaw plugins install @partme.ai/openclaw-rocketmq
```

**PartMe.AI** 专注于 AI 智能客服与企业级 AI Agent 基础设施，提供从企微/钉钉/飞书/QQ 渠道接入，到 RAG 知识库、多级记忆、监控运维的全栈解决方案。

> 联系我们：partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)
