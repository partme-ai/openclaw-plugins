# OpenClaw-Redis-Stream 架构设计文档（渠道插件版）

> **OpenClaw-Redis-Stream = OpenClaw 生态的 Redis 消息渠道适配器。**
> 它遵循 OpenClaw 插件规范与通道契约，将 Redis Pub/Sub 和 Stream 消费组接入 OpenClaw 的统一消息平面，
> 实现**实时消息收发、持久化消费组、多 Topic 路由与会话隔离**。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](#)
[![OpenClaw Plugin](https://img.shields.io/badge/OpenClaw-Plugin_2026.5.18-green.svg)](#)
[![Redis](https://img.shields.io/badge/Redis-%3E%3D7.0-red.svg)](#)
[![Node](https://img.shields.io/badge/Node-%3E%3D22-brightgreen.svg)](#)

---

**文档约定**：本文以 OpenClaw 插件 SDK 为基线，定义 `openclaw-redis-stream` 的架构设计、模块划分、
消息路由与会话隔离机制。「插件」即指 `openclaw-redis-stream`；默认运行环境为 Node.js / TypeScript，
插件宿主为 OpenClaw Gateway。

**同步原则**：
- 与 OpenClaw 插件规范（`openclaw/plugin-sdk`）保持同一套生命周期与能力注册模型；
- 必须实现 `ChannelPlugin` 完整接口，覆盖出站发送、入站监听、配置校验与生命周期钩子；
- 全部使用 node-redis v5 高级 API，零裸 `sendCommand` 调用。

---

## 目录

### Part I：定位与核心价值
- 1. 为什么需要 OpenClaw-Redis-Stream
- 2. 在 OpenClaw 插件生态中的位置
- 3. 应用场景
- 4. 设计目标与非目标

### Part II：架构总览
- 5. 双传输模式：Pub/Sub vs Stream
- 6. 消息路由与会话隔离模型
- 7. 核心工作流

### Part III：核心技术实现
- 8. 模块划分与目录结构
- 9. 配置解析与校验（redis-stream-config.ts）
- 10. Redis 传输层（redis-stream-server.ts）
- 11. 入站消息处理（inbound.ts）
- 12. Channel → Agent 路由（topic-router.ts）
- 13. 会话隔离（dm-scope.ts + session-mapper.ts）
- 14. 共享发布器（publisher.ts）与日志（logger.ts）
- 15. 插件入口与 HTTP 路由（index.ts + channel.ts）

### Part IV：部署与测试
- 16. 插件安装与配置
- 17. 测试策略
- 18. 运维与诊断

### Part V：附录
- 附录 A：Redis 命令速查表
- 附录 B：配置示例大全
- 附录 C：术语表

---

# Part I：定位与核心价值

## 1. 为什么需要 OpenClaw-Redis-Stream

OpenClaw 提供了一套强大的多渠道消息抽象，而 Redis 是业界最广泛使用的内存数据库之一。
其内置的 **Pub/Sub**（发布/订阅）和 **Stream**（流 + 消费组）机制提供了轻量、高性能的消息传递能力。

`openclaw-redis-stream` 插件将 Redis 的消息能力接入 OpenClaw，实现：

- **零外部依赖**：不需要额外的消息队列（RabbitMQ、Kafka 等），利用现有的 Redis 基础设施。
- **双传输模式**：Pub/Sub 用于实时即发即忘消息（如聊天），Stream 用于持久化、可回放的消息处理（如事件溯源）。
- **多 Topic 路由**：支持 `*` 通配符匹配，灵活将不同 Redis channel 的消息路由到不同的 AI Agent。
- **消费组保证**：Stream 模式下利用 Redis Consumer Group 实现 at-least-once 投递和水平扩展。
- **dmScope 会话隔离**：完全遵循 OpenClaw 全局 `session.dmScope` 配置，与飞书、MQTT、STOMP、RabbitMQ 等渠道插件一致。

### 1.1 与其他渠道插件的对比

| 特性 | Redis Stream | MQTT | RabbitMQ | Gotify |
|------|-------------|------|----------|--------|
| 传输协议 | Redis 协议 | MQTT 5.0 | AMQP 0.9.1 | HTTP + WebSocket |
| 消息持久化 | Stream 模式支持 | 依赖 Broker | 依赖 Broker | Gotify Server 存储 |
| 消费组 | 原生 XREADGROUP | 共享订阅 | 原生 Consumer | 不适用 |
| 客户端依赖 | node-redis | mqtt.js | amqplib | fetch + ws |
| 部署复杂度 | 低（已有 Redis 即可） | 中（需要 Broker） | 中（需要 Broker） | 中（需要 Gotify Server） |

## 2. 在 OpenClaw 插件生态中的位置

`openclaw-redis-stream` 属于 **Channel Plugin** 类别，与 `openclaw-mqtt`、`openclaw-stomp`、
`openclaw-rabbitmq` 同处于消息协议适配层。

```
OpenClaw Gateway
    ↓
redis-stream Channel Plugin
    ↓
node-redis Client (v5)
    ↓
Redis Server (≥7.0)
    ├── Pub/Sub Channels
    └── Streams + Consumer Groups
```

**插件层级职责**：
- **上承 OpenClaw Gateway**：通过标准化通道接口接收出站消息，回调入站处理器；
- **下接 Redis Server**：封装 node-redis 客户端，处理连接、重连、订阅、消费组管理。

## 3. 应用场景

### 3.1 实时 AI 对话
通过 Redis Pub/Sub 实现实时双向通信：
```
客户端 → PUBLISH openclaw:agent:main:in → Redis
  → PSUBSCRIBE → 插件 → Agent 处理
  → PUBLISH openclaw:agent:main:out → 客户端收到回复
```

### 3.2 事件驱动 Agent
通过 Redis Stream + 消费组实现持久化事件处理：
```
事件生产者 → XADD openclaw:inbound * text ... agentId ...
  → XREADGROUP GROUP openclaw-group consumer-1 ... > → 插件消费
  → Agent 处理 → XADD openclaw:outbound * text ...
  → XACK 确认
```

### 3.3 多 Agent 路由
不同 Redis channel 的消息自动路由到对应的 Agent：
```
sensor:temperature → channelBindings → iot-agent
openclaw:agent:chatbot:in → 标准格式 → chatbot
random:message → defaultAgentId → main (兜底)
```

### 3.4 IoT 数据管道
传感器通过 Redis channel 发布数据，Agent 实时处理并回复控制指令。

## 4. 设计目标与非目标

### 4.1 三大硬约束

| 目标 | 强约束 | 插件体现 |
|------|--------|----------|
| **OpenClaw 通道契约兼容** | 实现 `ChannelPlugin` 完整接口 | `defineChannelPluginEntry`, `outbound.sendText`, `gateway.startAccount/stopAccount` |
| **双传输模式** | Pub/Sub 和 Stream 共用同一套路由、会话隔离 | `channelMode: "pubsub" \| "stream"` 切换 |
| **用户体验闭环** | 安装、配置、运行、诊断形成完整闭环 | `/redis-stream/health`, `/redis-stream/status`, 配置校验 |

### 4.2 非目标

- 不实现 Redis Cluster 的完整支持（Stream 消费组在 Cluster 模式下需谨慎键路由）；
- 不替代 Redis 官方的 pub/sub 或 stream 管理工具；
- 不在插件内实现消息存储或离线队列（由 Redis Stream 和 OpenClaw 共同保证）；
- 不实现 Redis 以外的消息协议（如 Kafka、NATS 等）。

---

# Part II：架构总览

## 5. 双传输模式：Pub/Sub vs Stream

### 5.1 Pub/Sub 模式（`channelMode: "pubsub"`）

```
┌─────────────────────────────────────────┐
│              Redis Server               │
│                                         │
│  Channel: openclaw:agent:main:in        │
│    ↑ PUBLISH                    ↓ PSUBSCRIBE
│  [外部客户端]              [openclaw-redis-stream]
│                                         │
│  Channel: openclaw:agent:main:out       │
│    ↓ PSUBSCRIBE                 ↑ PUBLISH
│  [外部客户端]              [openclaw-redis-stream]
└─────────────────────────────────────────┘
```

- **实时性**：消息即时投递，无持久化
- **订阅方式**：`SUBSCRIBE`（精确匹配）+ `PSUBSCRIBE`（模式匹配，支持 `*` 通配符）
- **适用场景**：即时消息、聊天、实时通知

### 5.2 Stream 模式（`channelMode: "stream"`）

```
┌─────────────────────────────────────────┐
│              Redis Server               │
│                                         │
│  Stream: openclaw:inbound               │
│    ↑ XADD                        ↓ XREADGROUP
│  [事件生产者]    Consumer Group: openclaw-group
│                       ├── consumer-1 (本实例)
│                       └── consumer-2 (另一实例)
│                                         │
│  Stream: openclaw:outbound              │
│    ↓ XREAD                       ↑ XADD
│  [事件消费者]              [openclaw-redis-stream]
└─────────────────────────────────────────┘
```

- **持久化**：消息写入 Stream，消费后需显式 ACK
- **消费组**：支持多消费者水平扩展，pending 消息可重试
- **适用场景**：事件溯源、可靠消息处理、水平扩展

### 5.3 模式选择指南

| 需求 | 推荐模式 |
|------|---------|
| 聊天、即时消息 | Pub/Sub |
| 事件溯源、审计 | Stream |
| 水平扩展多实例 | Stream（消费组） |
| 最简单部署 | Pub/Sub |
| 消息不丢失 | Stream（at-least-once + ACK） |

## 6. 消息路由与会话隔离模型

### 6.1 三层路由优先级

```
┌──────────────────────────────────────────┐
│         路由优先级（高 → 低）              │
├──────────────────────────────────────────┤
│ 1. fieldAgentId（Stream 字段映射覆盖）     │
│    └─ XADD ... agentId chat-agent       │
│                                          │
│ 2. channelBindings（显式绑定优先）         │
│    └─ {"channelPattern":"sensor:*",      │
│         "agentId":"iot-agent"}           │
│                                          │
│ 3. standard format（标准格式）             │
│    └─ openclaw:agent:<agentId>:in       │
│                                          │
│ 4. defaultAgentId（配置兜底）              │
│    └─ {"defaultAgentId":"main"}          │
│                                          │
│ 5. 丢弃（无任何匹配）                      │
└──────────────────────────────────────────┘
```

### 6.2 会话隔离（dmScope）

完全遵循 OpenClaw 全局 `session.dmScope` 配置，默认 `per-peer`。
**运行时 sessionKey 由 OpenClaw 核心 `resolveAgentRoute` 返回（与飞书完全一致）**，插件不自建会话键。

| dmScope | 会话键格式（由 OpenClaw 核心生成） | 隔离粒度 |
|---------|-------------------------------|----------|
| `per-peer` (默认) | `agent:<agentId>:direct:<peerId>` | 按对端隔离 |
| `main` | `agent:<agentId>:main` | 所有消息共享一个会话 |
| `per-channel-peer` | `agent:<agentId>:<channel>:direct:<peerId>` | 按渠道+对端隔离 |
| `per-account-channel-peer` | `agent:<agentId>:<channel>:<accountId>:direct:<peerId>` | 最细粒度多租户隔离 |

> **默认值说明**：插件默认使用 `per-peer`，确保会话键遵循 `agent:<agentId>:direct:<peerId>` 规则，
> 与飞书、抖音等 OpenClaw 渠道插件对齐。`peerId` 默认为 Redis channel 名称（可通过 Stream `fieldMapping.peerIdField` 覆盖）。

## 7. 核心工作流

### 7.1 出站消息流（OpenClaw → Redis）

```
Agent 回复
  → rt.channel.reply.dispatchReplyFromConfig
    → createReplyDispatcherWithTyping.deliver
      → publishMessage(replyChannel, text)
        → client.publish(channel, message)    [Pub/Sub]
        或
        → client.xAdd(stream, "*", values)     [Stream]
```

### 7.2 入站消息流（Redis → OpenClaw）

```
Redis 消息到达
  → Pub/Sub callback 或 XREADGROUP 消费
    → handleInboundMessage(message, config)
      ├── isOutboundChannel 过滤（防自循环）
      ├── whitelist 过滤（subscribeChannels）
      ├── route 解析（fieldAgentId > binding > standard > defaultAgentId）
      ├── payload 解析（jsonTextOrPlain）
      └── resolveAgentRoute({ channel, accountId, peer: { kind: "direct", id: peerId } })
            → sessionKey = replyOptions.sessionKey（OpenClaw 核心返回，与飞书一致）
            → finalizeInboundContext + createReplyDispatcherWithTyping
              → dispatchReplyFromConfig
                → publishMessage(replyChannel, text)
```

---

# Part III：核心技术实现

## 8. 模块划分与目录结构

```
openclaw-redis-stream/
├── src/
│   ├── index.ts                  # 插件入口，defineChannelPluginEntry + HTTP 路由
│   ├── channel.ts                # ChannelPlugin 完整实现
│   ├── types.ts                  # 全部 TypeScript 类型定义
│   ├── dm-scope.ts               # dmScope 决议 + 会话键构建
│   ├── session-mapper.ts         # 会话映射 + 上下文存储
│   ├── topic-router.ts           # Channel → Agent 路由解析
│   ├── inbound.ts                # 入站消息处理管线
│   ├── runtime.ts                # PluginRuntime 单例存储
│   ├── redis-stream-config.ts    # 配置解析 + 默认值补齐
│   ├── redis-stream-server.ts    # Redis 传输层（Pub/Sub + Stream）
│   ├── publisher.ts              # 共享 Redis publish 操作（打破循环依赖）
│   ├── logger.ts                 # 集中式日志模块
│   ├── setup-entry.ts            # 轻量 setup 入口
│   ├── openclaw-sdk.d.ts         # Peer dependency 类型桩
│   ├── dm-scope.test.ts          # 16 项 dmScope 测试
│   ├── config.test.ts            # 14 项配置解析测试
│   ├── topic-router.test.ts      # 15 项路由匹配测试
│   ├── session-mapper.test.ts    # 10 项会话映射测试
│   ├── channel.test.ts           # 12 项 ChannelPlugin 契约测试
│   └── functional.test.ts        # 42 项 Redis 集成测试
├── scripts/
│   └── integration-test.ts       # 全链路集成测试（Pub/Sub + main 智能体）
├── docs/                         # 架构文档 + 使用指南
├── .github/workflows/            # CI + Release
├── package.json / tsconfig.json / tsup.config.ts
├── eslint.config.js / .prettierrc
└── openclaw.plugin.json          # 插件清单
```

**模块职责速查**：

| 文件 | 核心导出 | 职责 |
|------|---------|------|
| `index.ts` | `defineChannelPluginEntry` 默认导出 | 插件注册 + HTTP 路由 |
| `channel.ts` | `redisStreamChannel` (ChannelPlugin) | 完整 ChannelPlugin 实现 |
| `redis-stream-server.ts` | `startRedisServer`, `stopRedisServer`, `getStats` | Redis 连接、Pub/Sub 订阅、Stream 消费循环 |
| `redis-stream-config.ts` | `resolveRedisChannelConfig`, `redactUrl` | 配置解析、校验、默认值补齐 |
| `inbound.ts` | `handleInboundMessage` | 入站消息过滤、路由、分发 |
| `topic-router.ts` | `resolveInboundRoute`, `matchChannel` | Channel → Agent 路由匹配 |
| `dm-scope.ts` | `resolveDmScopeFromRuntimeConfig`, `buildSessionKeyFromDmScope` | 会话隔离策略（测试用，运行时 sessionKey 由 OpenClaw 核心返回） |
| `session-mapper.ts` | `getOrCreateSessionKey`, `upsertSessionContext`, `getSessionStats` | 会话键映射 + 上下文管理（`getSessionStats` 供 HTTP 路由使用） |
| `publisher.ts` | `publishMessage`, `publishEntry` | 共享 Redis 发布操作 |
| `logger.ts` | `logger.info/warn/error` | 带前缀的集中式日志 |
| `runtime.ts` | `setRedisStreamRuntime`, `getRedisStreamRuntime` | PluginRuntime 单例 |

## 9. 配置解析与校验（redis-stream-config.ts）

### 9.1 配置来源优先级

```
process.env.REDIS_URL > channels.redis-stream.url > 默认值
```

### 9.2 默认值补齐

`resolveRedisChannelConfig()` 对每个字段进行类型校验 + 默认值补齐：

- `url`: 必须提供，优先级 `REDIS_URL` env > config > `"redis://127.0.0.1:6379"`（默认）
- `subscribeChannels`: 过滤非字符串元素，空白数组 = 接受全部
- `channelBindings`: 过滤缺失 `channelPattern` 或 `agentId` 的无效条目
- `stream.blockMs`: 必须 ≥ 0
- `stream.count`: 必须 > 0
- `connection.reconnectMs`: 必须 > 0
- `connection.maxRetries`: 必须 > 0

### 9.3 安全：URL 密码脱敏

```typescript
export function redactUrl(url: string): string {
  const u = new URL(url);
  if (u.password) u.password = "***";
  return u.toString();
}
```

用于 `/redis-stream/health` 和 `/redis-stream/status` HTTP 响应中展示配置，
确保密码不会泄露到日志或 HTTP 输出。

## 10. Redis 传输层（redis-stream-server.ts）

### 10.1 连接管理

```
startRedisServer(config)
  ├── loadChannelBindings(config.channelBindings)
  ├── createClient({ url, socket.reconnectStrategy })
  ├── client.connect()
  ├── setPublisherClient(client)          → 注入到 publisher.ts
  ├── [stream] ensureConsumerGroup()
  ├── [pubsub] startPubSub()
  └── [stream] consumeLoop()              → 后台消费循环

stopRedisServer()
  ├── subscriberClient.unsubscribe().pUnsubscribe().quit()
  ├── client.quit()
  ├── clearPublisherClient()
  └── stats.connected = false
```

### 10.2 重连策略

使用 node-redis v5 内置 `socket.reconnectStrategy`：

```typescript
reconnectStrategy: (retries: number) => {
  if (retries >= config.connection.maxRetries) {
    return new Error(`max reconnection attempts exceeded`);
  }
  return config.connection.reconnectMs;  // 默认 3000ms，最多 10 次
}
```

### 10.3 Pub/Sub 订阅

```typescript
startPubSub(config):
  subscriberClient = client.duplicate()
  if subscribeChannels 为空:
    pSubscribe("*")         → 接受所有 channel
  else:
    patterns = 含 * 的配置项   → pSubscribe(pattern)
    exact    = 不含 * 的配置项  → subscribe(exact)
```

使用独立订阅客户端（`client.duplicate()`），因为 Redis Pub/Sub 订阅模式下
连接进入"订阅状态"，不能执行其他命令。

### 10.4 Stream 消费组

```
ensureConsumerGroup(config):
  client.xGroupCreate(inboundKey, consumerGroup, "0", { MKSTREAM: true })

consumeLoop(config):
  while running:
    result = client.xReadGroup(consumerGroup, consumerName,
      { key: inboundKey, id: ">" },          → 仅新消息
      { COUNT: count, BLOCK: blockMs })

    for each message:
      fieldMap = toFieldMap(fields)           → 兼容数组和对象格式
      inbound = { channel, message, fieldAgentId, fieldPeerId, ... }
      accepted = handleInboundMessage(inbound, config)
      if accepted: client.xAck(stream, group, id)    → 成功才 ACK

    错误: 指数退避 min(1000 * 2^n, 30000)ms
```

**关键设计**：
- `id: ">"` 确保只读取新消息（不重复投递）
- 仅在 `handleInboundMessage` 返回非 `false` 时 ACK（保留 pending 供重试）
- `toFieldMap()` 兼容 node-redis v5 的纯对象格式和 RESP2 平铺数组格式

### 10.5 统计指标

```typescript
interface RedisStats {
  connected: boolean;
  lastConnectAt: number | null;
  lastReadAt: number | null;
  lastError: string | null;
  messagesRead: number;
  messagesWritten: number;       // local + publisher 计数合并
  messagesAcked: number;
  subscribedChannels: string[];
}
```

## 11. 入站消息处理（inbound.ts）

`handleInboundMessage()` 是连接 Redis 入站与 OpenClaw Agent 的核心桥梁：

```
handleInboundMessage(message, config)
  ├── ① isOutboundChannel 过滤（:out / openclaw:agent:outbound）
  ├── ② whitelist 过滤（subscribeChannels）
  ├── ③ 路由解析
  │     ├── fieldAgentId 覆盖（Stream 模式）
  │     ├── resolveInboundRoute(channel, config.channelBindings)
  │     └── defaultAgentId 兜底
  ├── ④ dmScope 会话键构建
  ├── ⑤ payload 解析（jsonTextOrPlain）
  ├── ⑥ replyChannel 推导
  ├── ⑦ 会话上下文更新
  └── ⑧ dispatchToRuntime
        ├── resolveAgentRoute
        ├── finalizeInboundContext
        ├── createReplyDispatcherWithTyping
        │     └── deliver: publishMessage(replyChannel, text)
        └── dispatchReplyFromConfig
```

**入站上下文关键字段**：

| 字段 | 来源 | 用途 |
|------|------|------|
| `channel` | `inbound.channel` | 原始 Redis channel 名 |
| `matchedPattern` | 路由结果 | 匹配的绑定规则 |
| `routeSource` | 路由结果 | `"field"` / `"binding"` / `"standard"` |
| `from` | `peerId`（channel 名或 fieldPeerId） | 发送者标识 |
| `chatType` | `"direct"` | 私聊模式 |
| `text` | payload 解析结果 | 消息正文 |

### 11.1 Payload 解析模式

| 模式 | 行为 |
|------|------|
| `"jsonTextOrPlain"` (默认) | 尝试 `JSON.parse()`，提取 `.text` 字段；解析失败或 `.text` 为空则返回原始文本 |
| `"plain"` | 直接返回原始文本 |

## 12. Channel → Agent 路由（topic-router.ts）

### 12.1 路由解析算法

```typescript
resolveInboundRoute(channel, bindings):
  // Step 1: 显式绑定优先
  for each binding:
    if matchChannel(channel, binding.channelPattern):
      return { agentId, accountId, replyChannel, source: "binding" }

  // Step 2: 标准格式回退
  if channel == "openclaw:agent:<agentId>:in":
    return { agentId, accountId: "default", source: "standard" }

  // Step 3: 无匹配
  return null   → inbound.ts 中 fallback 到 defaultAgentId
```

### 12.2 Channel 通配符匹配

```typescript
matchChannel(channel, pattern):
  "sensor:temperature:bedroom" vs "sensor:temperature:*"  → true
  "sensor:temperature:bedroom" vs "sensor:humidity:*"     → false
  "a:b:c:d" vs "a:*"                                      → true（贪婪匹配）
  "any:channel:name" vs "*"                                → true（匹配一切）
  "openclaw:agent"  vs "openclaw:agent:test:in"           → false（channel 更短）
```

`*` 通配符是**贪婪**的——匹配所有剩余级别。与 Redis PSUBSCRIBE 的 `*`（仅匹配单段）不同。

## 13. 会话隔离（dm-scope.ts + session-mapper.ts）

### 13.1 运行时会话键来源 — 飞书模式

`inbound.ts` 遵循与飞书完全一致的模式：**sessionKey 由 OpenClaw 核心 `resolveAgentRoute` 返回**，插件不自建会话键：

```typescript
// inbound.ts — 与飞书完全一致
const replyOptions = await rt.channel.routing.resolveAgentRoute({
  cfg: rt.config,
  channel: "redis-stream",
  accountId: route.accountId,
  peer: { kind: "direct", id: peerId },
});
const sessionKey: string = replyOptions.sessionKey;
```

`dm-scope.ts` 和 `session-mapper.ts` 保留用于：
- **单元测试**：独立验证 dmScope 决议和会话键构建逻辑
- **HTTP 路由**：`index.ts` 通过 `getSessionStats()` 提供会话统计

### 13.2 dmScope 决议（dm-scope.ts，测试/参考用）

```typescript
resolveDmScopeFromRuntimeConfig(cfg):
  rawScope = cfg.session.dmScope
  if rawScope is valid ("main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer"):
    return rawScope
  return "per-peer"  // 默认，与飞书渠道插件对齐
```

### 13.2 会话键构建

```typescript
buildSessionKeyFromDmScope({ cfg, agentId, channel, accountId, peerId }):
  // token 标准化：trim() + toLowerCase()
  if !peerId: return "agent:<agent>:main"
  if dmScope == "main": return "agent:<agent>:main"
  if dmScope == "per-account-channel-peer": return "agent:<agent>:<channel>:<accountId>:direct:<peerId>"
  if dmScope == "per-channel-peer": return "agent:<agent>:<channel>:direct:<peerId>"
  return "agent:<agent>:direct:<peerId>"
```

### 13.3 会话映射

`sessio-mapper.ts` 维护三张内存 Map：

| Map | Key → Value | 用途 |
|-----|------------|------|
| `peerSessionMap` | `peerId` → `sessionKey` | 快速查找 peer 的会话 |
| `sessionPeerMap` | `sessionKey` → `peerId` | 反向查找 |
| `sessionContextMap` | `sessionKey` → `RedisSessionContext` | 会话上下文（channel、replyChannel、更新时间等） |

## 14. 共享发布器（publisher.ts）与日志（logger.ts）

### 14.1 publisher.ts — 打破循环依赖

`redis-stream-server.ts` ↔ `inbound.ts` 之间存在天然循环依赖：
- `redis-stream-server.ts` 调用 `inbound.ts` 的 `handleInboundMessage`
- `inbound.ts` 的回复分发器需要调用 `publishMessage`

**解决**：提取 `publishMessage` 和 `publishEntry` 到独立的 `publisher.ts`：

```
redis-stream-server.ts ──→ publisher.ts (setPublisherClient)
         ↓                        ↓
    inbound.ts  ─────────→ publisher.ts (publishMessage)
```

- `setPublisherClient()` 在连接建立时注入 Redis 客户端引用
- `clearPublisherClient()` 在断开连接时清除
- `publishMessage()` / `publishEntry()` 无需知道客户端的生命周期

### 14.2 logger.ts — 集中式日志

```typescript
logger.info("Inbound: channel=...")   // 代替 console.log
logger.warn("No route matched: ...")  // 代替 console.warn
logger.error("Dispatch failed:", err) // 代替 console.error
```

- 统一前缀 `[openclaw-redis-stream]`
- 支持通过 `logger.setLoggers()` 注入自定义实现（如 OpenClaw runtime logger）
- 底层 fallback 到 `console`（带 `/* eslint-disable no-console */` 声明）

## 15. 插件入口与 HTTP 路由（index.ts + channel.ts）

### 15.1 插件注册

```typescript
export default defineChannelPluginEntry({
  id: "openclaw-redis-stream",
  name: "Redis Stream",
  description: "Redis Pub/Sub channel + Stream consumer group integration for OpenClaw.",
  plugin: redisStreamChannel,
  setRuntime: setRedisStreamRuntime,
  registerCliMetadata(api) { /* ... */ },
  registerFull(api) {
    api.registerHttpRoute({ path: "/redis-stream/health", ... });
    api.registerHttpRoute({ path: "/redis-stream/status", ... });
  },
});
```

### 15.2 HTTP 路由

| 路径 | 认证 | 用途 |
|------|------|------|
| `GET /redis-stream/health` | plugin | 健康检查：返回 `{ healthy, connected, data, sessions }` |
| `GET /redis-stream/status` | plugin | 状态详情：返回完整配置（密码脱敏）+ 统计 + 会话信息 |

### 15.3 ChannelPlugin 能力声明

```typescript
capabilities: { chatTypes: ["direct"] }  // 仅支持私聊
threading: { resolveReplyToMode: () => "off" }  // 无线程回复
groups: { resolveRequireMention: () => false }   // 无需 @提及
reload: { configPrefixes: ["channels.redis-stream"] }  // 支持热重载
```

---

# Part IV：部署与测试

## 16. 插件安装与配置

### 16.1 安装

```bash
# 通过 ClawHub
openclaw plugins install clawhub:@partme.ai/openclaw-redis-stream

# 通过 npm
openclaw plugins install npm:@partme.ai/openclaw-redis-stream
```

### 16.2 最小配置

```json
{
  "channels": {
    "redis-stream": {
      "url": "redis://localhost:6379",
      "channelMode": "pubsub",
      "subscribeChannels": ["openclaw:agent:*:in"]
    }
  }
}
```

### 16.3 完整配置

参见附录 B。

## 17. 测试策略

### 17.1 单元测试（vitest，111 项）

| 测试文件 | 测试数 | 测试内容 |
|---------|--------|---------|
| `dm-scope.test.ts` | 16 | dmScope 决议、会话键构建、token 标准化、peerId 空值回退 |
| `config.test.ts` | 14 | 配置解析、默认值、env 覆盖、channelBindings 过滤、Stream 参数校验 |
| `topic-router.test.ts` | 15 | 精确匹配、通配符、标准格式、绑定优先、无效路由 |
| `session-mapper.test.ts` | 10 | 会话创建/查找、上下文 upsert、peer 移除、统计 |
| `channel.test.ts` | 12 | ChannelPlugin 契约：id、能力、配置适配器、线程、状态 |
| `functional.test.ts` | 42 | Redis 连接、Pub/Sub 收发、Stream 消费组、payload 解析、defaultAgentId 兜底、E2E 管线 |

### 17.2 集成测试

`scripts/integration-test.ts`：
- Mock OpenClaw Runtime（最小化 mock）
- 配置 `defaultAgentId: "main"` + `subscribeChannels: ["openclaw:agent:*:in"]`
- 启动 Redis Server（连接真实 Redis）
- PUBLISH `openclaw:agent:main:in` → 验证 main agent 收到消息
- SUBSCRIBE `openclaw:agent:main:out` → 验证回复发送成功
- 验证：messagesRead ≥ 1, dispatchedText 正确, 回复包含原始内容

## 18. 运维与诊断

```bash
# 健康检查
curl http://gateway:port/redis-stream/health

# 状态详情（含脱敏配置 + 统计）
curl http://gateway:port/redis-stream/status

# 日志过滤
grep "\[openclaw-redis-stream\]" openclaw.log
```

**状态端点响应示例**：
```json
{
  "ok": true,
  "healthy": true,
  "data": {
    "connected": true,
    "lastConnectAt": 1716153600000,
    "messagesRead": 42,
    "messagesWritten": 18,
    "messagesAcked": 42,
    "subscribedChannels": ["openclaw:agent:*:in"]
  },
  "sessions": { "peerCount": 3, "sessionCount": 3, "contextCount": 3 }
}
```

---

# Part V：附录

## 附录 A：Redis 命令速查表

| 命令 | 用途 | 插件使用场景 |
|------|------|------------|
| `SUBSCRIBE channel [channel ...]` | 精确频道订阅 | `subscribeChannels` 中不含 `*` 的配置项 |
| `PSUBSCRIBE pattern [pattern ...]` | 模式频道订阅 | `subscribeChannels` 中含 `*` 的配置项 / 空白名单全订阅 |
| `PUBLISH channel message` | 发布消息 | 出站回复 + sendText |
| `XADD stream * field value [field value ...]` | 追加流消息 | Stream 模式出站 |
| `XREADGROUP GROUP group consumer ... STREAMS stream >` | 消费组读取 | Stream 模式入站消费循环 |
| `XACK stream group id [id ...]` | 确认消息 | 成功处理后的 ACK |
| `XGROUP CREATE stream group id MKSTREAM` | 创建消费组 | `ensureConsumerGroup()` |

## 附录 B：配置示例大全

### Pub/Sub 最小配置

```json
{
  "channels": {
    "redis-stream": {
      "url": "redis://localhost:6379",
      "channelMode": "pubsub",
      "subscribeChannels": ["openclaw:agent:*:in"]
    }
  }
}
```

### Pub/Sub + 显式绑定

```json
{
  "channels": {
    "redis-stream": {
      "url": "redis://localhost:6379",
      "channelMode": "pubsub",
      "subscribeChannels": ["openclaw:*", "sensor:*", "chat:*"],
      "channelBindings": [
        {
          "channelPattern": "sensor:temperature",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyChannel": "sensor:temperature:response"
        },
        {
          "channelPattern": "chat:*",
          "agentId": "chat-agent"
        }
      ],
      "defaultAgentId": "main"
    }
  }
}
```

### Stream 消费组

```json
{
  "channels": {
    "redis-stream": {
      "url": "redis://localhost:6379",
      "channelMode": "stream",
      "defaultAgentId": "main",
      "stream": {
        "inboundKey": "openclaw:inbound",
        "outboundKey": "openclaw:outbound",
        "consumerGroup": "openclaw-group",
        "consumerName": "openclaw-consumer-1",
        "blockMs": 5000,
        "count": 10,
        "createGroup": true
      },
      "fieldMapping": {
        "textField": "text",
        "agentIdField": "agentId",
        "peerIdField": "peerId",
        "accountIdField": "accountId",
        "replyStreamField": "replyStream"
      },
      "payload": { "mode": "jsonTextOrPlain" },
      "connection": {
        "reconnectMs": 3000,
        "maxRetries": 10
      }
    }
  }
}
```

### TLS 加密连接

```json
{
  "channels": {
    "redis-stream": {
      "url": "rediss://user:password@redis.example.com:6380",
      "channelMode": "pubsub"
    }
  }
}
```

### 环境变量覆盖

```bash
export REDIS_URL="redis://prod-redis:6379"
# channels.redis-stream.url 被 REDIS_URL 覆盖
```

## 附录 C：术语表

| 术语 | 定义 |
|------|------|
| Redis Pub/Sub | Redis 内置的发布/订阅消息模式，消息不持久化 |
| Redis Stream | Redis 5.0+ 引入的持久化流数据结构，支持消费组 |
| Consumer Group | Redis Stream 消费组，支持多消费者并行消费 |
| XREADGROUP | 消费组读取命令，`>` 表示仅新消息 |
| XACK | 消费确认命令，从 pending list 移除消息 |
| PSUBSCRIBE | 模式频道订阅，支持 `*` 通配符 |
| node-redis | Redis 官方推荐的 Node.js 客户端（npm 包 `redis`） |
| ChannelPlugin | OpenClaw 通道插件的核心接口 |
| dmScope | 会话隔离策略（per-peer / main / per-channel-peer / per-account-channel-peer） |
| peerId | 对端标识符，用于会话隔离，默认使用 Redis channel 名称 |
| Channel Binding | Channel 模式 → Agent 的显式绑定规则 |
| defaultAgentId | 无任何路由匹配时的兜底 Agent ID |
| Standard Format | `openclaw:agent:<agentId>:in` 自动路由格式 |

---

**文档版本**：1.0.0
**最后更新**：2026-05-19
**维护者**：PartMe.AI
