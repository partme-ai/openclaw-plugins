# OpenClaw-Redis-Stream 使用指南（安装 Redis + 安装 openclaw-redis-stream + 集成配置）

本指南面向希望把 OpenClaw 接入 Redis Pub/Sub 和 Stream 消费组的使用者，
覆盖从 Redis 部署、插件安装，到联调验证的完整路径。

> 术语速记：
> - **Pub/Sub**：Redis 发布/订阅模式，实时即发即忘消息传递
> - **Stream**：Redis 流 + 消费组模式，持久化可回放消息处理
> - **openclaw-redis-stream**：OpenClaw 的 Channel Plugin，通过 node-redis v5 连接 Redis

建议先阅读架构设计文档了解模块划分与约束：
- [OpenClaw-Redis-Stream-Architecture_CN.md](./OpenClaw-Redis-Stream-Architecture_CN.md)

---

## 1. 安装 Redis

### 1.1 Docker 部署（推荐）

```bash
docker run -d --name redis \
  -p 6379:6379 \
  --restart unless-stopped \
  redis:7-alpine
```

验证连通性：
```bash
docker exec redis redis-cli ping
# 预期输出：PONG
```

### 1.2 本地安装

**macOS：**
```bash
brew install redis
brew services start redis
```

**Linux：**
```bash
sudo apt install redis-server
sudo systemctl enable --now redis
```

### 1.3 密码认证与 TLS

```bash
# 密码认证
redis://user:password@host:6379

# TLS 加密
rediss://host:6380

# TLS + 认证
rediss://user:password@host:6380
```

---

## 2. 安装 openclaw-redis-stream

### 2.1 通过 ClawHub 安装（推荐）

```bash
openclaw plugins install clawhub:@partme.ai/openclaw-redis-stream
```

### 2.2 通过 npm 安装

```bash
openclaw plugins install npm:@partme.ai/openclaw-redis-stream
```

### 2.3 本地开发安装

```bash
git clone https://github.com/partme-ai/openclaw-plugins
cd openclaw-plugins/openclaw-redis-stream
npm install && npm run build
openclaw plugins install --link .
```

---

## 3. 配置

### 3.1 最小配置（仅 Pub/Sub）

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

仅需 `url` 即可工作。`subscribeChannels` 为空数组时接受所有 channel。

### 3.2 Pub/Sub + 显式绑定 + 兜底 Agent

```json
{
  "channels": {
    "redis-stream": {
      "url": "redis://localhost:6379",
      "channelMode": "pubsub",
      "subscribeChannels": ["openclaw:*", "sensor:*"],
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

### 3.3 Stream 消费组

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
        "peerIdField": "peerId"
      },
      "connection": {
        "reconnectMs": 3000,
        "maxRetries": 10
      }
    }
  }
}
```

### 3.4 环境变量

```bash
export REDIS_URL="redis://prod-redis:6379"
```

`REDIS_URL` 环境变量优先级高于配置文件中的 `channels.redis-stream.url`。

---

## 4. Channel 路由规则

### 4.1 路由优先级

```
fieldAgentId (Stream 字段映射覆盖)
  > channelBindings（显式绑定匹配）
    > 标准格式（openclaw:agent:<agentId>:in）
      > defaultAgentId（兜底）
        > 丢弃消息
```

### 4.2 标准格式

| 方向 | 格式 | 示例 |
|------|------|------|
| 入站 | `openclaw:agent:<agentId>:in` | `openclaw:agent:main:in` |
| 出站 | `openclaw:agent:<agentId>:out` | `openclaw:agent:main:out` |

标准格式 channel 自动检测，无需显式绑定。

### 4.3 显式绑定

```json
{
  "channelBindings": [
    {
      "channelPattern": "sensor:temperature",
      "agentId": "iot-agent",
      "accountId": "default",
      "replyChannel": "sensor:temperature:response"
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `channelPattern` | 是 | Channel 模式（支持 `*` 通配符） |
| `agentId` | 是 | 目标 Agent ID |
| `accountId` | 否 | 账户上下文（默认 `"default"`） |
| `replyChannel` | 否 | 覆盖默认回复 channel |

### 4.4 通配符匹配

`*` 是**贪婪**通配符，匹配冒号分隔的所有剩余级别：

| 模式 | Channel | 匹配？ |
|------|---------|--------|
| `sensor:*` | `sensor:temperature` | 是 |
| `sensor:*` | `sensor:temperature:bedroom` | 是 |
| `sensor:*` | `other:channel` | 否 |
| `openclaw:agent:*` | `openclaw:agent:bot1:in` | 是 |
| `*` | `any:channel:name` | 是 |

---

## 5. 会话隔离（dmScope）

完全遵循 OpenClaw 全局 `session.dmScope` 配置，默认 `per-peer`。

| dmScope | 会话键格式 | 适用场景 |
|---------|-----------|----------|
| `per-peer`（默认） | `agent:<id>:direct:<peerId>` | 每个设备/channel 独立会话 |
| `main` | `agent:<id>:main` | 所有消息共享一个会话 |
| `per-channel-peer` | `agent:<id>:<channel>:direct:<peerId>` | 按渠道隔离 |
| `per-account-channel-peer` | `agent:<id>:<channel>:<acct>:direct:<peerId>` | 完整多租户隔离 |

```json
{
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

---

## 6. 联调验证

### 6.1 运行测试

```bash
cd openclaw-redis-stream
npm install && npm run typecheck && npm run build && npm test
```

预期：111 项测试全部通过。

### 6.2 健康检查

```bash
curl http://localhost:<gateway-port>/redis-stream/health
```

```json
{
  "ok": true,
  "healthy": true,
  "data": {
    "connected": true,
    "messagesRead": 10,
    "messagesWritten": 5
  },
  "sessions": { "peerCount": 2, "sessionCount": 2, "contextCount": 2 }
}
```

### 6.3 状态详情

```bash
curl http://localhost:<gateway-port>/redis-stream/status
```

返回完整配置（密码已脱敏）、运行时统计和会话详情。

### 6.4 手动 Pub/Sub 测试

```bash
# 终端 1：订阅回复 channel
redis-cli SUBSCRIBE openclaw:agent:main:out

# 终端 2：发送测试消息
redis-cli PUBLISH openclaw:agent:main:in "你好，Redis！"
```

如果配置正确，终端 1 会收到 Agent 的回复。

### 6.5 手动 Stream 测试

```bash
# 发送消息到入站 stream
redis-cli XADD openclaw:inbound "*" text "你好" agentId "main"

# 读取回复
redis-cli XREAD BLOCK 5000 STREAMS openclaw:outbound 0
```

---

## 7. 应用场景实战

### 7.1 实时 AI 对话

使用 Pub/Sub 模式实现客户端与 AI Agent 的实时双向对话。

```
客户端 → PUBLISH openclaw:agent:main:in → Redis → 插件 → Agent
Agent → 插件 → PUBLISH openclaw:agent:main:out → Redis → 客户端
```

**配置**：
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

### 7.2 事件驱动 Agent 管道

使用 Stream + 消费组实现可靠的事件处理，at-least-once 投递保证。

```
生产者 → XADD openclaw:inbound → 消费组消费 → 插件 → Agent
Agent → 插件 → XADD openclaw:outbound → 消费者读取
插件 → XACK → 消息确认
```

**要点**：
- `id: ">"` 确保只消费新消息，不会重复投递
- 仅在 `handleInboundMessage` 成功后 ACK，失败消息保留在 pending list
- 消费组支持多实例水平扩展

### 7.3 IoT 数据处理

传感器数据通过 Redis channel 发布，插件路由到对应 Agent 处理：

```json
{
  "subscribeChannels": ["sensor:*"],
  "channelBindings": [
    { "channelPattern": "sensor:temperature", "agentId": "iot-agent" },
    { "channelPattern": "sensor:humidity", "agentId": "iot-agent" }
  ],
  "defaultAgentId": "main"
}
```

### 7.4 多服务通信

不同微服务通过 Redis channel 通信，各自路由到对应的 AI Agent：

```
Service A → openclaw:agent:service-a:in → agent:service-a
Service B → openclaw:agent:service-b:in → agent:service-b
通用消息   → random:channel → defaultAgentId: main（兜底）
```

---

## 8. 故障排查

### 连接失败
```
Error: connect ECONNREFUSED 127.0.0.1:6379
```
- 检查 Redis 是否运行：`redis-cli ping`
- 确认配置中的 URL 正确
- TLS 连接确认使用 `rediss://` 前缀

### 无路由匹配
```
[openclaw-redis-stream] No route matched for channel: xxx
```
- 添加 `channelBindings` 条目
- 使用标准格式：`openclaw:agent:<agentId>:in`
- 配置 `defaultAgentId` 兜底
- 检查 `subscribeChannels` 白名单

### 消息未收到
- 确认 `subscribeChannels` 包含目标 channel（空数组 = 全部）
- 检查 `channelMode` 是否匹配（pubsub vs stream）
- Stream 模式确认消费组已创建
- 检查插件是否启用：`openclaw plugins list | grep redis-stream`

### 自循环/回声
插件自动过滤 `:out` 结尾的 channel 和 `openclaw:agent:outbound`，
防止自循环。使用自定义回复 channel 时请确保不与入站订阅冲突。

### Redis Stream 水平扩展
- 每个实例使用不同的 `consumerName`
- 同一消费组的消费者自动负载均衡
- Pending 消息可通过 `XCLAIM` 转移所有权
- 注意：Redis Cluster 中 Stream 消费组需谨慎键路由

---

## 9. 配置参考

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `url` | `string` | — | Redis 连接 URL（必填） |
| `channelMode` | `"pubsub" \| "stream"` | `"pubsub"` | 入站传输模式 |
| `defaultAgentId` | `string` | `""` | 无匹配时的兜底 Agent |
| `subscribeChannels` | `string[]` | `[]` | 频道白名单（空=全部） |
| `payload.mode` | `"plain" \| "jsonTextOrPlain"` | `"jsonTextOrPlain"` | Payload 解析模式 |
| `stream.inboundKey` | `string` | `"openclaw:inbound"` | 消费组读取 stream |
| `stream.outboundKey` | `string` | `"openclaw:outbound"` | 回复写入 stream |
| `stream.consumerGroup` | `string` | `"openclaw-group"` | 消费组名称 |
| `stream.consumerName` | `string` | `"openclaw-consumer-1"` | 本实例消费者名称 |
| `stream.blockMs` | `number` | `5000` | XREADGROUP 阻塞超时 |
| `stream.count` | `number` | `10` | 每批次最大消息数 |
| `stream.createGroup` | `boolean` | `true` | 自动创建消费组 |
| `connection.reconnectMs` | `number` | `3000` | 重连延迟（毫秒） |
| `connection.maxRetries` | `number` | `10` | 最大重连次数 |

---

## 10. 安全建议

- **凭据保护**：Redis 密码通过连接 URL 提供（`redis://user:pass@host:port`），不要在配置文件中硬编码
- **TLS 加密**：生产环境使用 `rediss://` 方案
- **环境变量**：敏感 URL 优先通过 `REDIS_URL` 环境变量注入
- **频道白名单**：`subscribeChannels` 作为 topic 级别的 ACL
- **Redis 安全**：确保 Redis 服务端已配置 `requirepass` 和 `rename-command` 禁用危险命令
- **版本更新**：关注 Redis 安全公告（如 CNNVD-202510-401 / CVE-2025-49844），及时更新 Redis 版本

---

**文档版本**：1.0.0
**最后更新**：2026-05-19
**维护者**：PartMe.AI
