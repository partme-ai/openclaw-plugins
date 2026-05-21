<div align="center">

# OpenClaw Redis Stream

**基于 Redis Pub/Sub 频道 + Stream 消费组的 OpenClaw 消息渠道插件**

[![npm version](https://img.shields.io/npm/v/@partme.ai/openclaw-redis-stream)](https://www.npmjs.com/package/@partme.ai/openclaw-redis-stream)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![Redis](https://img.shields.io/badge/redis-%3E%3D7.0-red)](https://redis.io)

</div>

---

[English](./README.md) | [简体中文](./README.zh-CN.md)

---

## 简介

`openclaw-redis-stream` 是一个 OpenClaw 渠道插件，通过 Redis Pub/Sub 频道和 Redis Stream 消费组实现 AI 智能体消息集成。

它使用官方推荐的 [node-redis](https://github.com/redis/node-redis) 客户端，遵循 OpenClaw 的 `defineChannelPluginEntry` 接口。支持多 topic 订阅、显式 topic→agent 绑定，以及基于 dmScope 的会话隔离，与 [openclaw-mqtt](https://github.com/partme-ai/openclaw-plugins/tree/main/openclaw-mqtt)、[openclaw-stomp](https://github.com/partme-ai/openclaw-plugins/tree/main/openclaw-stomp) 和 [openclaw-rabbitmq](https://github.com/partme-ai/openclaw-plugins/tree/main/openclaw-rabbitmq) 保持完全一致。

## 核心能力

- **双传输模式**：Redis Pub/Sub 用于实时消息接收，Redis Stream 消费组用于持久化、可回放的消息处理
- **多 Topic 订阅**：通过 `PSUBSCRIBE` 模式订阅支持 `*` 通配符的多个 Redis channel
- **显式绑定优先**：`channelBindings` 具有最高路由优先级，可将特定 channel 模式映射到指定 Agent
- **标准格式回退**：未匹配的 channel 使用 `openclaw:agent:<agentId>:in` 格式进行自动路由
- **dmScope 会话隔离**：会话键完全基于 OpenClaw 全局 `session.dmScope` 配置生成（`main` / `per-peer` / `per-channel-peer` / `per-account-channel-peer`）
- **JSON + 纯文本负载**：支持原始文本或 `{"text": "..."}` JSON 格式的消息
- **HTTP 健康/状态端点**：提供 `/redis-stream/health` 和 `/redis-stream/status` 监控接口

## 生命周期

1. **Gateway 启动** → 加载插件，注册 `redis-stream` 渠道
2. **账户启动** → 连接 Redis，订阅频道（Pub/Sub 模式）或创建消费组（Stream 模式）
3. **消息接收** → 入站消息经白名单过滤 → 路由解析 → dmScope 会话映射 → Agent 分发
4. **Agent 回复** → 通过 `PUBLISH`（Pub/Sub 模式）或 `XADD`（Stream 模式）发送回复
5. **Gateway 关闭** → 取消订阅，退出 Redis 连接

## 消息处理流程

1. 接收 Redis channel 消息（Pub/Sub `SUBSCRIBE`/`PSUBSCRIBE` 回调）
2. 白名单检查：如果 `subscribeChannels` 非空，仅处理匹配的 channel
3. 路由解析：先查 `channelBindings`（显式匹配），回退到标准 `openclaw:agent:<agentId>:in` 格式
4. 从 OpenClaw 全局配置读取 dmScope（`session.dmScope`）
5. 构建会话键：`agent:<agentId>:<dmScope后缀>`
6. 更新会话上下文（channel、replyChannel、peerId）
7. Agent 分发 → `rt.channel.reply.dispatchReplyFromConfig`
8. 通过 Redis `PUBLISH` 将回复发送到 `replyChannel`

## 快速开始

### 前置要求

- Node.js >= 22
- Redis >= 7.0（需 Pub/Sub 支持）
- OpenClaw Gateway >= 2026.4.0

### 安装

```bash
# 推荐 — ClawHub
openclaw plugins install clawhub:@partme.ai/openclaw-redis-stream

# 过渡期 — npm
openclaw plugins install npm:@partme.ai/openclaw-redis-stream
```

### 最小配置

```jsonc
{
  "channels": {
    "redis-stream": {
      "url": "redis://localhost:6379",
      "channelMode": "pubsub",
      "subscribeChannels": ["openclaw:agent:*:in"],
      "channelBindings": [
        {
          "channelPattern": "sensor:temperature",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyChannel": "sensor:temperature:response"
        }
      ]
    }
  }
}
```

安装后重启 Gateway：`openclaw gateway restart`

### 构建与测试

```bash
npm install
npm run typecheck
npm run build
npm test
```

## Channel 路由规则

| 类型 | 格式 | 说明 |
|------|------|------|
| 标准入站 | `openclaw:agent:<agentId>:in` | 自动检测，无需绑定 |
| 标准出站 | `openclaw:agent:<agentId>:out` | 由入站自动推导 |
| 显式绑定 | 任意 channel 模式（如 `sensor:temperature`） | 在 `channelBindings` 中定义，优先级最高 |

**路由优先级**：`channelBindings` > 标准格式。如果无路由匹配，消息被静默丢弃。

Channel 模式支持 `*` 通配符（glob 风格，以冒号分隔）。独立的 `*` 匹配所有剩余分段。

## 配置参考

### 必填

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `url` | `string` | — | Redis 连接 URL |

### 频道设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `channelMode` | `"pubsub" \| "stream"` | `"pubsub"` | 入站消息传输模式 |
| `defaultAgentId` | `string` | `""` | 无绑定/标准格式匹配时的兜底 Agent ID。空字符串 = 丢弃无法路由的消息 |
| `subscribeChannels` | `string[]` | `[]` | 频道/模式白名单；空数组 = 接受全部 |
| `channelBindings[].channelPattern` | `string` | — | 频道模式（支持 `*` 通配符，匹配剩余所有级别，例如 `openclaw:*` 匹配 `openclaw:a:b:c`） |
| `channelBindings[].agentId` | `string` | — | 目标 Agent ID |
| `channelBindings[].accountId` | `string` | `"default"` | 账户上下文 |
| `channelBindings[].replyChannel` | `string` | — | 回复频道覆盖 |

### 字段映射（stream 模式 JSON 负载）

当 `channelMode` 为 `stream` 时，stream 条目的值按以下字段映射到内部字段。可根据条目格式覆盖相应键名：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `fieldMapping.textField` | `string` | `"text"` | 消息文本对应的条目值键名 |
| `fieldMapping.agentIdField` | `string` | `"agentId"` | 目标 Agent 对应的条目值键名（覆盖频道路由） |
| `fieldMapping.peerIdField` | `string` | `"peerId"` | Peer 标识对应的条目值键名 |
| `fieldMapping.accountIdField` | `string` | `"accountId"` | 账户上下文对应的条目值键名 |
| `fieldMapping.replyStreamField` | `string` | `"replyStream"` | 回复 Stream 名称对应的条目值键名 |

### Stream 设置（channelMode = "stream"）

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `stream.inboundKey` | `string` | `"openclaw:inbound"` | 消费组读取的 stream 键 |
| `stream.outboundKey` | `string` | `"openclaw:outbound"` | 回复写入的 stream 键 |
| `stream.consumerGroup` | `string` | `"openclaw-group"` | 消费者组名称 |
| `stream.consumerName` | `string` | `"openclaw-consumer-1"` | 此实例的消费者名称 |
| `stream.blockMs` | `number` | `5000` | `XREADGROUP` 阻塞超时 |
| `stream.count` | `number` | `10` | 每批次最大消息数 |
| `stream.createGroup` | `boolean` | `true` | 自动创建消费者组 |

### 负载解析

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `payload.mode` | `"plain" \| "jsonTextOrPlain"` | `"jsonTextOrPlain"` | 解析模式 |

### 连接设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `connection.reconnectMs` | `number` | `3000` | 重连延迟（毫秒） |
| `connection.maxRetries` | `number` | `10` | 最大重连次数 |

### 环境变量

| 变量 | 说明 |
|------|------|
| `REDIS_URL` | Redis 连接 URL（覆盖 `channels.redis-stream.url`） |

## 项目结构

```
openclaw-redis-stream/
├── openclaw.plugin.json   # 插件清单
├── package.json           # npm 包元数据
├── tsconfig.json          # TypeScript 配置
├── tsup.config.ts         # 构建配置（tsup）
├── README.md              # English
├── README.zh-CN.md           # 简体中文
└── src/
    ├── index.ts           # 入口：defineChannelPluginEntry + HTTP 路由
    ├── channel.ts         # ChannelPlugin 定义
    ├── types.ts           # 全部 TypeScript 类型
    ├── dm-scope.ts        # dmScope 决议 + 会话键构建
    ├── session-mapper.ts  # 会话映射 + 上下文
    ├── topic-router.ts    # Channel → Agent 路由解析
    ├── inbound.ts         # 入站消息分发
    ├── runtime.ts         # PluginRuntime 单例存储
    ├── redis-stream-config.ts  # 配置解析 + 默认值
    ├── redis-stream-server.ts  # Redis 传输层：Pub/Sub + Stream
    ├── setup-entry.ts     # 轻量级 setup 入口
    ├── openclaw-sdk.d.ts  # Peer dependency 类型桩
    ├── dm-scope.test.ts
    ├── config.test.ts
    ├── topic-router.test.ts
    ├── session-mapper.test.ts
    └── channel.test.ts
```

## 常见问题

**Q: 应该选择 Pub/Sub 还是 Stream？**

A: Pub/Sub 用于实时、即发即忘的消息传递（类似聊天）。Stream 用于需要消费组、消息持久化和回放能力的场景（类似事件溯源）。

**Q: 会话隔离如何工作？**

A: 会话键完全由 OpenClaw 全局 `session.dmScope` 配置生成——无需额外自定义隔离配置。设置 `session.dmScope` 为 `per-peer` 实现每个设备的隔离，或设为 `per-account-channel-peer` 实现完整的多租户。

**Q: 可以同时使用 Pub/Sub 和 Stream 吗？**

A: 目前 `channelMode` 仅选一种入站传输模式。如果有需要，可以运行多个不同模式配置的 Gateway 实例。

**Q: `*` 通配符的匹配规则是什么？**

A: `*` 通配符是**贪婪**的——它会匹配频道名中剩余的所有级别。例如，`openclaw:*` 会匹配 `openclaw:a`、`openclaw:a:b` 和 `openclaw:a:b:c`。这与 Redis PSUBSCRIBE 的 `*` 仅匹配单个片段的行为不同。如果需要精确的单段匹配，请使用不含通配符的准确频道名。

**Q: 是否支持 Redis Cluster？**

A: Pub/Sub 可跨 Redis Cluster 节点工作。Stream 消费组在集群模式下需要谨慎的键路由。Stream 模式推荐使用单实例 Redis。

## 测试

```bash
# 单元测试
npm test

# 运行特定测试
npm test -- -t "dmScope"

# 覆盖率
npx vitest run --coverage
```

测试要求：运行中的 Redis 实例（`localhost:6379`，用于集成测试）。

## GitHub Actions

| 工作流 | 触发 | 用途 |
|--------|------|------|
| `ci.yml` | push, PR | 类型检查、lint、单元测试 |
| `release.yml` | tag push | 发布到 npm registry |

## 安全

- Redis 凭据应通过连接 URL 提供（`redis://user:pass@host:port`）
- 支持通过 `rediss://` URL 方案进行 TLS 加密
- 请勿在配置文件中硬编码凭据——使用环境变量或 OpenClaw SecretRefs
- `subscribeChannels` 作为 topic 级别的 ACL 白名单

## 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Node.js >= 22 |
| Redis 客户端 | [node-redis](https://github.com/redis/node-redis) ^5.12 |
| 构建 | tsup |
| 测试 | Vitest |
| 类型检查 | TypeScript 5.7 |

## 版本信息

| 插件版本 | 推荐 Node 版本 | 最低 OpenClaw 版本 |
|----------|---------------|-------------------|
| 0.2.x | >= 22 | >= 2026.4.0 |
| 0.1.x | >= 22 | >= 2026.4.0 |

## 相关链接

### Redis 资源

| 资源 | URL |
|------|-----|
| Redis 官方文档 | https://redis.io/docs/ |
| node-redis GitHub | https://github.com/redis/node-redis |
| Redis Pub/Sub | https://redis.io/docs/latest/develop/interact/pubsub/ |
| Redis Streams | https://redis.io/docs/latest/develop/data-types/streams/ |

### OpenClaw 文档

| 资源 | URL |
|------|-----|
| 构建插件 | https://docs.openclaw.ai/plugins/building-plugins |
| Channel 插件 SDK | https://docs.openclaw.ai/plugins/sdk-channel-plugins |
| 插件 SDK 概览 | https://docs.openclaw.ai/plugins/sdk-overview |
| 插件清单 | https://docs.openclaw.ai/plugins/manifest |

## 开源协议

MIT

## 致谢

基于 Redis 团队的 [node-redis](https://github.com/redis/node-redis) 构建。会话隔离模式与 OpenClaw 的 [openclaw-mqtt](https://github.com/partme-ai/openclaw-plugins/tree/main/openclaw-mqtt)、[openclaw-stomp](https://github.com/partme-ai/openclaw-plugins/tree/main/openclaw-stomp) 和 [openclaw-rabbitmq](https://github.com/partme-ai/openclaw-plugins/tree/main/openclaw-rabbitmq) 插件对齐。

---

<div align="center">

⭐ **Star us on GitHub** — 你的支持是 PartMe 用爱发电的动力！

</div>
