<div align="center">

# OpenClaw RabbitMQ

**OpenClaw 插件 — RabbitMQ 通道桥接，支持多智能体异步协作和主题订阅**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--rabbitmq-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

[English](./README.md) | [简体中文](./README.zh-CN.md)

## 📖 简介

`@partme.ai/openclaw-rabbitmq` 是一个 OpenClaw 通道插件，用于连接外部 RabbitMQ 服务器并将 RabbitMQ 消息桥接到 OpenClaw 智能体。该插件使用 OpenClaw 通道插件指南中的 [`defineChannelPluginEntry`](https://docs.openclaw.ai/plugins/sdk-entrypoints#definechannelpluginentry) / `ChannelPlugin`（不是用于非通道插件的 `definePluginEntry`）。它支持：

- 显式 `topicPattern -> agentId` 绑定
- 多主题订阅（`subscribeTopics`）
- RabbitMQ 主题交换机，支持通配符匹配（`*` 和 `#`）
- 入站消息负载解析策略（优先 JSON.text，回退纯文本）
- 通过 RabbitMQ 主题路由进行运行时回复分发
- 遵循 OpenClaw `session.dmScope` 的会话隔离

## 🎯 核心功能

- **外部 RabbitMQ 服务器**：连接到现有的 RabbitMQ 服务器
- **显式路由优先**：`topicBindings` 比标准主题回退具有更高的优先级
- **标准回退**：当没有绑定匹配时，`openclaw.agent.<agentId>.in` 仍然有效
- **回复主题控制**：每个绑定可使用 `replyTopicPattern`，否则从入站主题派生
- **会话上下文映射**：每个 RabbitMQ 消息记录智能体/账户上下文
- **企业级安全基线**：使用 RabbitMQ 的内置安全功能（TLS、认证、授权）

### 插件生命周期

- 当网关为 RabbitMQ 通道运行 `gateway.startAccount` 时，RabbitMQ 连接启动（本版本中为单个账户 `default`）。
- HTTP 路由在 `registerFull` 中注册（插件认证）：
  - `GET /rabbitmq/health` - 就绪状态 + 最近错误
  - `GET /rabbitmq/stats` - 统计信息 + 会话计数
  - `GET /rabbitmq/status` - 统计信息 + 活动配置快照
- 会话键范围遵循 OpenClaw 全局 `session.dmScope`（例如 `per-channel-peer`），而不是通道本地的 `channels.rabbitmq.session.dmScope`。
- 如果存在 `channels.rabbitmq.session.dmScope`，插件会记录警告并忽略它。

### 工具

- `mq.publish` - 发布消息到配置的 exchange
- `mq.request` - 基于 Direct Reply-to 的 request/reply（队列 RPC）

## 🏗️ 消息流程

### 运行架构

```mermaid
flowchart LR
    P["业务生产者 / IoT 设备"] -->|"publish routing key"| EX["RabbitMQ Topic Exchange"]
    EX --> Q["主队列<br/>durable / quorum 可选"]
    Q --> C["RabbitMQ 插件消费器<br/>prefetch + concurrency"]
    C --> R["Topic 路由与会话映射"]
    R --> A["OpenClaw Runtime / Agent"]
    A --> PC["ConfirmChannel<br/>mandatory + persistent"]
    PC -->|"Agent 回复"| EX

    C -->|"处理失败"| RX["Retry Exchange"]
    RX --> RQ["Retry Queue<br/>TTL 延迟"]
    RQ -->|"TTL 到期，经 DLX 回流"| EX
    C -->|"重试耗尽"| DX["Dead-letter Exchange"]
    DX --> DQ["DLQ<br/>人工检查 / 补偿"]
```

这里的关键边界是：RabbitMQ 的“消费确认”和 OpenClaw 的“Agent 已处理”不是同一件事。
插件只有在 Agent 分发成功，并且启用回复时回复也已被 Broker 确认路由后，才 ACK 原消息。
Publisher Confirm 只证明 Broker 接收了发布，`mandatory` 进一步保证消息确实命中了队列；两者缺一
都会产生“看似成功、实际丢回复”的假成功。

### 单条消息的 ACK 时序

```mermaid
sequenceDiagram
    autonumber
    participant B as RabbitMQ Broker
    participant P as RabbitMQ 插件
    participant A as OpenClaw Agent
    B->>P: basic.deliver（未 ACK）
    P->>P: 白名单、路由、载荷与幂等检查
    P->>A: dispatchChannelMessage
    A-->>P: Agent 回复
    P->>B: basic.publish（persistent + mandatory）
    alt 回复可路由且 Broker confirm
        B-->>P: basic.ack（publisher confirm）
        P->>B: basic.ack（确认原入站消息）
    else basic.return / publish nack / 超时 / Agent 失败
        P->>B: confirm-publish 到 retry exchange
        B-->>P: publisher confirm
        P->>B: basic.ack（原消息由 retry 链路接管）
    else 重试次数耗尽
        P->>B: confirm-publish 到 dead-letter exchange
        B-->>P: publisher confirm
        P->>B: basic.ack（原消息由 DLQ 接管）
    end
```

### 停机时未决投递

```mermaid
sequenceDiagram
    participant G as Gateway stop
    participant C as RabbitMQ Consumer
    participant B as Broker
    participant A as 运行中的 Agent Turn
    G->>C: 标记 stopping
    G->>B: basic.cancel(consumerTag)
    Note over C,B: cancel 生效前到达的新 delivery 立即 NACK(requeue=true)
    G->>C: 遍历 pending deliveries
    C->>B: NACK(requeue=true, reason=server_stop)
    G->>C: 关闭 consume/publish channel 与 connection
    A-->>C: 若稍后结束，delivery 已 settled，不会重复 ACK
```

停机顺序先阻止新消费，再重新入队已跟踪投递；这避免“先清 pending、cancel 前又收到新消息”形成未跟踪的 Agent Turn。

1. 设备向主题交换机发布 RabbitMQ 消息。
2. 插件从订阅的队列接收消息。
3. 插件解析路由：
   - 首先：`topicBindings`
   - 回退：标准 `openclaw.agent.<agentId>.in`
4. 插件解析负载（`JSON.text` -> 纯文本回退）。
5. 插件将消息分发到 OpenClaw 运行时。
6. 回复被发布到派生的主题模式。

## 🚀 快速开始

### 先决条件

- OpenClaw `>= 2026.7.1`
- Node.js `22+`
- RabbitMQ 服务器 `>= 3.8`

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-rabbitmq
```

最低依赖：`@partme.ai/openclaw-message-sdk >= 2026.5.22`。

### message-sdk 复用

| message-sdk 模块 | rabbitmq 挂载点 | 用途 |
|------------------|-----------------|------|
| `bridge`（`normalizeWireIngress`、`dispatchChannelMessage`） | `src/inbound.ts` | Wire 入站 + 三 mode 派发 |
| `dedup` + `util/getGlobalSingleton` | `src/shared/wire-helpers.ts` | 可配置幂等缓存、`mapRabbitmqWirePayloadMode` |
| `config/resolveChannelAgentReplyTimeoutMs` | `src/config/resolvers.ts` | embedded/subagent 派发超时 |
| `openclaw/plugin-sdk`（`chunkText`、`sanitizeForPlainText`） | `src/outbound.ts` | 出站分块（已移除本地 `text-chunking.ts`） |

### 最小配置（`openclaw.json`）

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

### 高级配置（`openclaw.json`）

```json
{
  "channels": {
    "rabbitmq": {
      "url": "amqps://user:password@rabbitmq.example.com:5671",
      "exchange": "openclaw",
      "exchangeType": "topic",
      "topicPrefix": "openclaw",
      "subscribeTopics": [
        "devices.*.in",
        "sensors.*.data",
        "openclaw.agent.*.in.#"
      ],
      "topicBindings": [
        {
          "topicPattern": "devices.*.in",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyTopicPattern": "devices.${peerId}.out"
        },
        {
          "topicPattern": "sensors.*.data",
          "agentId": "sensor-agent",
          "accountId": "default",
          "replyTopicPattern": "sensors.${peerId}.response"
        },
        {
          "topicPattern": "openclaw.agent.admin.in.#",
          "agentId": "admin-agent",
          "accountId": "admin",
          "replyTopicPattern": "openclaw.agent.admin.out"
        }
      ],
      "payload": {
        "mode": "jsonTextOrPlain"
      },
      "queue": {
        "name": "openclaw.rabbitmq",
        "durable": true
      },
      "retry": {
        "enabled": true,
        "delayMs": 5000,
        "maxAttempts": 5,
        "queueSuffix": ".retry",
        "deadLetterSuffix": ".dlq"
      },
      "connection": {
        "allowInsecureRemote": false,
        "timeoutMs": 30000,
        "heartbeatSeconds": 30,
        "reconnectAttempts": 5,
        "reconnectDelayMs": 5000,
        "reconnectMaxDelayMs": 60000,
        "reconnectJitterRatio": 0.2,
        "publishConfirmTimeoutMs": 10000
      },
      "consume": {
        "prefetch": 50,
        "concurrency": 4,
        "requeueOnError": false
      },
      "idempotency": {
        "enabled": true
      }
    }
  },
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

## 🧭 主题规则

### 主题格式

- 标准入站：`openclaw.agent.<agentId>.in[.<peerId>]`
- 标准出站：`openclaw.agent.<agentId>.out[.<peerId>]`
- 显式映射：由 `topicBindings.topicPattern` 配置

### 通配符支持

RabbitMQ 主题交换机支持通配符：

- `*` - 匹配恰好一个词
- `#` - 匹配零个或多个词
插件也将 `+` 视为 `*` 的别名，并会将 `/` 归一化为 `.` 以兼容旧配置，但推荐使用 `.` + `*`/`#`。

### 优先级

1. `topicBindings` 匹配（显式路由）
2. 标准入站解析（回退）
3. 当两者都不匹配时丢弃消息

## 🔐 会话隔离（dmScope）

会话键粒度遵循 OpenClaw 全局 `session.dmScope` 配置。无需也不使用通道本地的 `channels.rabbitmq.session.dmScope`。

| dmScope | 会话键格式 | 行为 |
|---------|-----------|------|
| `per-peer`（默认） | `agent:<agentId>:direct:<peerId>` | 每个（智能体、对等端）对一个会话 |
| `per-channel-peer` | `agent:<agentId>:rabbitmq:direct:<peerId>` | 每个通道 +（智能体、对等端）一个会话 |
| `per-account-channel-peer` | `agent:<agentId>:rabbitmq:<accountId>:direct:<peerId>` | 每个账户 + 通道 +（智能体、对等端）一个会话 |
| `main` | `agent:<agentId>:main` | 每个智能体共享单个会话 |

在 `openclaw.json` 中配置：

```json
{
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

## 🔧 配置参考

### 连接

| 字段                             | 类型     | 默认值        | 描述                           |
| ------------------------------ | ------ | ---------- | ---------------------------- |
| `url`                          | string | -          | RabbitMQ 服务器 URL（必需）         |
| `exchange`                     | string | `openclaw` | 交换机名称                        |
| `exchangeType`                 | string | `topic`    | 交换机类型（topic, direct, fanout） |
| `topicPrefix`                  | string | `openclaw` | 标准格式的主题前缀                    |
| `connection.timeoutMs`         | number | 30000      | 连接超时（毫秒）                     |
| `connection.heartbeatSeconds`  | number | 30         | 心跳间隔（秒）                      |
| `connection.allowInsecureRemote` | boolean | false | 是否允许远程地址使用明文 `amqp://`；生产环境应保持 false |
| `connection.reconnectAttempts` | number | 5          | 单轮连接重试次数；断线恢复会继续开启下一轮 |
| `connection.reconnectDelayMs`  | number | 5000       | 指数退避基础延迟（毫秒）             |
| `connection.reconnectMaxDelayMs` | number | 60000    | 指数退避最大延迟（毫秒）             |
| `connection.reconnectJitterRatio` | number | 0.2     | 双向随机抖动比例，降低多实例惊群      |
| `connection.publishConfirmTimeoutMs` | number | 10000 | Publisher Confirm 等待上限（毫秒） |

### 主题

| 字段                | 类型        | 描述          |
| ----------------- | --------- | ----------- |
| `subscribeTopics` | string\[] | 要订阅的主题模式列表  |
| `topicBindings`   | array     | 显式主题到智能体的绑定 |

### 主题绑定

| 字段                  | 类型     | 默认值       | 描述                                            |
| ------------------- | ------ | --------- | --------------------------------------------- |
| `topicPattern`      | string | -         | RabbitMQ 主题模式（必需）                             |
| `agentId`           | string | -         | 目标智能体 ID（必需）                                  |
| `accountId`         | string | `default` | 账户 ID                                         |
| `replyTopicPattern` | string | -         | 回复主题模式（支持 ${agentId}, ${peerId}, ${rest} 占位符） |

### 负载

| 字段             | 类型     | 默认值               | 描述                                           |
| -------------- | ------ | ----------------- | -------------------------------------------- |
| `payload.mode` | string | `jsonTextOrPlain` | 负载解析模式（jsonTextOrPlain, jsonOnly, plainText） |

## 🧪 测试

### 单元测试

```bash
npm test
```

### 集成测试客户端

```bash
npm run test:client
```

`scripts/test-client.ts` 将：

- 连接到 RabbitMQ 服务器（默认 `amqp://localhost`）
- 订阅已配置的主题
- 发布 JSON 负载和纯文本负载
- 接收并显示回复
- 当没有收到回复时超时失败

### 环境变量

| 变量                               | 描述               | 默认值                                                                                                                                                                                                                       |
| -------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RABBITMQ_URL`                   | RabbitMQ 服务器 URL | `amqp://localhost`                                                                                                                                                                                                        |
| `RABBITMQ_EXCHANGE`              | 交换机名称            | `openclaw`                                                                                                                                                                                                                |
| `RABBITMQ_EXCHANGE_TYPE`         | 交换机类型            | `topic`                                                                                                                                                                                                                   |
| `RABBITMQ_TOPIC_PREFIX`          | 主题前缀             | `openclaw`                                                                                                                                                                                                                |
| `RABBITMQ_AGENT_ID`              | 测试智能体 ID         | `support-bot`                                                                                                                                                                                                             |
| `RABBITMQ_PEER_ID`               | 测试对等 ID          | `test-peer`                                                                                                                                                                                                               |
| `RABBITMQ_TEST_SUBSCRIBE_TOPICS` | 逗号分隔的订阅主题        | `openclaw.agent.support-bot.out.test-peer,openclaw.#`                                                                                                                                                                     |
| `RABBITMQ_TEST_PUBLISH_CASES`    | JSON 格式的发布案例数组   | `[{"routingKey": "openclaw.agent.support-bot.in.test-peer", "payload": "{\"text\": \"hello from json.text test\"}"}, {"routingKey": "openclaw.agent.support-bot.in.test-peer", "payload": "hello from plain text test"}]` |
| `RABBITMQ_TEST_TIMEOUT_MS`       | 测试超时             | `20000`                                                                                                                                                                                                                   |

## 🤖 GitHub Actions

| 工作流                             | 触发器                         | 目的                       |
| ------------------------------- | --------------------------- | ------------------------ |
| `.github/workflows/ci.yml`      | 推送到 `main` 或 `develop` / PR | 安装、类型检查、构建、测试、上传 `dist/` |
| `.github/workflows/release.yml` | 标签 `v*` / 手动触发              | 构建、测试、发布 npm 包           |

## 📦 发布

- 包名：`@partme.ai/openclaw-rabbitmq`
- 所需密钥：`NPM_TOKEN`

标签发布示例：

```bash
npm version patch
git push origin main --follow-tags
```

## 📁 项目结构

```text
openclaw-rabbitmq/
├── src/
│   ├── index.ts              # defineChannelPluginEntry + registerFull (HTTP)
│   ├── channel.ts            # ChannelPlugin
│   ├── rabbitmq-server.ts    # RabbitMQ 连接管理
│   ├── rabbitmq-config.ts    # 配置解析和验证
│   ├── rabbitmq-state.ts     # 状态管理
│   ├── inbound.ts            # 处理入站消息
│   ├── outbound.ts           # ChannelOutboundAdapter
│   ├── topic-router.ts       # 主题路由和通配符匹配
│   ├── session-mapper.ts     # 会话映射和上下文
│   ├── dm-scope.ts           # 会话隔离（dmScope）
│   ├── runtime.ts            # 运行时管理
│   └── types.ts              # 类型定义
├── scripts/
│   └── test-client.ts        # 集成测试客户端
├── .github/
│   └── workflows/
│       ├── ci.yml            # CI 工作流
│       └── release.yml       # 发布工作流
├── openclaw.plugin.json
├── package.json
└── README.md / README.zh-CN.md
```

## 📚 使用示例

### 示例 1：IoT 设备集成

**配置：**

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

**设备发送状态：**

```javascript
// 主题：devices/sensor-001/status
// 负载：{"text": "Temperature: 25°C, Humidity: 60%"}
```

**智能体回复命令：**

```javascript
// 主题：devices/sensor-001/command
// 负载：{"text": "Set temperature threshold to 28°C"}
```

### 示例 2：多智能体协作

**配置：**

```json
{
  "channels": {
    "rabbitmq": {
      "url": "amqp://localhost",
      "exchange": "openclaw",
      "subscribeTopics": [
        "openclaw.agent.*/in",
        "team.*.tasks"
      ],
      "topicBindings": [
        {
          "topicPattern": "team/frontend/tasks",
          "agentId": "frontend-agent"
        },
        {
          "topicPattern": "team/backend/tasks",
          "agentId": "backend-agent"
        }
      ]
    }
  }
}
```

**团队领导发送任务：**

```javascript
// 主题：team/frontend/tasks
// 负载：{"text": "Implement login page UI"}
```

**前端智能体回复：**

```javascript
// 主题：openclaw.agent.team-leader.in
// 负载：{"text": "Login page UI implementation started"}
```

### 示例 3：系统监控

**配置：**

```json
{
  "channels": {
    "rabbitmq": {
      "url": "amqp://localhost",
      "exchange": "openclaw",
      "subscribeTopics": ["system/alert/*"],
      "topicBindings": [
        {
          "topicPattern": "system/alert/security",
          "agentId": "security-agent"
        },
        {
          "topicPattern": "system/alert/performance",
          "agentId": "ops-agent"
        },
        {
          "topicPattern": "system/alert/*",
          "agentId": "admin-agent"
        }
      ]
    }
  }
}
```

**监控系统发送警报：**

```javascript
// 主题：system/alert/security
// 负载：{"text": "Unauthorized access detected"}
```

**安全智能体接收并处理警报**

## OpenClaw 文档

有关插件、SDK 和此通道构建块的官方文档：

### 插件

- [工具 — 插件](https://docs.openclaw.ai/tools/plugin)
- [社区插件](https://docs.openclaw.ai/plugins/community)
- [捆绑包](https://docs.openclaw.ai/plugins/bundles)
- [语音通话](https://docs.openclaw.ai/plugins/voice-call)

### 构建插件

- [构建插件](https://docs.openclaw.ai/plugins/building-plugins)
- [SDK — 通道插件](https://docs.openclaw.ai/plugins/sdk-channel-plugins)（此包是一个 **通道** 插件）
- [SDK — 提供者插件](https://docs.openclaw.ai/plugins/sdk-provider-plugins)
- [SDK — 迁移](https://docs.openclaw.ai/plugins/sdk-migration)

### SDK 参考

- [SDK 概述](https://docs.openclaw.ai/plugins/sdk-overview)
- [SDK 入口点](https://docs.openclaw.ai/plugins/sdk-entrypoints)（`defineChannelPluginEntry`、`registerFull` 等）
- [SDK 运行时](https://docs.openclaw.ai/plugins/sdk-runtime)
- [SDK 设置](https://docs.openclaw.ai/plugins/sdk-setup)
- [SDK 测试](https://docs.openclaw.ai/plugins/sdk-testing)
- [清单](https://docs.openclaw.ai/plugins/manifest)（`openclaw.plugin.json`、`package.json` `openclaw` 字段）
- [架构](https://docs.openclaw.ai/plugins/architecture)

## 企业级可靠性

> 完整矩阵、生产配置与检查清单：[队列可靠性指南](../../doc/OpenClaw-Queue-Reliability-Guide.md)

| 项 | 行为 |
|----|------|
| **分级** | 可企业试点 |
| **入站 ACK** | 延迟 ACK：dispatch 和回复发布完成后 ACK；失败进入已确认的重试/DLQ 链路 |
| **出站** | 持久消息 + Publisher Confirm；同时处理 channel drain 背压与 confirm 超时 |
| **重试** | 独立 `<exchange>.retry` + TTL；超过 `maxAttempts` 后进入 `<exchange>.dlx` / `<queue>.dlq` |
| **停止** | 停止或重连时未完成投递统一 `requeue=true`，避免进程内丢失 |
| **幂等** | 默认开启，仅对稳定 `correlationId` / `messageId` 生效；claim 成功后提交、失败释放 |
| **隔离** | `subscribeTopics` 勿包含 `*.out` reply 模式 |

默认队列名 `openclaw.rabbitmq` 让多个 Gateway 实例形成 competing consumers；如果每个实例都必须收到一份消息，应为实例配置不同队列名。当前幂等缓存是进程内缓存，无法提供跨实例 exactly-once；关键业务仍应在业务侧或共享存储中实现幂等键。

公共 Channel 出站在缺少 peer/session 映射时会抛错，使 Router Outbox 可以重试或进入 DLQ；不会返回 `no-peer` 一类占位 messageId 冒充 Broker 已确认。

## ❓ 常见问题

### 此插件是否需要外部 RabbitMQ 服务器？

是的。它连接到现有的 RabbitMQ 服务器。

### 负载如何解析？

默认模式为 `jsonTextOrPlain`：首先解析 `JSON.text`，否则使用原始文本。

### 如何将一个主题绑定到一个智能体？

使用带有 `topicPattern` 和 `agentId` 的 `topicBindings`；可选择设置 `replyTopicPattern`。

### 如何支持多个智能体接收相同的消息？

使用带有通配符的主题模式并将多个智能体绑定到相同的模式，或使用 fanout 交换机。

### 会话隔离如何工作？

会话键范围遵循 OpenClaw 全局 `session.dmScope`（例如 `per-channel-peer`），确保消息在正确的会话上下文中处理。

### 我可以使用 TLS 进行 RabbitMQ 连接吗？

是的，使用 `amqps://` URL 方案并配置 RabbitMQ 服务器使用 TLS。

## 📄 许可证

MIT

## 消息格式指南

RabbitMQ 使用共享的 OpenClaw 队列 wire 契约完成入站解析与回复序列化。标准 `MessageEnvelope`、非标准消息归一化、`payload.outboundFormat` 与多语言 SDK 适配说明见 [OpenClaw 队列消息格式指南](../../doc/OpenClaw-Queue-Message-Format-Guide.md)。
