# OpenClaw 队列/消息通道 — 企业级可靠性指南

> 适用插件：`rabbitmq`、`mqtt`、`web-mqtt`、`stomp`、`web-stomp`、`redis-stream`、`gotify` 及共享库 `message-sdk`。
>
> English summary: [OpenClaw-Queue-Reliability-Guide.en.md](./OpenClaw-Queue-Reliability-Guide.en.md)

本文基于 **代码实现事实** 说明各通道的 ACK/commit 语义、生产配置建议与已知协议边界。分级含义：

| 分级 | 含义 |
|------|------|
| **已达标** | 在协议允许范围内，具备可预期的 at-least-once / 延迟 ACK + 出站确认，适合作为企业默认选型 |
| **可企业试点** | 核心路径可靠，但需配合运维配置（幂等、隔离、监控）；建议灰度 |
| **协议限制需文档约束** | 入站无法延迟 broker ACK；靠 topic/destination 隔离 + 出站 await + 幂等兜底 |
| **需后续专项** | 缺少 DLQ、多实例持久 dedup、Publisher Confirm 等，需架构/代码专项 |

---

## 1. 总览矩阵

| 插件 | 分级 | 入站 ACK/commit | 出站 reply 确认 | 失败重试 | 自消费防护 |
|------|------|-----------------|-----------------|----------|------------|
| **rabbitmq** | 可企业试点 | 延迟 ACK（reply 成功后） | `publish` 背压抛错 | retry 队列 + nack/requeue | 靠 `subscribeTopics` 白名单 |
| **redis-stream** (Stream) | 可企业试点 | 处理成功 `XACK` | `publish`/`XADD` await | PEL 保留 + **XAUTOCLAIM** | `*:out` / outbound channel 跳过 |
| **redis-stream** (Pub/Sub) | 协议限制 | 无 ACK | await | 无 | 白名单 + outbound 后缀 |
| **mqtt** | 可企业试点 | 协议无 consumer ACK | broker `publish` await | QoS1 出站重试 | server publish 跳过入站 |
| **web-mqtt** | 协议限制 | QoS0 即时 PUBACK | `publishToTopic` await | 无 | 同上 + per-client 串行队列 |
| **stomp** (TCP) | 协议限制 | SEND 无应用 ACK | 内存 queue 同步写入 | 出站 MESSAGE client ACK | destination allowlist |
| **web-stomp** | 协议限制 | 同上 | 同上 | NACK 不重投 | queue in / topic out |
| **gotify** | 协议限制 | 无 broker ACK | REST 发送 + 重试 | WS 重连 + backlog cursor | `openclaw.outbound` 标记过滤 |
| **message-sdk** | 已达标 | `deferred-delivery-ack` 等原语 | deliver 包装 | dedup / keyed queue | 由通道插件实现 |

---

## 2. 共享能力（message-sdk）

### 2.1 deferred-delivery-ack

RabbitMQ 使用 `createDeferredDeliveryAck`：**仅在 reply publish 成功且 dispatch 完成后 ACK**；失败 nack/requeue。

```typescript
// extensions/message-sdk/src/ingress/deferred-delivery-ack.ts
// requireReply=true → 无 reply 则 nack(requeue)
// wrapReplyDeliver → publish 成功后 markReplyPublished
// finalizeAfterDispatch → ack 或 nack
```

**建议**：其他支持 broker ACK 的通道（未来 RocketMQ 等）应复用此 helper，避免「先 ACK 后 reply」丢消息。

### 2.2 幂等

| 机制 | 范围 | 默认 |
|------|------|------|
| `createIdempotencyCache` | 单进程 TTL | mqtt/web-mqtt 60s；rabbitmq 可配置，**默认关闭** |
| `createPersistentDedupe` / `createClaimableDedupe` | 跨实例 | 需业务显式接入 |
| Stream entry ID / correlationId | 单条消息 | redis-stream / rabbitmq |

**生产建议**：多 Gateway 副本必须启用 **持久 dedup** 或依赖上游 messageId + 业务幂等。

### 2.3 keyed-run-queue

web-mqtt 入站按 `clientId` 串行，避免同一客户端并发 dispatch 压垮 Agent；跨 client 仍并行。

---

## 3. 分插件说明

### 3.1 RabbitMQ — 可企业试点

**可靠性事实**

- 入站：`deferredAck` — reply `publishMessage` await 成功后 ACK（`inbound.ts`）。
- 失败：dispatch/reply 异常 → `nack(requeueOnError)`；停止时 `nackAllPendingDeliveries(false)`。
- 重试：`retry` 队列 + TTL + DLX 回主 exchange；超过 `maxAttempts` 后 nack（**无独立 poison DLQ 队列名**）。
- 出站：`channel.publish` 返回 `false` 时 **throw**（背压）；**非 Publisher Confirm**。

**生产配置示例**

```json
{
  "channels": {
    "rabbitmq": {
      "url": "amqps://user:pass@rabbitmq.internal:5671",
      "exchange": "openclaw",
      "exchangeType": "topic",
      "topicPrefix": "openclaw",
      "subscribeTopics": [
        "devices.*.in",
        "openclaw.agent.*.in"
      ],
      "topicBindings": [
        {
          "topicPattern": "devices.*.in",
          "agentId": "iot-agent",
          "replyTopicPattern": "devices.${peerId}.out"
        }
      ],
      "consume": {
        "prefetch": 20,
        "concurrency": 4,
        "requeueOnError": true
      },
      "idempotency": {
        "enabled": true,
        "ttlMs": 600000,
        "maxEntries": 50000
      },
      "retry": {
        "enabled": true,
        "maxAttempts": 5,
        "delayMs": 30000
      },
      "dispatch": {
        "mode": "reply-pipeline",
        "reply": { "enabled": true },
        "timeoutMs": 120000
      }
    }
  }
}
```

**必须配置**

1. `subscribeTopics` **不得**包含 `*.out` / reply 模式，防自消费。
2. 生产开启 `idempotency.enabled`。
3. `requeueOnError: true` 时配合 retry + 监控 poison message；必要时在 RabbitMQ 侧建 DLQ binding。

**后续专项**：Publisher Confirm channel；显式 poison DLQ 队列。

---

### 3.2 Redis Stream — Stream 模式可企业试点；Pub/Sub 需文档约束

**Stream 模式**

- 处理成功 → `XACK`；失败 → 留在 PEL。
- **`pendingClaimIdleMs`**（默认 120s）：消费循环内 `XAUTOCLAIM` 回收 stale pending。
- 出站：`publishMessage` / `publishEntry` await。
- 自消费：`channel` 以 `:out` 结尾或 `openclaw:agent:outbound` 直接跳过。

**Pub/Sub 模式**

- **无 ACK**，at-most-once；空白名单 `PSUBSCRIBE *` 风险高。

**生产配置示例（Stream）**

```json
{
  "channels": {
    "redis-stream": {
      "url": "rediss://user:pass@redis.internal:6379",
      "channelMode": "stream",
      "subscribeChannels": ["openclaw:device:*:in"],
      "stream": {
        "inboundKey": "openclaw:inbound",
        "outboundKey": "openclaw:outbound",
        "consumerGroup": "openclaw-group",
        "consumerName": "openclaw-gw-${HOSTNAME}",
        "blockMs": 5000,
        "count": 10,
        "pendingClaimIdleMs": 120000,
        "createGroup": true
      },
      "channelBindings": [
        {
          "channelPattern": "openclaw:device:*:in",
          "agentId": "iot-agent",
          "replyChannel": "openclaw:device:${peerId}:out"
        }
      ]
    }
  }
}
```

**运维**：监控 PEL 长度（`XPENDING`）；多 consumer 使用不同 `consumerName`。

---

### 3.3 MQTT（内嵌 Aedes）— 可企业试点

**协议边界**：MQTT PUBACK 在 broker 收到 publish 时即返回，**无法**延迟到 Agent 处理完成。

**插件保证**

- Agent reply：`publishMessage` **await** Aedes 回调。
- 自消费：server 侧 `client == null` 的 publish 不触发入站 handler。
- QoS0 软限制防 mailbox 膨胀；QoS1 出站有重试。

**生产配置示例**

```json
{
  "channels": {
    "mqtt": {
      "port": 8883,
      "tls": { "enabled": true, "certFile": "/certs/server.crt", "keyFile": "/certs/server.key" },
      "auth": { "enabled": true, "allowAnonymous": false, "users": [] },
      "subscribeTopics": ["devices/+/in", "openclaw/agent/+/in"],
      "topicBindings": [
        {
          "topicPattern": "devices/+/in",
          "agentId": "iot-agent",
          "replyTopic": "devices/${peerId}/out"
        }
      ],
      "qos0": { "mailboxSoftLimit": 200 },
      "persistence": {
        "enabled": true,
        "backend": "redis",
        "redis": { "host": "redis.internal", "port": 6379 }
      }
    }
  }
}
```

**建议**：入站 QoS1 + 业务幂等；关键链路优先 **RabbitMQ / Redis Stream**。

---

### 3.4 Web-MQTT — 协议限制需文档约束

与 mqtt 相同 PUBACK 限制；额外事实：

- 出站固定 **QoS 0**。
- 入站经 **per-clientId keyed 队列**串行 dispatch；错误经 `onError` 统计。
- 默认 `auth.required: true`（优于 mqtt 默认）。

**生产配置示例**

```json
{
  "channels": {
    "mqtt-ws": {
      "port": 8083,
      "path": "/mqtt",
      "auth": { "required": true, "allowAnonymous": false, "users": [] },
      "subscribeTopics": ["openclaw/agent/+/in"],
      "limits": { "maxPayloadBytes": 65536, "maxSubscriptionsPerClient": 20 },
      "ws": { "maxFrameSize": 1048576, "idleTimeoutMs": 60000 }
    }
  }
}
```

---

### 3.5 STOMP / Web-STOMP — 协议限制需文档约束

**入站 SEND**：嵌入 broker **无**应用级 deferred ACK；dispatch 失败仅日志，消息视为已路由。

**出站 MESSAGE**：`client` / `client-individual` ACK 模式 + prefetch；TCP stomp NACK 可 requeue；**web-stomp NACK 不重投**。

**隔离**：web-stomp 入站 `/queue/agent/*`，回复 `/topic/session.*`；TCP 依赖 `subscribeTopics` allowlist。

**生产配置示例（web-stomp）**

```json
{
  "channels": {
    "web-stomp": {
      "port": 15674,
      "path": "/ws",
      "subscribeTopics": ["/queue/agent/*"],
      "prefetchCount": 50,
      "heartbeat": { "incoming": 10000, "outgoing": 10000 }
    }
  }
}
```

**建议**：关键任务走 RabbitMQ；STOMP 用于浏览器/Spring 集成，客户端需实现幂等。

---

### 3.6 Gotify — 协议限制需文档约束

- 入站：WebSocket `/stream`；无 consumer ACK。
- 可靠性：backlog cursor 持久化 + 重连 replay；60s 内存 dedup；出站 REST + delivery retry。
- 自消费：`extras.openclaw.outbound` + `ownAppId` 过滤。

详见 [OpenClaw-Gotify-Guide_CN.md](./gotify/OpenClaw-Gotify-Guide_CN.md)。

**生产配置示例**

```json
{
  "channels": {
    "gotify": {
      "defaultAccount": "prod",
      "accounts": {
        "prod": {
          "serverUrl": "https://gotify.internal",
          "appToken": "${GOTIFY_APP_TOKEN}",
          "clientToken": "${GOTIFY_CLIENT_TOKEN}",
          "inbound": {
            "enabled": true,
            "allowedAppId": 1,
            "backlogReplay": { "enabled": true }
          }
        }
      }
    }
  }
}
```

---

## 4. 企业检查清单

### 4.1 可靠性

- [ ] 入站/出站 topic/channel/destination **物理分离**
- [ ] reply `deliver` 路径 **await** 且失败可向上抛出
- [ ] 有 broker ACK 的通道启用延迟 ACK（RabbitMQ / Redis Stream）
- [ ] 停止/重连策略已知（RabbitMQ pending nack；Redis PEL + XAUTOCLAIM）

### 4.2 幂等

- [ ] 上游提供 messageId / correlationId
- [ ] 多实例开启持久 dedup 或业务幂等表
- [ ] Agent 工具调用幂等

### 4.3 背压与并发

- [ ] RabbitMQ：`prefetch` ≥ `concurrency`
- [ ] Redis Stream：`count` 与 Agent 处理能力匹配
- [ ] MQTT QoS0 soft limit 已评估

### 4.4 可观测性

- [ ] 通道 stats HTTP（`/rabbitmq/stats`、`/mqtt/status` 等）
- [ ] 日志含 routingKey/topic/channel、ack/nack 原因
- [ ] 告警：PEL 增长、nack 率、dispatch 超时

### 4.5 测试

- [ ] 单元：`deferred-ack`、`outbound` await、config 解析
- [ ] 集成：Docker RabbitMQ / Redis / MQTT test client
- [ ] 混沌：kill Gateway 后 PEL / pending 恢复

---

## 5. 选型建议

| 场景 | 推荐 |
|------|------|
| 企业异步任务、需严格 at-least-once | **RabbitMQ** 或 **Redis Stream** |
| IoT 海量设备、低延迟 | **MQTT**（接受协议边界 + 幂等） |
| 浏览器/WebSocket | **web-mqtt** / **web-stomp**（非金融核心链路） |
| 移动端推送聚合 | **Gotify**（通知类，非事务消息） |

---

## 6. 相关文档

- [Redis Stream 指南](./redis-stream/OpenClaw-Redis-Stream-Guide_CN.md)
- [Gotify 指南](./gotify/OpenClaw-Gotify-Guide_CN.md)
- 各插件 `extensions/<name>/README.zh-CN.md` 中的 **企业级可靠性** 章节
- [message-sdk README](../extensions/message-sdk/README.zh-CN.md)

---

*文档版本：与 openclaw-plugins `feature/v2026-05-22` 分支实现同步。*
