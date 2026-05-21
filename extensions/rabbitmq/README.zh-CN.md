<div align="center">

# OpenClaw RabbitMQ

**OpenClaw 插件：RabbitMQ 通道桥接，支持多智能体异步协作和主题订阅**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--rabbitmq-blue)
![Node](https://img.shields.io/badge/Node.js-20+-green)
![License](https://img.shields.io/badge/License-MIT-green)
![RabbitMQ](https://img.shields.io/badge/RabbitMQ-3.8%2B-orange)

</div>

[English](./README.md) | [简体中文](./README.zh-CN.md)

---

`@partme.ai/openclaw-rabbitmq` 是 OpenClaw 通道插件，用于连接外部 RabbitMQ 服务器并将 RabbitMQ 消息桥接到 OpenClaw 智能体。

## 特性

- **外部 RabbitMQ 服务器** -- 连接到现有的 RabbitMQ 服务器
- **显式路由优先** -- `topicBindings` 比标准主题回退具有更高的优先级
- **标准回退** -- 当没有绑定匹配时，`openclaw.agent.<agentId>.in` 仍然有效
- **回复主题控制** -- 每个绑定可使用 `replyTopicPattern`，否则从入站主题派生
- **会话上下文映射** -- 每个 RabbitMQ 消息记录智能体/账户上下文
- **企业级安全基线** -- RabbitMQ 内置安全功能（TLS、认证、授权）
- **工具** -- `mq.publish` 发布消息，`mq.request` 基于 Direct Reply-to 的 request/reply

### 主题规则

| 类型 | 格式 |
|------|------|
| 标准入站 | `openclaw.agent.<agentId>.in[.<peerId>]` |
| 标准出站 | `openclaw.agent.<agentId>.out[.<peerId>]` |
| 显式映射 | 由 `topicBindings.topicPattern` 配置 |

路由优先级：`topicBindings` → 标准入站解析 → 丢弃

### 通配符支持

- `*` -- 匹配恰好一个词
- `#` -- 匹配零个或多个词
- `+` -- `*` 的别名
- `/` 自动归一化为 `.`

## 前置要求

- OpenClaw `>= 2026.4.0`
- Node.js `20+`
- RabbitMQ 服务器 `>= 3.8`

## 快速开始

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-rabbitmq
```

### 最小配置

```json
{
  "channels": {
    "rabbitmq": {
      "url": "amqp://localhost",
      "exchange": "openclaw",
      "exchangeType": "topic",
      "topicPrefix": "openclaw",
      "subscribeTopics": [
        "devices.*.in",
        "openclaw.agent.*.in.#"
      ],
      "topicBindings": [
        {
          "topicPattern": "devices.*.in",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyTopicPattern": "devices.${peerId}.out"
        }
      ],
      "payload": {
        "mode": "jsonTextOrPlain"
      },
      "dispatch": {
        "mode": "embedded-agent",
        "timeoutMs": 120000,
        "reply": { "enabled": true }
      }
    }
  },
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

## 配置说明

### 连接

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `url` | string | -- | RabbitMQ 服务器 URL（必需） |
| `exchange` | string | `openclaw` | 交换机名称 |
| `exchangeType` | string | `topic` | 交换机类型（topic、direct、fanout） |
| `topicPrefix` | string | `openclaw` | 标准格式的主题前缀 |
| `connection.timeoutMs` | number | 30000 | 连接超时（毫秒） |
| `connection.heartbeatSeconds` | number | 30 | 心跳间隔（秒） |
| `connection.reconnectAttempts` | number | 5 | 重连尝试次数 |
| `connection.reconnectDelayMs` | number | 5000 | 重连延迟（毫秒） |

### 主题

| 字段 | 类型 | 说明 |
|------|------|------|
| `subscribeTopics` | string[] | 要订阅的主题模式列表 |
| `topicBindings` | array | 显式主题到智能体的绑定 |

### 绑定

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `topicPattern` | string | -- | RabbitMQ 主题模式（必需） |
| `agentId` | string | -- | 目标智能体 ID（必需） |
| `accountId` | string | `default` | 账户 ID |
| `replyTopicPattern` | string | -- | 回复主题模式 |

### Payload

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `payload.mode` | string | `jsonTextOrPlain` | 负载解析模式（jsonTextOrPlain、jsonOnly、plainText） |

## 会话隔离（dmScope）

会话键粒度遵循 OpenClaw 全局 `session.dmScope` 配置：

| dmScope | 会话键格式 | 行为 |
|---------|-----------|------|
| `per-peer`（默认） | `agent:<agentId>:direct:<peerId>` | 每个（智能体、对等端）一个会话 |
| `per-channel-peer` | `agent:<agentId>:rabbitmq:direct:<peerId>` | 每个通道 +（智能体、对等端）一个会话 |
| `per-account-channel-peer` | `agent:<agentId>:rabbitmq:<accountId>:direct:<peerId>` | 每个账户 + 通道 +（智能体、对等端）一个会话 |
| `main` | `agent:<agentId>:main` | 每个智能体共享单个会话 |

## 使用示例

### IoT 设备集成

```json
{
  "channels": {
    "rabbitmq": {
      "url": "amqp://localhost",
      "exchange": "openclaw",
      "subscribeTopics": ["devices.*.status"],
      "topicBindings": [
        {
          "topicPattern": "devices.*.status",
          "agentId": "iot-agent",
          "replyTopicPattern": "devices/${peerId}/command"
        }
      ]
    }
  }
}
```

设备发送：`devices/sensor-001/status` → `{"text": "Temperature: 25C"}`

Agent 回复：`devices/sensor-001/command` → `{"text": "Set threshold to 28C"}`

### 多智能体协作

```json
{
  "channels": {
    "rabbitmq": {
      "url": "amqp://localhost",
      "exchange": "openclaw",
      "subscribeTopics": ["openclaw.agent.*/in", "team.*.tasks"],
      "topicBindings": [
        { "topicPattern": "team/frontend/tasks", "agentId": "frontend-agent" },
        { "topicPattern": "team/backend/tasks", "agentId": "backend-agent" }
      ]
    }
  }
}
```

### 系统监控

```json
{
  "channels": {
    "rabbitmq": {
      "url": "amqp://localhost",
      "exchange": "openclaw",
      "subscribeTopics": ["system/alert/*"],
      "topicBindings": [
        { "topicPattern": "system/alert/security", "agentId": "security-agent" },
        { "topicPattern": "system/alert/performance", "agentId": "ops-agent" },
        { "topicPattern": "system/alert/*", "agentId": "admin-agent" }
      ]
    }
  }
}
```

## 消息流程

1. 设备向主题交换机发布 RabbitMQ 消息
2. 插件从订阅的队列接收消息
3. 路由解析：`topicBindings` 优先 → 标准 `openclaw.agent.<agentId>.in` 回退
4. Payload 解析：`JSON.text` → 纯文本回退
5. 分发到 OpenClaw runtime
6. 回复发布到派生或指定的回复主题

## 项目结构

```
openclaw-rabbitmq/
├── src/
│   ├── index.ts                  # 入口
│   ├── channel.ts                # ChannelPlugin
│   ├── rabbitmq-server.ts        # RabbitMQ 连接管理
│   ├── rabbitmq-config.ts        # 配置解析和验证
│   ├── rabbitmq-state.ts         # 状态管理
│   ├── inbound.ts                # 入站消息处理
│   ├── outbound.ts               # ChannelOutboundAdapter
│   ├── topic-router.ts           # 主题路由和通配符匹配
│   ├── session-mapper.ts         # 会话映射
│   ├── dm-scope.ts               # 会话隔离
│   ├── runtime.ts                # 运行时管理
│   └── types.ts                  # 类型定义
├── scripts/
│   └── test-client.ts            # 集成测试客户端
├── openclaw.plugin.json
├── package.json
└── README.md / README.zh-CN.md
```

## 测试

```bash
# 单元测试
npm test

# 集成测试
npm run test:client
```

集成测试环境变量：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `RABBITMQ_URL` | RabbitMQ 服务器 URL | `amqp://localhost` |
| `RABBITMQ_EXCHANGE` | 交换机名称 | `openclaw` |
| `RABBITMQ_TEST_TIMEOUT_MS` | 测试超时 | `20000` |

## 常见问题

**是否需要外部 RabbitMQ 服务器？**

是的，它连接到现有的 RabbitMQ 服务器。

**Payload 如何解析？**

默认模式为 `jsonTextOrPlain`：首先解析 `JSON.text`，否则使用原始文本。

**如何支持多个智能体接收相同的消息？**

使用带有通配符的主题模式并将多个智能体绑定到相同的模式，或使用 fanout 交换机。

**可以使用 TLS 吗？**

是的，使用 `amqps://` URL 方案。

## 相关链接

- [OpenClaw 文档](https://docs.openclaw.ai)
- [RabbitMQ 官方文档](https://www.rabbitmq.com/documentation.html)

## 许可证

本项目采用 [MIT License](LICENSE) 协议。
