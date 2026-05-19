# Redis-Stream 技术参考文档

> 本文档提供 `openclaw-redis-stream` 插件的完整技术参考，包括配置 Schema、API 接口、
> TypeScript 类型定义、Redis 命令映射、事件流和性能参数。

---

## 1. 配置 Schema 完整定义

### 1.1 JSON Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["url"],
  "properties": {
    "url": {
      "type": "string",
      "description": "Redis 连接 URL（支持 redis:// 和 rediss://）"
    },
    "channelMode": {
      "type": "string",
      "enum": ["pubsub", "stream"],
      "default": "pubsub"
    },
    "defaultAgentId": {
      "type": "string",
      "default": ""
    },
    "subscribeChannels": {
      "type": "array",
      "items": { "type": "string" },
      "default": []
    },
    "channelBindings": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["channelPattern", "agentId"],
        "properties": {
          "channelPattern": { "type": "string" },
          "agentId": { "type": "string" },
          "accountId": { "type": "string" },
          "replyChannel": { "type": "string" }
        }
      },
      "default": []
    },
    "stream": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "inboundKey": { "type": "string", "default": "openclaw:inbound" },
        "outboundKey": { "type": "string", "default": "openclaw:outbound" },
        "consumerGroup": { "type": "string", "default": "openclaw-group" },
        "consumerName": { "type": "string", "default": "openclaw-consumer-1" },
        "blockMs": { "type": "number", "default": 5000 },
        "count": { "type": "number", "default": 10 },
        "createGroup": { "type": "boolean", "default": true }
      }
    },
    "payload": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "mode": {
          "type": "string",
          "enum": ["plain", "jsonTextOrPlain"],
          "default": "jsonTextOrPlain"
        }
      }
    },
    "fieldMapping": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "textField": { "type": "string", "default": "text" },
        "agentIdField": { "type": "string", "default": "agentId" },
        "peerIdField": { "type": "string", "default": "peerId" },
        "accountIdField": { "type": "string", "default": "accountId" },
        "replyStreamField": { "type": "string", "default": "replyStream" }
      }
    },
    "connection": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "reconnectMs": { "type": "number", "default": 3000 },
        "maxRetries": { "type": "number", "default": 10 }
      }
    }
  }
}
```

### 1.2 环境变量

| 变量 | 说明 | 优先级 |
|------|------|--------|
| `REDIS_URL` | Redis 连接 URL | 覆盖配置文件 `channels.redis-stream.url` |

---

## 2. TypeScript 类型定义

### 2.1 核心接口

```typescript
/** 完整配置类型 */
type RedisChannelConfig = {
  url: string;
  channelMode: "pubsub" | "stream";
  defaultAgentId: string;
  stream: {
    inboundKey: string;
    outboundKey: string;
    consumerGroup: string;
    consumerName: string;
    blockMs: number;
    count: number;
    createGroup: boolean;
  };
  subscribeChannels: string[];
  channelBindings: RedisChannelBinding[];
  payload: {
    mode: "plain" | "jsonTextOrPlain";
  };
  fieldMapping: {
    textField: string;
    agentIdField: string;
    peerIdField: string;
    accountIdField: string;
    replyStreamField: string;
  };
  connection: {
    reconnectMs: number;
    maxRetries: number;
  };
};

/** Channel → Agent 绑定 */
interface RedisChannelBinding {
  channelPattern: string;
  agentId: string;
  accountId?: string;
  replyChannel?: string;
}

/** 路由结果 */
interface RedisInboundRoute {
  agentId: string;
  accountId: string;
  replyChannel?: string;
  matchedPattern: string;
  source: "binding" | "standard" | "field";
}

/** 入站消息 */
interface RedisInboundMessage {
  channel: string;
  pattern?: string;
  message: string;
  fieldAgentId?: string;
  fieldPeerId?: string;
  fieldAccountId?: string;
  fieldReplyStream?: string;
}

/** 会话上下文 */
interface RedisSessionContext {
  peerId: string;
  agentId: string;
  accountId: string;
  lastInboundChannel?: string;
  replyChannel?: string;
  updatedAt: number;
}

/** 运行时统计 */
interface RedisStats {
  connected: boolean;
  lastConnectAt: number | null;
  lastReadAt: number | null;
  lastError: string | null;
  messagesRead: number;
  messagesWritten: number;
  messagesAcked: number;
  subscribedChannels: string[];
}
```

### 2.2 dmScope 类型

```typescript
type DmScope = "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
```

---

## 3. HTTP API 参考

### 3.1 GET /redis-stream/health

健康检查端点。

**认证**：`plugin`

**响应**：
```typescript
{
  ok: boolean;
  healthy: boolean;
  data: RedisStats;
  sessions: {
    peerCount: number;
    sessionCount: number;
    contextCount: number;
  };
}
```

**状态码**：
- `200` — 已连接
- `503` — 未连接

### 3.2 GET /redis-stream/status

完整状态端点。

**认证**：`plugin`

**响应**：
```typescript
{
  ok: true;
  data: {
    stats: RedisStats;
    config: {
      url: string;              // 密码已脱敏
      channelMode: string;
      subscribeChannels: string[];
      channelBindings: RedisChannelBinding[];
    };
    sessions: {
      peerCount: number;
      sessionCount: number;
      contextCount: number;
    };
  };
}
```

---

## 4. Redis 命令映射

插件全部使用 node-redis v5 高级 API。

| 操作 | node-redis API | Redis 命令 | 参数 |
|------|---------------|-----------|------|
| 发布消息 | `client.publish(channel, message)` | `PUBLISH` | `channel`, `message` |
| 精确订阅 | `client.subscribe(channels, callback)` | `SUBSCRIBE` | `channel [channel ...]` |
| 模式订阅 | `client.pSubscribe(patterns, callback)` | `PSUBSCRIBE` | `pattern [pattern ...]` |
| 取消订阅 | `client.unsubscribe()` / `pUnsubscribe()` | `UNSUBSCRIBE` / `PUNSUBSCRIBE` | — |
| 追加流消息 | `client.xAdd(stream, "*", values)` | `XADD` | `stream * field value [field value ...]` |
| 消费组读取 | `client.xReadGroup(group, consumer, key, options)` | `XREADGROUP` | `GROUP group consumer ... STREAMS key >` |
| 确认消息 | `client.xAck(stream, group, id)` | `XACK` | `stream group id` |
| 创建消费组 | `client.xGroupCreate(stream, group, id, options)` | `XGROUP CREATE` | `stream group id MKSTREAM` |
| 连接 | `createClient({ url, socket })` | — | socket.reconnectStrategy |
| 复制客户端 | `client.duplicate()` | — | 用于独立订阅连接 |
| 断开 | `client.quit()` | `QUIT` | — |

---

## 5. 消息处理流程

### 5.1 Pub/Sub 入站流程

```
PSUBSCRIBE 回调触发
  ↓
handleInboundMessage(message, config)
  ├─ isOutboundChannel? → skip (ACK)
  ├─ whitelist match? → skip (ACK)
  ├── route 解析（fieldAgentId > binding > standard > defaultAgentId）
  ├── payload 解析（jsonTextOrPlain）
  ├── replyChannel 推导
  └── resolveAgentRoute({ channel, accountId, peer: { kind: "direct", id: peerId } })
        → sessionKey = replyOptions.sessionKey（OpenClaw 核心返回，与飞书一致）
        → finalizeInboundContext + createReplyDispatcherWithTyping
          → dispatchReplyFromConfig
            → publishMessage(replyChannel, text)
```

### 5.2 Stream 消费循环流程

```
consumeLoop(config):
  while running:
    result = client.xReadGroup(
      config.stream.consumerGroup,
      config.stream.consumerName,
      { key: config.stream.inboundKey, id: ">" },
      { COUNT: config.stream.count, BLOCK: config.stream.blockMs }
    )

    if result == null: continue  // 超时无消息

    for each stream in result:
      for each message in stream.messages:
        fieldMap = toFieldMap(message.fields)
        inbound = {
          channel: stream.name,
          message: fieldMap.get(textField),
          fieldAgentId: fieldMap.get(agentIdField),
          fieldPeerId: fieldMap.get(peerIdField),
          fieldAccountId: fieldMap.get(accountIdField),
          fieldReplyStream: fieldMap.get(replyStreamField)
        }
        accepted = await handleInboundMessage(inbound, config)
        if accepted !== false:
          await client.xAck(stream, group, message.id)

    on error: sleep(min(1000 * 2^n, 30000))
```

---

## 6. 会话隔离（飞书模式）

运行时 sessionKey 由 OpenClaw 核心 `resolveAgentRoute` 返回，插件不自建会话键：

```typescript
// 与飞书完全一致
const replyOptions = await rt.channel.routing.resolveAgentRoute({
  cfg: rt.config,
  channel: "redis-stream",
  accountId: route.accountId,
  peer: { kind: "direct", id: peerId },
});
const sessionKey: string = replyOptions.sessionKey;
```

**dmScope 参考**（由 OpenClaw 核心使用，插件侧 `dm-scope.ts` 保留用于测试和 session-mapper）：

```
dmScope (来自 cfg.session.dmScope):
  ├─ "main"                    → agent:<id>:main
  ├─ "per-account-channel-peer" → agent:<id>:<ch>:<acct>:direct:<peer>
  ├─ "per-channel-peer"         → agent:<id>:<ch>:direct:<peer>
  └─ "per-peer" (默认)          → agent:<id>:direct:<peer>
```

**session-mapper.ts 对端映射**（供 HTTP 路由 `getSessionStats()` 使用）：

```
  peerSessionMap:     peerId → sessionKey
  sessionPeerMap:     sessionKey → peerId
  sessionContextMap:  sessionKey → RedisSessionContext
```

---

## 7. 性能参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `stream.blockMs` | 5000 | XREADGROUP 阻塞超时。过短增加空轮询，过长延迟关闭 |
| `stream.count` | 10 | 每批次最大消息数。过高增加内存，过低降低吞吐 |
| `connection.reconnectMs` | 3000 | 重连间隔。设置过低会频繁重试 |
| `connection.maxRetries` | 10 | 最大重连次数。超过后停止重连 |
| 消费错误退避 | min(1000×2^n, 30000)ms | 指数退避，上限 30 秒 |
| `dedupCache` TTL | 不适用 | Pub/Sub 无幂等去重（Stream 由 ACK 保证） |

---

## 8. 错误码参考

| 错误 | 原因 | 解决 |
|------|------|------|
| `Redis client is not initialized` | 在连接前尝试 publish | 等待 `startRedisServer` 完成 |
| `max reconnection attempts exceeded` | 重连次数超过 `maxRetries` | 检查 Redis 可用性，增加 `maxRetries` |
| `No route matched for channel` | 无匹配路由且无 `defaultAgentId` | 配置绑定或 `defaultAgentId` |
| `Runtime not initialized` | PluginRuntime 未注入 | 检查插件注册流程 |
| `connect ECONNREFUSED` | Redis 未运行或 URL 错误 | 检查 Redis 状态和 URL |

---

## 9. 依赖关系图

```
index.ts
  ├── openclaw/plugin-sdk/channel-core (defineChannelPluginEntry)
  ├── openclaw/plugin-sdk/core (PluginRuntime, OpenClawPluginApi)
  ├── channel.ts (redisStreamChannel)
  ├── redis-stream-config.ts (resolveRedisChannelConfig, redactUrl)
  ├── runtime.ts (setRedisStreamRuntime)
  └── session-mapper.ts (getSessionStats)

channel.ts
  ├── redis-stream-server.ts (startRedisServer, stopRedisServer, getStats)
  ├── publisher.ts (publishMessage, publishEntry)      ← 打破循环依赖
  └── redis-stream-config.ts (resolveRedisChannelConfig, redactUrl)

redis-stream-server.ts
  ├── redis (createClient, RedisClientType)
  ├── inbound.ts (handleInboundMessage)
  ├── topic-router.ts (loadChannelBindings)
  ├── publisher.ts (setPublisherClient, clearPublisherClient, getMessagesWritten)
  └── logger.ts

inbound.ts
  ├── runtime.ts (getRedisStreamRuntime)
  ├── topic-router.ts (resolveInboundRoute, matchChannel, buildReplyChannelFromInbound)
  ├── session-mapper.ts (getOrCreateSessionKey, upsertSessionContext)
  ├── dm-scope.ts (resolveDmScopeFromRuntimeConfig)     ← 间接使用
  ├── publisher.ts (publishMessage)
  └── logger.ts

topic-router.ts
  └── types.ts (RedisChannelBinding, RedisInboundRoute)

dm-scope.ts
  └── (无内部依赖 — 纯函数)

session-mapper.ts
  └── dm-scope.ts (buildSessionKeyFromDmScope)
```

**关键设计**：
- `publisher.ts` 作为共享模块，打破 `redis-stream-server.ts` ↔ `inbound.ts` 循环依赖
- `logger.ts` 集中所有 `console` 调用，提供注入点供 OpenClaw runtime 替换
- `dm-scope.ts` 和 `topic-router.ts` 是纯函数模块，方便单元测试

---

**文档版本**：1.0.0
**最后更新**：2026-05-19
**维护者**：PartMe.AI
