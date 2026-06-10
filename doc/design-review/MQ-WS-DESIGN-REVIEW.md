# 设计审查：stomp / mqtt / web-stomp / web-mqtt 四插件与 OpenClaw WebSocket 机制对齐

> **日期**：2026-05-28  
> **审查人**：OpenClaw 开发工程师  
> **状态**：🔍 审查中 → 待决策

---

## 1. OpenClaw Gateway WebSocket 机制总结

### 1.1 协议帧格式

OpenClaw Gateway WS 协议（`PROTOCOL_VERSION = 3`）使用 **三帧类型**：

| 帧类型 | `type` 字段 | 方向 | 用途 |
|--------|------------|------|------|
| **Request** | `"req"` | Client → Server | RPC 调用（如 `chat.send`、`sessions.list`） |
| **Response** | `"res"` | Server → Client | RPC 响应 |
| **Event** | `"event"` | Server → Client | 推送通知（如 `tick`、`shutdown`、`presence`） |

```json
// Request Frame
{ "type": "req", "id": "<uuid>", "method": "chat.send", "params": { ... } }

// Response Frame
{ "type": "res", "id": "<uuid>", "ok": true, "payload": { ... }, "error": null }

// Event Frame
{ "type": "event", "event": "tick", "payload": { ... }, "seq": 1 }
```

### 1.2 握手流程

1. **TCP/WS 连接建立** → Gateway 发送 `connect.challenge` 事件（含 nonce + ts）
2. **Client 发送 `connect` request** — 包含：
   - `minProtocol` / `maxProtocol`（协议版本协商）
   - `client`：`{ id, version, platform, mode }`（客户端身份，如 `webchat-ui`、`cli`、`backend`）
   - `auth`：`{ token, password, deviceToken }`（认证）
   - `role`：`operator` / `node` / `backend`
   - `scopes`：权限范围
3. **Server 响应 `hello-ok`** — 包含：
   - `protocol`：协商后的协议版本
   - `server`：`{ version, connId }`
   - `features`：`{ methods: [...], events: [...] }`
   - `snapshot`：Gateway 状态快照
   - `auth`：`{ role, scopes }`
   - `policy`：`{ maxPayload, maxBufferedBytes, tickIntervalMs }`

### 1.3 核心方法（与消息通信相关）

| 方法 | 用途 |
|------|------|
| `chat.send` | 发送消息到指定 session，触发 Agent 运行 |
| `chat.history` | 获取会话历史 |
| `chat.abort` | 中止当前运行 |
| `sessions.send` | 跨会话消息投递 |
| `sessions.list` | 列出活跃会话 |
| `send` | 向外部渠道发送消息（出站） |

### 1.4 客户端身份

```typescript
GATEWAY_CLIENT_IDS = {
  WEBCHAT_UI: "webchat-ui",
  CONTROL_UI: "openclaw-control-ui",
  TUI: "openclaw-tui",
  CLI: "cli",
  GATEWAY_CLIENT: "gateway-client",
  NODE_HOST: "node-host",
  // ...
}

GATEWAY_CLIENT_MODES = {
  WEBCHAT: "webchat",
  CLI: "cli",
  UI: "ui",
  BACKEND: "backend",
  NODE: "node",
}
```

### 1.5 关键设计特征

- **单一 WS 端口**：Gateway 只开一个 WS 端口（默认 3001），所有客户端类型复用
- **统一帧协议**：不论 webchat、TUI、CLI 还是 node，都走相同的 `req/res/event` 协议
- **身份区分在 connect 握手中**：通过 `client.id` + `client.mode` + `role` 区分
- **消息通过 `chat.send` 方法**：入站消息通过 `chat.send` 触发 Agent；出站通过 reply pipeline 回调

---

## 2. 四个插件当前架构对比

### 2.1 架构一览

| 维度 | stomp (TCP) | mqtt (TCP) | web-stomp (WS) | web-mqtt (WS) |
|------|-------------|------------|----------------|---------------|
| **传输层** | TCP/TLS Socket | TCP/TLS + Aedes | WebSocket Server | WebSocket + Aedes |
| **协议** | STOMP 1.0/1.1/1.2 | MQTT 3.1.1/5.0 | STOMP over WS | MQTT over WS |
| **端口** | 61613 | 1883 | 15674 | 15675 |
| **channel ID** | `stomp-tcp` | `mqtt` | `stomp` | `mqtt-ws` |
| **Broker** | 无（自实现帧解析） | Aedes（内嵌） | 无（自实现帧解析） | Aedes（内嵌） |
| **入站路径** | Wire → `normalizeWireIngress` → `dispatchChannelMessage` | Wire → `normalizeWireIngress` → `dispatchChannelMessage` | Wire → `normalizeWireIngress` → `dispatchChannelMessage` | Wire → `normalizeWireIngress` → `dispatchChannelMessage` |
| **出站路径** | `publishToDestination` (STOMP MESSAGE) | `publishMessage` (MQTT PUBLISH) | `publishToDestination` (STOMP MESSAGE) | `publishToTopic` (MQTT PUBLISH) |

### 2.2 共同架构模式

四个插件 **均采用相同的通信载体**：

```
外部客户端
  ↓ (STOMP/MQTT 协议帧)
内嵌 Server/Broker
  ↓ (InboundHandler 回调)
inbound.ts (normalizeWireIngress + dispatchChannelMessage)
  ↓ (message-sdk BridgePluginRuntime)
OpenClaw Gateway (channel.reply pipeline)
  ↓ (reply.deliver 回调)
outbound.ts → transport/server (STOMP/MQTT 协议帧)
  ↓
外部客户端
```

### 2.3 message-sdk 使用情况

四个插件 **共享相同的 message-sdk 桥接路径**：

| message-sdk 能力 | stomp | mqtt | web-stomp | web-mqtt |
|------------------|-------|------|-----------|----------|
| `normalizeWireIngress` | ✅ | ✅ | ✅ | ✅ |
| `dispatchChannelMessage` | ✅ | ✅ | ✅ | ✅ |
| `resolveChannelDispatchIdentity` | ✅ | ✅ | ✅ | ✅ |
| `BridgePluginRuntime` | ✅ | ✅ | ✅ | ✅ |
| `createIdempotencyCache` | ✅ | ✅ | ✅ | ✅ |

---

## 3. 核心问题：与 OpenClaw WebSocket 机制的差异

### 3.1 通信载体对比

| 维度 | OpenClaw WS | 四个插件 |
|------|-------------|----------|
| **帧格式** | `{ type: "req"/"res"/"event" }` JSON | STOMP 帧（命令+头+体+NUL）或 MQTT 包 |
| **握手** | `connect.challenge` → `connect` req → `hello-ok` res | 各协议原生握手（STOMP CONNECT/CONNECTED，MQTT CONNECT/CONNACK） |
| **认证** | Gateway token/password，在 connect 握手中 | 各协议原生认证（STOMP login/passcode，MQTT username/password） |
| **消息发送** | `chat.send` RPC 方法 | 直接入队 → `dispatchChannelMessage` |
| **消息接收** | Event 推送或 `poll` | reply pipeline 回调 → 协议帧发布 |
| **身份** | `client.id` + `client.mode` + `role` | clientId / login (协议原生) |
| **端口** | 单端口（3001） | 各自独立端口 |

### 3.2 关键差异分析

#### ✅ 已对齐的方面

1. **入站分发路径统一**：四个插件都通过 message-sdk `dispatchChannelMessage` → `BridgePluginRuntime` → OpenClaw reply pipeline，这已经是正确的对齐。
2. **Wire 消息格式**：四个插件都支持 `normalizeWireIngress` + `UnifiedMessage`，payload 解析模式一致。
3. **reply pipeline**：出站回复都通过 `reply.deliver` 回调，由插件层负责协议帧编码。

#### ⚠️ 差异与潜在问题

**1. 握手/认证流程各自独立**

- OpenClaw WS 有 `connect.challenge` + nonce + token 校验的完整握手
- 四个插件直接使用协议原生握手（STOMP CONNECT / MQTT CONNECT），不经过 Gateway 的认证链
- **影响**：安全模型不一致。Gateway 的 auth rate limiter、session generation 等安全机制无法覆盖这四个通道

**2. 身份模型不一致**

- OpenClaw WS 使用结构化的 `ConnectParams`（含 `client.id`、`client.mode`、`role`、`scopes`）
- 四个插件使用协议原生 clientId，没有 role/scopes 概念
- **影响**：无法在 Gateway 层面做基于角色的访问控制

**3. 独立端口 vs 共享端口**

- OpenClaw WS 只开一个端口，通过帧路由分发
- 四个插件各自开独立端口（61613、1883、15674、15675）
- **影响**：端口管理复杂，防火墙规则多

**4. 协议帧 vs Gateway 帧格式**

- 外部客户端发的是 STOMP/MQTT 原生帧，不是 Gateway `{ type: "req" }` JSON 帧
- **这是本质差异**：四个插件作为协议适配层，本身就是要把 STOMP/MQTT 帧翻译成 Gateway 能理解的调用

---

## 4. 设计审查结论

### 4.1 核心洞察

> **四个插件的定位是「协议适配器/翻译层」，不是「Gateway WS 客户端」。**

它们与 OpenClaw 的关系是：
```
外部 STOMP/MQTT 客户端
  ↕ (协议原生帧)
插件内嵌 Server/Broker  ← 协议适配层
  ↕ (message-sdk BridgePluginRuntime)
OpenClaw Gateway (channel.reply pipeline)
```

而不是：
```
外部客户端
  ↕ (Gateway WS req/res/event 帧)
OpenClaw Gateway WS Server
```

### 4.2 审查结论

**通信载体在 message-sdk 层面已经对齐。** 四个插件共享：
- 相同的 `BridgePluginRuntime` 接口
- 相同的 `normalizeWireIngress` → `dispatchChannelMessage` 入站路径
- 相同的 `reply.deliver` 出站回调模式

**协议差异是预期内的：** STOMP/MQTT 是面向外部系统的通信协议，不需要也无法使用 Gateway 的 `req/res/event` JSON 帧格式。这是「翻译层」的设计正确性。

### 4.3 可优化点

虽然没有结构性问题，但有 **统一优化机会**：

#### A. 共享传输抽象（推荐）

当前四个插件的 transport 层各自实现，但存在大量重复逻辑：

| 可共享的能力 | stomp | web-stomp | mqtt | web-mqtt |
|-------------|-------|-----------|------|----------|
| 连接生命周期管理 | 自实现 | 自实现 | Aedes | Aedes |
| 认证守卫 | 自实现 | 自实现 | Aedes hook | Aedes hook |
| 订阅管理 | 自实现 | 自实现 | Aedes | Aedes |
| 帧解析/序列化 | 自实现 | 自实现 | Aedes | Aedes |
| 统计/可观测 | 各自定义 | 各自定义 | 各自定义 | 各自定义 |

**建议**：在 message-sdk 或新建 `transport-core` 包中抽取共享的：
1. **连接管理器**（connection lifecycle、maxConnections、idle timeout）
2. **认证守卫**（统一用户/密码校验、timing-safe compare）
3. **ACL 引擎**（topic pattern matching + per-user rules）
4. **统计/指标**（连接数、消息数、延迟等统一 metrics 接口）
5. **幂等缓存**（共享 TTL cache 实现）

#### B. 安全模型对齐（建议考虑）

当前四个插件各自实现认证，与 Gateway auth 体系完全独立。可选方案：
1. **方案 A（轻量）**：插件认证独立，但共享 Gateway 的 `auth` 配置块
2. **方案 B（深度）**：在 STOMP/MQTT CONNECT 时，以插件身份向 Gateway WS 发起内部认证请求

#### C. 配置结构统一（建议）

当前四个插件的 `configSchema` 结构差异较大，可统一：
1. `transport` 块：端口、TLS、路径（WebSocket 变体才有）
2. `auth` 块：认证模式、用户列表、ACL 规则
3. `routing` 块：subscribeTopics、topicBindings、payload mode
4. `limits` 块：maxPayload、maxConnections
5. `observability` 块：audit、metrics

---

## 5. 下一步建议

| 优先级 | 行动 | 工作量 |
|--------|------|--------|
| **P0** | 确认「通信载体对齐」的结论是否符合你的预期 | — |
| **P1** | 抽取共享传输抽象到 message-sdk 或独立包 | 2-3 天 |
| **P1** | 统一四个插件的 configSchema 结构模式 | 1 天 |
| **P2** | 安全模型对齐（与 Gateway auth 集成） | 需要决策方案 |
| **P2** | 共享统计/可观测接口 | 1 天 |

---

_审查完成，等待大龙确认方向。_
