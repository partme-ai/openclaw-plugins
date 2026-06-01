# 设计方案：四插件对齐 OpenClaw WebSocket 通信协议与鉴权机制

> **日期**：2026-05-28  
> **作者**：OpenClaw 开发工程师  
> **状态**：📋 方案设计

---

## 1. 目标

让 **stomp / mqtt / web-stomp / web-mqtt** 四个插件的外部客户端连接统一走 **OpenClaw Gateway WS 协议**（`req/res/event` 帧格式 + `connect.challenge` → `connect` → `hello-ok` 握手），实现：

1. **统一鉴权**：外部客户端必须通过 Gateway 的 token/password 认证才能使用 STOMP/MQTT 服务
2. **统一身份**：客户端以 `client.id` + `role` + `scopes` 标识，而非协议原生 clientId
3. **统一帧格式**：连接建立后，所有通信走 `{ type: "req" }` / `{ type: "res" }` / `{ type: "event" }`

---

## 2. OpenClaw Gateway WS 协议参考

### 2.1 握手流程

```
Client                                    Server (Gateway)
  │                                          │
  │──── WS/TCP 连接建立 ────────────────────→│
  │                                          │
  │←─── event: connect.challenge ────────────│  { nonce, ts }
  │                                          │
  │──── req: connect ───────────────────────→│  { client, auth, role, scopes }
  │                                          │
  │←─── res: hello-ok ──────────────────────│  { protocol, features, auth, policy }
  │                                          │
  │──── req: <method> ──────────────────────→│  正常 RPC 调用
  │←─── res: <method-response> ─────────────│
```

### 2.2 帧格式

```typescript
// Request（客户端 → 服务端）
interface RequestFrame {
  type: "req";
  id: string;           // UUID，用于响应关联
  method: string;       // 方法名
  params?: unknown;     // 方法参数
}

// Response（服务端 → 客户端）
interface ResponseFrame {
  type: "res";
  id: string;           // 对应 Request 的 id
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown };
}

// Event（服务端 → 客户端，推送）
interface EventFrame {
  type: "event";
  event: string;        // 事件名
  payload?: unknown;
  seq?: number;
}
```

### 2.3 ConnectParams

```typescript
interface ConnectParams {
  minProtocol: number;        // 客户端支持的最低协议版本
  maxProtocol: number;        // 客户端支持的最高协议版本
  client: {
    id: string;               // 客户端身份（如 "gateway-client"）
    displayName?: string;
    version: string;
    platform: string;
    deviceFamily?: string;
    mode: string;             // "webchat" | "cli" | "ui" | "backend" | "node"
    instanceId?: string;
  };
  auth?: {
    token?: string;           // Gateway token
    password?: string;        // Gateway password
    deviceToken?: string;
  };
  role?: string;              // "operator" | "node" | "backend"
  scopes?: string[];          // 权限范围
}
```

### 2.4 HelloOk 响应

```typescript
interface HelloOk {
  type: "hello-ok";
  protocol: number;
  server: { version: string; connId: string };
  features: { methods: string[]; events: string[] };
  snapshot: unknown;          // Gateway 状态快照
  auth: { role: string; scopes: string[] };
  policy: { maxPayload: number; maxBufferedBytes: number; tickIntervalMs: number };
}
```

---

## 3. 新架构设计

### 3.1 核心思路

**协议分层**：在 STOMP/MQTT 协议层之上叠加 Gateway WS 帧层。

```
外部客户端
  ↓ Gateway WS 帧层 (req/res/event + connect 握手 + auth)
  ↓ [握手完成后的 req 帧，其 params 中携带 STOMP/MQTT 语义]
插件内嵌 Server
  ↓ message-sdk BridgePluginRuntime
OpenClaw Gateway
```

### 3.2 通信载体统一

四个插件 **共享同一个传输层实现**（从 message-sdk 或新建 `transport-gateway-ws` 包提供）：

```typescript
// 通用 Gateway WS 传输层
interface GatewayWsTransport {
  // 启动 WS/TCP 服务端
  start(config: TransportConfig, handlers: TransportHandlers): Promise<void>;
  stop(): Promise<void>;

  // 向指定客户端推送 event
  broadcastEvent(event: string, payload: unknown): void;
  sendEvent(connId: string, event: string, payload: unknown): void;

  // 连接管理
  getConnections(): ConnectionInfo[];
}
```

### 3.3 握手流程（四个插件统一）

```
外部 STOMP/MQTT 客户端
  │
  │──── WS/TCP 连接 ────────────────────────→│
  │                                          │
  │←─── event: connect.challenge ────────────│  { nonce: <uuid>, ts: <ms> }
  │                                          │
  │──── req: connect ───────────────────────→│  {
  │                                          │    client: { id: "mqtt-device", mode: "backend",
  │                                          │              version: "1.0", platform: "embedded" },
  │                                          │    auth: { token: "<gateway-token>" },
  │                                          │    role: "backend",
  │                                          │    scopes: ["mqtt:pub", "mqtt:sub"]
  │                                          │  }
  │                                          │
  │←─── res: hello-ok ──────────────────────│  { protocol: 3, features: {...}, auth: {...} }
  │                                          │
  │  ──── 以下为协议语义帧 ────               │
  │                                          │
  │──── req: stomp.send ────────────────────→│  { destination: "/queue/agent.main",
  │                                          │    payload: "..." }
  │←─── res: stomp.send ────────────────────│  { ok: true }
  │                                          │
  │←─── event: stomp.message ───────────────│  { destination: "/topic/session.xxx",
  │                                          │    body: "Agent reply..." }
```

### 3.4 协议方法映射

#### STOMP → Gateway WS req method

| STOMP 命令 | Gateway WS method | params |
|------------|-------------------|--------|
| CONNECT/STOMP | `connect`（握手） | `ConnectParams` |
| SEND | `stomp.send` | `{ destination, body, headers? }` |
| SUBSCRIBE | `stomp.subscribe` | `{ id, destination, ack? }` |
| UNSUBSCRIBE | `stomp.unsubscribe` | `{ id }` |
| ACK | `stomp.ack` | `{ id }` |
| NACK | `stomp.nack` | `{ id }` |
| DISCONNECT | `stomp.disconnect` | `{ receipt? }` |

#### MQTT → Gateway WS req method

| MQTT 操作 | Gateway WS method | params |
|-----------|-------------------|--------|
| CONNECT | `connect`（握手） | `ConnectParams` |
| PUBLISH | `mqtt.publish` | `{ topic, payload, qos?, retain? }` |
| SUBSCRIBE | `mqtt.subscribe` | `{ topic, qos? }` |
| UNSUBSCRIBE | `mqtt.unsubscribe` | `{ topic }` |
| PINGREQ | （心跳，WS 层 ping/pong） | — |
| DISCONNECT | `mqtt.disconnect` | `{}` |

#### 服务端 → 客户端 event

| 事件名 | 用途 |
|--------|------|
| `stomp.message` | 推送 STOMP MESSAGE 到客户端 |
| `stomp.receipt` | 推送 RECEIPT 确认 |
| `stomp.error` | 推送 ERROR 帧 |
| `mqtt.message` | 推送 MQTT PUBLISH 到客户端 |
| `mqtt.puback` | QoS 1 确认 |
| `mqtt.suback` | 订阅确认 |
| `mqtt.unsuback` | 取消订阅确认 |

### 3.5 鉴权机制

#### 鉴权流程

```
1. WS/TCP 连接建立
2. Server 发送 connect.challenge（含 nonce + ts）
3. Client 发送 { type:"req", method:"connect", params: ConnectParams }
   - ConnectParams.auth.token 或 .password 携带 Gateway 凭据
   - ConnectParams.client.id = 客户端标识（如 "mqtt-device-001"）
   - ConnectParams.role = "backend"（MQ/STOMP 客户端默认角色）
4. Server 校验凭据（复用 Gateway auth 逻辑）
   - token 模式：比对接入 token
   - password 模式：比对密码
   - 可选：Tailscale 本地信任
5. 成功 → hello-ok（含 role、scopes、policy）
   失败 → 错误响应 + 关闭连接
```

#### 鉴权策略

```typescript
// 插件配置中的 auth 块
interface GatewayAuthConfig {
  mode: "gateway-token" | "gateway-password" | "local-trust";
  
  // gateway-token 模式：客户端必须提供 Gateway token
  gatewayToken?: string;          // 共享 token（所有客户端使用同一个）
  
  // gateway-password 模式：客户端必须提供 Gateway 密码
  // 密码从 Gateway 配置中自动获取
  
  // local-trust 模式：仅允许本地回环连接，免认证
  // 适用于开发环境或受信任的内网
}
```

### 3.6 客户端身份注册

新增 MQ/STOMP 专用客户端身份：

```typescript
// 扩展 GatewayClientId
GATEWAY_CLIENT_IDS = {
  // ... 现有 ...
  MQTT_DEVICE: "mqtt-device",       // MQTT 设备客户端
  STOMP_CLIENT: "stomp-client",     // STOMP 客户端
}

// 扩展 GatewayClientMode  
GATEWAY_CLIENT_MODES = {
  // ... 现有 ...
  DEVICE: "device",                 // 设备连接模式
}
```

> ⚠️ 这部分需要在上游 OpenClaw 中注册，或通过插件动态扩展。如果上游不支持动态扩展，可先用 `backend` 模式。

---

## 4. 实现计划

### 4.1 Phase 1：抽取通用 Gateway WS 传输层

在 `message-sdk` 中新增 `gateway-ws-transport` 模块：

```
message-sdk/src/
  gateway-ws/
    transport.ts          # 通用 WS/TCP Server + 帧协议
    handshake.ts          # connect.challenge → connect → hello-ok 握手
    auth.ts               # Gateway token/password 鉴权
    frame-codec.ts        # req/res/event 帧编解码
    connection-manager.ts # 连接生命周期管理
    method-router.ts      # method → handler 路由
```

核心接口：

```typescript
// gateway-ws/transport.ts

export interface GatewayWsServerConfig {
  port: number;
  host?: string;
  path?: string;                    // WS 路径（仅 web-* 插件）
  tls?: {
    enabled: boolean;
    certFile?: string;
    keyFile?: string;
    caFile?: string;
  };
  auth: {
    mode: "gateway-token" | "gateway-password" | "local-trust";
    /** 从 Gateway 配置中读取的 token/password */
    gatewayToken?: string;
    gatewayPassword?: string;
  };
  limits: {
    maxPayload: number;             // 最大帧大小
    maxConnections: number;
    handshakeTimeoutMs: number;
  };
}

export interface GatewayWsMethodHandlers {
  [method: string]: (ctx: {
    connId: string;
    client: ClientInfo;
    params: unknown;
    respond: (ok: boolean, payload?: unknown, error?: ErrorShape) => void;
    sendEvent: (event: string, payload: unknown) => void;
  }) => void | Promise<void>;
}

export interface GatewayWsEventMap {
  onClientConnect?: (connId: string, client: ClientInfo) => void;
  onClientDisconnect?: (connId: string, client: ClientInfo) => void;
  onError?: (connId: string, error: Error) => void;
}

export class GatewayWsTransport {
  constructor(
    config: GatewayWsServerConfig,
    handlers: GatewayWsMethodHandlers,
    events: GatewayWsEventMap,
  );
  start(): Promise<void>;
  stop(): Promise<void>;
  sendEvent(connId: string, event: string, payload: unknown): void;
  broadcastEvent(event: string, payload: unknown): void;
  getConnections(): ConnectionInfo[];
}
```

### 4.2 Phase 2：改造四个插件

每个插件的 `transport/server.ts` 替换为使用 `GatewayWsTransport`：

```typescript
// 示例：web-mqtt/src/transport/server.ts（改造后）

import { GatewayWsTransport } from "@partme.ai/openclaw-message-sdk/gateway-ws";

const transport = new GatewayWsTransport(config, {
  // 握手由 transport 自动处理

  "mqtt.publish": async ({ connId, client, params, respond }) => {
    // 已认证的客户端发送 MQTT publish
    const { topic, payload } = params as { topic: string; payload: string };
    await onInbound({ clientId: client.id, topic, payload });
    respond(true, { ok: true });
  },

  "mqtt.subscribe": async ({ connId, client, params, respond }) => {
    const { topic, qos } = params as { topic: string; qos?: number };
    addSubscription(connId, topic, qos);
    respond(true, { ok: true });
  },

  "mqtt.unsubscribe": async ({ connId, params, respond }) => {
    const { topic } = params as { topic: string };
    removeSubscription(connId, topic);
    respond(true, { ok: true });
  },

  "mqtt.disconnect": async ({ connId, respond }) => {
    cleanupConnection(connId);
    respond(true);
  },
}, {
  onClientConnect: (connId, client) => { /* ... */ },
  onClientDisconnect: (connId) => { cleanupConnection(connId); },
});
```

### 4.3 Phase 3：出站推送统一

Agent 回复通过 `transport.sendEvent` 推送：

```typescript
// inbound.ts 中 reply.deliver 回调
reply: {
  deliver: async ({ wire }) => {
    // 不再直接 publish STOMP/MQTT 帧
    // 而是通过 Gateway WS event 推送
    transport.sendEvent(connId, "mqtt.message", {
      topic: replyTopic,
      payload: wire,
      qos: 0,
    });
  },
}
```

### 4.4 Phase 4：TCP 传输支持

对于 `stomp`（TCP）和 `mqtt`（TCP）插件，需要在 TCP 层上实现相同的帧协议：

```
TCP Socket 连接
  ↓
帧分隔（\n 或 length-prefix）
  ↓
JSON 解析 → RequestFrame / ResponseFrame / EventFrame
```

TCP 变体使用换行符分隔的 JSON 帧（与 WebSocket 的 JSON 帧格式一致，只是传输层不同）：

```
{"type":"event","event":"connect.challenge","payload":{"nonce":"...","ts":...}}\n
{"type":"req","id":"...","method":"connect","params":{...}}\n
{"type":"res","id":"...","ok":true,"payload":{...}}\n
```

---

## 5. 改造前后对比

### 5.1 通信载体

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 帧格式 | STOMP 帧 / MQTT 包 | 统一 `req/res/event` JSON 帧 |
| 握手 | 协议原生（STOMP CONNECT / MQTT CONNECT） | Gateway WS 握手（connect.challenge → hello-ok） |
| 认证 | 各自 username/password | Gateway token/password + role/scopes |
| 客户端身份 | clientId (string) | 结构化 `ClientInfo`（id, mode, role, scopes） |
| 出站推送 | publishToDestination / publishMessage | `transport.sendEvent(connId, ...)` |
| 传输实现 | 各自实现 | 共享 `GatewayWsTransport` |

### 5.2 代码结构

```
改造前：
  stomp/transport/server.ts     → 自实现 STOMP TCP Server + 帧解析
  mqtt/transport/server.ts      → Aedes broker + TCP/TLS
  web-stomp/transport/server.ts → ws + STOMP 帧解析
  web-mqtt/transport/server.ts  → ws + Aedes broker

改造后：
  message-sdk/gateway-ws/       → 通用 Gateway WS Transport（鉴权+帧+路由）
  stomp/transport/server.ts     → GatewayWsTransport + STOMP method handlers
  mqtt/transport/server.ts      → GatewayWsTransport + MQTT method handlers
  web-stomp/transport/server.ts → GatewayWsTransport({ ws: true }) + STOMP method handlers
  web-mqtt/transport/server.ts  → GatewayWsTransport({ ws: true }) + MQTT method handlers
```

---

## 6. 兼容性考虑

### 6.1 向后兼容

- **Phase A（推荐先做）**：新客户端使用 Gateway WS 协议，旧客户端可通过配置回退到原生协议
- **Phase B（长期）**：完全移除原生协议支持

### 6.2 客户端 SDK

改造后需要提供对应的客户端 SDK，方便外部系统接入：

```typescript
// @partme.ai/openclaw-mqtt-client
const client = new OpenClawMqttClient({
  url: "ws://gateway:15675/mqtt",
  auth: { token: "<gateway-token>" },
  client: { id: "device-001", platform: "embedded" },
});

await client.connect();
await client.publish("sensor/temperature", '{"value": 23.5}');
client.subscribe("command/+", (msg) => { /* ... */ });
```

---

## 7. 工作量估算

| 阶段 | 内容 | 工作量 |
|------|------|--------|
| Phase 1 | message-sdk 新增 `gateway-ws` 模块（transport + handshake + auth + frame-codec） | 3-4 天 |
| Phase 2 | 改造 web-stomp（WS 传输，最简单）作为原型验证 | 1-2 天 |
| Phase 3 | 改造 web-mqtt（WS + Aedes 集成） | 1-2 天 |
| Phase 4 | 改造 stomp（TCP 传输适配） | 1-2 天 |
| Phase 5 | 改造 mqtt（TCP + Aedes 适配） | 1-2 天 |
| Phase 6 | 测试 + 文档 + 客户端 SDK | 2-3 天 |
| **合计** | | **9-15 天** |

---

## 8. 风险与决策点

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 现有 STOMP/MQTT 客户端不兼容 | 客户端需要升级 | 提供过渡期双协议支持 |
| TCP 传输需实现帧分隔 | 与 WS 传输实现有差异 | 抽取 `FrameTransport` 抽象层 |
| Aedes 集成复杂度 | MQTT 的 QoS/retain 等语义需映射到 Gateway 帧 | Phase 3 详细设计 |

### 需要决策

1. **是否需要向后兼容？** — 是否允许只支持新协议，还是需要双协议过渡期？
2. **MQTT QoS/retain 语义如何映射？** — 是在 req method params 中传递，还是简化为 fire-and-forget？
3. **TCP 传输是否也改造？** — 还是先只改造 WS 变体（web-stomp、web-mqtt），TCP 变体后续再做？

---

_方案设计完成，等待大龙确认方向和决策点。_
