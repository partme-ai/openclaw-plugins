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
- **可靠 Stream 消费**：成功派发后 ACK、回收超时 PEL、有界重试并原子转入死信 Stream
- **HTTP 健康/状态端点**：提供 `/redis-stream/health` 和 `/redis-stream/status` 监控接口

## 生命周期

1. **Gateway 启动** → 加载插件，注册 `redis-stream` 渠道
2. **账户启动** → 连接 Redis，订阅频道（Pub/Sub 模式）或创建消费组（Stream 模式）
3. **消息接收** → 入站消息经白名单过滤 → 路由解析 → dmScope 会话映射 → Agent 分发
4. **Agent 回复** → 通过 `PUBLISH`（Pub/Sub 模式）或 `XADD`（Stream 模式）发送回复
5. **Gateway 关闭** → 取消订阅，退出 Redis 连接

## 消息处理流程

### 双模式运行架构

先用字符图快速区分“实时但不可恢复”的 Pub/Sub 与“有 PEL/ACK”的 Stream；下方 Mermaid
继续保留完整可渲染关系：

```text
┌────────────────────────────── Redis ───────────────────────────────────────┐
│                                                                           │
│  Pub/Sub：PUBLISH → SUBSCRIBE ───────────────┐  at-most-once              │
│                                              │                            │
│  Stream：XADD → Consumer Group → PEL ────────┤  at-least-once             │
│                 ▲              │              │                            │
│                 │ XAUTOCLAIM   └─ 超限 → DLQ + XACK（MULTI）              │
│                 └─────────────────────────────┘                            │
└──────────────────────────────────────────────┬────────────────────────────┘
                                               ▼
┌──────────────────────── openclaw-redis-stream ────────────────────────────┐
│ 白名单 → 路由 → 两阶段幂等 → 有界 Agent Turn → 回复 PUBLISH / XADD        │
│                                                                           │
│ stop：停止订阅/读取 → 排空已接纳任务 → 清 publisher → 关闭主连接           │
└──────────────────────────────────────────────┬────────────────────────────┘
                                               ▼
                                  OpenClaw Runtime / Agent
```

```mermaid
flowchart LR
    E["外部系统"] --> M{"channelMode"}
    M -->|"pubsub"| PS["Redis PUBLISH / SUBSCRIBE<br/>实时但不持久"]
    M -->|"stream"| XS["Redis Stream<br/>XADD / XREADGROUP"]
    PS --> I["白名单 / 路由 / 会话映射"]
    XS --> I
    I --> A["OpenClaw Runtime / Agent"]
    A --> O{"回复模式"}
    O -->|"pubsub"| PO["PUBLISH reply channel"]
    O -->|"stream"| XO["XADD reply stream"]
    XO --> XS

    XS --> PEL["PEL<br/>未完成投递"]
    PEL -->|"XAUTOCLAIM"| I
    PEL -->|"达到 maxAttempts"| DLQ["Dead-letter Stream"]
```

Pub/Sub 和 Stream 的可靠性语义完全不同：Pub/Sub 没有 ACK，订阅者离线或处理进程崩溃时
消息即丢失；Stream 模式把未完成消息留在 PEL，适合不能接受静默丢失的业务链路。

### Pub/Sub 过载与发送成功语义

```mermaid
flowchart TD
    R["Redis 订阅回调"] --> C{"in-flight < maxPubSubInFlight?"}
    C -->|"是"| A["进入 OpenClaw Agent 管道"]
    C -->|"否"| D["拒绝本条消息<br/>messagesFailed + 1"]
    A --> P["PUBLISH 回复"]
    P --> N{"Redis 返回订阅者数量"}
    N -->|"> 0"| S["报告发送成功"]
    N -->|"= 0"| F["抛出投递失败<br/>不伪造成功"]
```

这里的并发上限是内存与模型调用的硬保护，不是无损队列。Pub/Sub 本身无法回放被拒绝的消息；
需要背压、重试和崩溃恢复时，应选择 Stream 模式。

### Stream 成功、崩溃恢复与死信时序

```mermaid
sequenceDiagram
    autonumber
    participant R as Redis Stream
    participant P as Redis Stream 插件
    participant A as OpenClaw Agent
    R->>P: XREADGROUP（entry 进入 PEL）
    P->>A: dispatchChannelMessage
    alt Agent 成功且回复 XADD 成功
        A-->>P: reply
        P->>R: XADD reply stream
        P->>R: XACK inbound entry
    else Agent/回复失败
        P-->>R: 不 XACK，entry 保留在 PEL
        R->>P: idle 到期后 XAUTOCLAIM
        alt delivery count 未达到 maxAttempts
            P->>A: 再次分发
        else 重试耗尽
            P->>R: MULTI：XADD DLQ + XACK inbound
            R-->>P: EXEC（同槽原子提交）
        end
    end
```

### Gateway 有界停机

字符图先说明超时后的可靠性差异；Mermaid 再展示同一状态决策。两种图都保留，便于快速扫读和渲染阅读：

```text
Gateway abort
      │
      ├── destroy Subscriber / Consumer（停止新接收）
      │
      ▼
等待 Stream 当前处理 + Pub/Sub 已接纳任务（总预算 shutdownTimeoutMs）
      │
      ├── 已排空 ──→ 清 publisher ──→ QUIT 主连接
      │
      └── 超时
           ├── Stream：不 XACK，entry 留在 PEL，供 XAUTOCLAIM
           ├── Pub/Sub：记录 outcome unknown 告警
           └── 清 publisher ──→ DESTROY 主连接，Gateway 有界退出
```

```mermaid
flowchart TD
    A["Gateway abort"] --> S["销毁 Subscriber / Consumer<br/>停止新接收"]
    S --> W["等待 Stream 当前处理<br/>与 Pub/Sub 已接纳任务"]
    W -->|"预算内完成"| C["清除 publisher"]
    C --> Q["QUIT 主连接"]
    W -->|"达到 shutdownTimeoutMs"| T["记录停机超时告警"]
    T --> P["Stream 不 XACK<br/>entry 保留在 PEL"]
    T --> U["Pub/Sub outcome unknown"]
    P --> D["清 publisher / DESTROY 主连接"]
    U --> D
```

1. 通过 Pub/Sub 或 `XREADGROUP` 接收 Redis 消息
2. 白名单检查：如果 `subscribeChannels` 非空，仅处理匹配的 channel
3. 路由解析：先查 `channelBindings`（显式匹配），回退到标准 `openclaw:agent:<agentId>:in` 格式
4. 从 OpenClaw 全局配置读取 dmScope（`session.dmScope`）
5. 构建会话键：`agent:<agentId>:<dmScope后缀>`
6. 更新会话上下文（channel、replyChannel、peerId）
7. Agent 分发 → `rt.channel.reply.dispatchReplyFromConfig`
8. Pub/Sub 模式使用 `PUBLISH` 回复，Stream 模式使用持久化 `XADD` 回复

## 快速开始

### 前置要求

- Node.js >= 22
- Redis >= 7.0（需 Pub/Sub 支持）
- OpenClaw Gateway >= 2026.7.1

### 安装

```bash
# 推荐 — ClawHub
openclaw plugins install clawhub:@partme.ai/openclaw-redis-stream

# 过渡期 — npm
openclaw plugins install npm:@partme.ai/openclaw-redis-stream
```

最低依赖：`@partme.ai/openclaw-message-sdk >= 2026.7.1`。

### message-sdk 复用

| message-sdk 模块                                             | redis-stream 挂载点          | 用途                        |
| ------------------------------------------------------------ | ---------------------------- | --------------------------- |
| `bridge`（`normalizeWireIngress`、`dispatchChannelMessage`） | `src/inbound.ts`             | Pub/Sub 与 Stream 入站派发  |
| `dedup` + `util/getGlobalSingleton`                          | `src/shared/wire-helpers.ts` | 入站幂等 + payload 模式映射 |
| `config/resolveChannelAgentReplyTimeoutMs`                   | `src/config/resolvers.ts`    | Agent 回复超时薄封装        |

### 最小配置

```jsonc
{
  "channels": {
    "redis-stream": {
      "url": "redis://localhost:6379",
      "channelMode": "stream",
      "defaultAgentId": "main",
      "stream": {
        "inboundKey": "openclaw:{agent}:inbound",
        "outboundKey": "openclaw:{agent}:outbound",
        "deadLetterKey": "openclaw:{agent}:inbound:dlq",
      },
    },
  },
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

| 类型     | 格式                                         | 说明                                    |
| -------- | -------------------------------------------- | --------------------------------------- |
| 标准入站 | `openclaw:agent:<agentId>:in`                | 自动检测，无需绑定                      |
| 标准出站 | `openclaw:agent:<agentId>:out`               | 由入站自动推导                          |
| 显式绑定 | 任意 channel 模式（如 `sensor:temperature`） | 在 `channelBindings` 中定义，优先级最高 |

**路由优先级**：`channelBindings` > 标准格式。如果无路由匹配，消息被静默丢弃。

Channel 模式支持 `*` 通配符（glob 风格，以冒号分隔）。独立的 `*` 匹配所有剩余分段。

## 配置参考

### 必填

| 字段  | 类型     | 默认值 | 说明           |
| ----- | -------- | ------ | -------------- |
| `url` | `string` | —      | Redis 连接 URL |

### 频道设置

| 字段                               | 类型                   | 默认值      | 说明                                                                                   |
| ---------------------------------- | ---------------------- | ----------- | -------------------------------------------------------------------------------------- |
| `channelMode`                      | `"pubsub" \| "stream"` | `"pubsub"`  | 入站消息传输模式                                                                       |
| `defaultAgentId`                   | `string`               | `""`        | 无绑定/标准格式匹配时的兜底 Agent ID。空字符串 = 丢弃无法路由的消息                    |
| `subscribeChannels`                | `string[]`             | `[]`        | 频道/模式白名单；空数组 = 接受全部                                                     |
| `channelBindings[].channelPattern` | `string`               | —           | 频道模式（支持 `*` 通配符，匹配剩余所有级别，例如 `openclaw:*` 匹配 `openclaw:a:b:c`） |
| `channelBindings[].agentId`        | `string`               | —           | 目标 Agent ID                                                                          |
| `channelBindings[].accountId`      | `string`               | `"default"` | 账户上下文                                                                             |
| `channelBindings[].replyChannel`   | `string`               | —           | 回复频道覆盖                                                                           |

### 字段映射（stream 模式 JSON 负载）

当 `channelMode` 为 `stream` 时，stream 条目的值按以下字段映射到内部字段。可根据条目格式覆盖相应键名：

| 字段                            | 类型     | 默认值          | 说明                                        |
| ------------------------------- | -------- | --------------- | ------------------------------------------- |
| `fieldMapping.textField`        | `string` | `"text"`        | 消息文本对应的条目值键名                    |
| `fieldMapping.agentIdField`     | `string` | `"agentId"`     | 目标 Agent 对应的条目值键名（覆盖频道路由） |
| `fieldMapping.peerIdField`      | `string` | `"peerId"`      | Peer 标识对应的条目值键名                   |
| `fieldMapping.accountIdField`   | `string` | `"accountId"`   | 账户上下文对应的条目值键名                  |
| `fieldMapping.replyStreamField` | `string` | `"replyStream"` | 回复 Stream 名称对应的条目值键名            |

### Stream 设置（channelMode = "stream"）

| 字段                        | 类型      | 默认值                   | 说明                                                         |
| --------------------------- | --------- | ------------------------ | ------------------------------------------------------------ |
| `stream.inboundKey`         | `string`  | `"openclaw:inbound"`     | 消费组读取的 stream 键                                       |
| `stream.outboundKey`        | `string`  | `"openclaw:outbound"`    | 回复写入的 stream 键                                         |
| `stream.consumerGroup`      | `string`  | `"openclaw-group"`       | 消费者组名称                                                 |
| `stream.consumerName`       | `string`  | `""`                     | 唯一消费者名；空值按主机名 + 进程 ID 自动生成                |
| `stream.blockMs`            | `number`  | `5000`                   | `XREADGROUP` 阻塞超时                                        |
| `stream.count`              | `number`  | `10`                     | 每批次最大消息数                                             |
| `stream.createGroup`        | `boolean` | `true`                   | 自动创建消费者组                                             |
| `stream.pendingClaimIdleMs` | `number`  | `180000`                 | XAUTOCLAIM 回收 idle PEL 条目；必须大于 Agent 超时（0=禁用） |
| `stream.maxAttempts`        | `number`  | `5`                      | 转入死信前的最大投递次数                                     |
| `stream.deadLetterKey`      | `string`  | `"openclaw:inbound:dlq"` | 死信 Stream 键                                               |
| `stream.maxLen`             | `number`  | `100000`                 | 出站与死信 Stream 近似长度上限；0 表示不限制                 |

### 负载解析

| 字段           | 类型                           | 默认值              | 说明     |
| -------------- | ------------------------------ | ------------------- | -------- |
| `payload.mode` | `"plain" \| "jsonTextOrPlain"` | `"jsonTextOrPlain"` | 解析模式 |

### 连接设置

| 字段                              | 类型      | 默认值  | 说明                                                                 |
| --------------------------------- | --------- | ------- | -------------------------------------------------------------------- |
| `connection.allowInsecureRemote`  | `boolean` | `false` | 是否允许远程 Redis 使用明文 `redis://`；生产应保持 false             |
| `connection.reconnectMs`          | `number`  | `3000`  | 指数退避基础延迟（毫秒）                                             |
| `connection.reconnectMaxMs`       | `number`  | `30000` | 指数退避最大延迟（毫秒）                                             |
| `connection.reconnectJitterRatio` | `number`  | `0.2`   | 双向随机抖动比例，降低多副本惊群                                     |
| `connection.maxRetries`           | `number`  | `0`     | 最大重连次数；0 表示持续重连                                         |
| `connection.maxPubSubInFlight`    | `number`  | `32`    | 允许同时进入 Agent 管道的 Pub/Sub 消息上限；超限消息被拒绝并计入失败 |
| `connection.startupTimeoutMs`     | `number`  | `30000` | 启动连接超时                                                         |
| `connection.shutdownTimeoutMs`    | `number`  | `10000` | 已接纳任务排空与主连接关闭的总停机预算；超时后强制销毁 socket        |

### Agent 执行边界

| 字段                          | 类型     | 默认值   | 说明                                                                          |
| ----------------------------- | -------- | -------- | ----------------------------------------------------------------------------- |
| `network.agentReplyTimeoutMs` | `number` | `120000` | Agent Turn 与 Redis 回复写入的总超时；Stream 的 `pendingClaimIdleMs` 必须更长 |

### 幂等设置

| 字段                     | 类型      | 默认值   | 说明                         |
| ------------------------ | --------- | -------- | ---------------------------- |
| `idempotency.enabled`    | `boolean` | `true`   | 派发前 claim Stream entry ID |
| `idempotency.ttlMs`      | `number`  | `600000` | 已完成 entry 的保留窗口      |
| `idempotency.maxEntries` | `number`  | `10000`  | 进程内缓存上限               |

## 可靠性与部署边界

- Stream 消息仅在 Agent 派发与回复发送均成功后 ACK；失败条目留在 PEL，并在 `pendingClaimIdleMs` 后被回收。配置强制 reclaim idle 大于 Agent 超时，避免活跃 Turn 被其他消费者抢走后并发重复执行。
- 达到 `maxAttempts` 后，原始消息与失败元数据在同一个 Redis 事务中写入 `deadLetterKey` 并 ACK。
- 每个 Gateway 副本必须使用不同的 `consumerName`；留空会按主机名和进程 ID 自动生成。
- Redis Cluster 环境中，`inboundKey` 与 `deadLetterKey` 必须使用相同 hash tag，例如 `openclaw:{agent}:inbound` 和 `openclaw:{agent}:inbound:dlq`，否则原子死信事务会跨槽失败。
- 插件当前使用单端点 node-redis 客户端，不支持原生 Redis Cluster 拓扑发现；应连接 standalone/HA 单入口或兼容代理。
- 远程 Redis 默认必须使用 `rediss://`；只有明确接受明文链路风险时才配置 `connection.allowInsecureRemote=true`。
- 断线恢复使用指数退避、最大间隔和双向抖动；Gateway 停止会中断消费错误退避，不会被最长等待阻塞。
- Pub/Sub 是明确的 at-most-once 模式，不具备 ACK、回放、死信或过载恢复。不能丢消息的生产流程应使用 Stream 模式。
- Pub/Sub 同时处理数由 `maxPubSubInFlight` 限制，超限消息会被明确拒绝并计入失败，避免突发流量无限创建 Agent turn。
- Pub/Sub 回复或主动出站时，Redis 返回订阅者数量为 0 会抛出投递失败，不能把“命令执行完成”伪装成“消息已送达”。
- 停机先关闭订阅/阻塞读取入口，再排空已接纳的 Stream 与 Pub/Sub Agent 任务，最后清除 publisher 并关闭主连接；避免人为制造回复失败或丢失。
- `shutdownTimeoutMs` 是排空与主连接关闭共享的总预算；超时后 Stream 条目不 ACK、保留在 PEL，Pub/Sub 记录结果未知，并强制销毁 socket，避免 Gateway 无限挂起。
- 幂等状态仅在当前插件进程内生效，不能宣称跨节点 exactly-once。

### 环境变量

| 变量        | 说明                                               |
| ----------- | -------------------------------------------------- |
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
    ├── config.ts          # 配置校验、解析与默认值
    ├── transport/         # Redis 发布器与 Pub/Sub/Stream 生命周期
    ├── routing/           # Topic 路由与会话映射
    ├── shared/            # 错误、日志、dmScope 与幂等辅助
    ├── setup-entry.ts     # 轻量级 setup 入口
    ├── dm-scope.test.ts
    ├── config.test.ts
    ├── topic-router.test.ts
    ├── session-mapper.test.ts
    └── channel.test.ts
```

## 企业级可靠性

> 完整说明：[队列可靠性指南](../../doc/OpenClaw-Queue-Reliability-Guide.md)

| 模式       | 分级       | ACK             | 备注                                     |
| ---------- | ---------- | --------------- | ---------------------------------------- |
| **stream** | 可企业试点 | 成功处理后 XACK | `pendingClaimIdleMs` XAUTOCLAIM 回收 PEL |
| **pubsub** | 协议限制   | 无              | at-most-once；避免空白名单 `*`           |

- 出站 channel 以 `:out` 结尾自动跳过，防自消费
- 生产请使用 `channelMode: "stream"` + 显式 `subscribeChannels`

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

| 工作流        | 触发     | 用途                     |
| ------------- | -------- | ------------------------ |
| `ci.yml`      | push, PR | 类型检查、lint、单元测试 |
| `release.yml` | tag push | 发布到 npm registry      |

## 安全

- Redis 凭据应通过连接 URL 提供（`redis://user:pass@host:port`）
- 支持通过 `rediss://` URL 方案进行 TLS 加密
- 请勿在配置文件中硬编码凭据——使用环境变量或 OpenClaw SecretRefs
- `subscribeChannels` 作为 topic 级别的 ACL 白名单

## 技术栈

| 层           | 技术                                                    |
| ------------ | ------------------------------------------------------- |
| 运行时       | Node.js >= 22                                           |
| Redis 客户端 | [node-redis](https://github.com/redis/node-redis) ^5.12 |
| 构建         | tsup                                                    |
| 测试         | Vitest                                                  |
| 类型检查     | TypeScript 5.7                                          |

## 版本信息

| 插件版本 | 推荐 Node 版本 | 最低 OpenClaw 版本 |
| -------- | -------------- | ------------------ |
| 0.2.x    | >= 22          | >= 2026.4.0        |
| 0.1.x    | >= 22          | >= 2026.4.0        |

## 相关链接

### Redis 资源

| 资源              | URL                                                      |
| ----------------- | -------------------------------------------------------- |
| Redis 官方文档    | https://redis.io/docs/                                   |
| node-redis GitHub | https://github.com/redis/node-redis                      |
| Redis Pub/Sub     | https://redis.io/docs/latest/develop/interact/pubsub/    |
| Redis Streams     | https://redis.io/docs/latest/develop/data-types/streams/ |

### OpenClaw 文档

| 资源             | URL                                                  |
| ---------------- | ---------------------------------------------------- |
| 构建插件         | https://docs.openclaw.ai/plugins/building-plugins    |
| Channel 插件 SDK | https://docs.openclaw.ai/plugins/sdk-channel-plugins |
| 插件 SDK 概览    | https://docs.openclaw.ai/plugins/sdk-overview        |
| 插件清单         | https://docs.openclaw.ai/plugins/manifest            |

## 开源协议

MIT

## 致谢

基于 Redis 团队的 [node-redis](https://github.com/redis/node-redis) 构建。会话隔离模式与 OpenClaw 的 [openclaw-mqtt](https://github.com/partme-ai/openclaw-plugins/tree/main/openclaw-mqtt)、[openclaw-stomp](https://github.com/partme-ai/openclaw-plugins/tree/main/openclaw-stomp) 和 [openclaw-rabbitmq](https://github.com/partme-ai/openclaw-plugins/tree/main/openclaw-rabbitmq) 插件对齐。

---

<div align="center">

⭐ **Star us on GitHub** — 你的支持是 PartMe 用爱发电的动力！

</div>

## 消息格式指南

Redis Stream 使用共享的 OpenClaw 队列 wire 契约完成入站解析与 envelope 回复，并额外支持 Stream 字段映射。标准 `MessageEnvelope`、非标准消息归一化与多语言 SDK 适配说明见 [OpenClaw 队列消息格式指南](../../doc/OpenClaw-Queue-Message-Format-Guide.md)。
