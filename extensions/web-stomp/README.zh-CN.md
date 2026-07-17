# OpenClaw Web STOMP

面向 OpenClaw 2026.7.1 的 STOMP 1.2 over WebSocket/WSS 渠道插件。它接收经过认证的浏览器或服务端连接，将 `SEND` 帧路由到白名单内的 Agent，并通过 `MESSAGE` 帧返回该连接对应的 Agent 回复。

[English](README.md)

## 架构总览

```mermaid
flowchart LR
    Browser["浏览器 / Spring STOMP 客户端"]
    Guard["路径 + Origin + 连接容量"]
    WS["WS/WSS\n帧大小 + 出站背压"]
    Protocol["STOMP 1.2\n认证 + 心跳 + 速率限制"]
    Queue["每连接串行帧队列"]
    Route["Destination 路由\nAgent 白名单 + 会话隔离"]
    SDK["message-sdk\n解析 + 幂等 + Dispatch"]
    Agent["OpenClaw Agent"]
    Subscription["当前会话 Subscription\nMESSAGE + ACK 窗口"]

    Browser --> Guard --> WS --> Protocol --> Queue --> Route --> SDK --> Agent
    Agent --> SDK --> Subscription --> WS --> Browser
```

插件在单个 OpenClaw Gateway 进程内提供轻量 STOMP 接入层。每条 WebSocket 连接拥有独立会话 ID、串行帧队列、订阅集合和 ACK 窗口；连接断开或 Gateway 关闭时全部清理，不会把旧订阅泄漏给重连后的新会话。

## 能力边界

- 支持 STOMP 1.2 的 `CONNECT`、`SEND`、`SUBSCRIBE`、`UNSUBSCRIBE`、`ACK`、`NACK`、`DISCONNECT`
- 支持 WebSocket 和启用 TLS 的 WSS
- 支持 login/passcode 认证，凭证可来自环境变量或 SHA-256/SHA-512 哈希
- 支持 STOMP 心跳协商、连接/订阅限制、消息速率限制、帧大小限制和出站背压
- 支持浏览器 Origin 精确白名单
- 默认只允许订阅当前连接自己的回复主题，防止跨连接窃听
- 接入 OpenClaw Gateway 生命周期，并提供脱敏的 `/stomp/status` 状态接口

本插件是 OpenClaw 渠道适配器，不是持久化消息代理。订阅和待确认消息仅保存在内存中；`NACK` 只清理待确认状态，不会重投，也没有死信队列。若业务需要持久化队列、回放、事务或 Broker 集群，应使用 RabbitMQ 等专业消息代理。

声明 `content-length` 时，STOMP 1.2 body 可以包含 NUL，插件会按 UTF-8 字节长度寻找真正的帧终止符；未声明时第一个 NUL 表示帧结束。非法 header、未定义转义或错位帧边界会发送 `ERROR` 并关闭连接，避免后续帧在错误边界上继续执行。

## 配置

安全默认值为监听 `127.0.0.1:15674` 并强制认证；未配置任何用户凭证时会拒绝启动。非回环地址必须启用 WSS。

```json
{
  "channels": {
    "stomp": {
      "enabled": true,
      "host": "127.0.0.1",
      "wsPort": 15674,
      "path": "/ws",
      "defaultAgentId": "main",
      "allowedAgentIds": ["support"],
      "auth": {
        "required": true,
        "users": [
          {
            "login": "browser",
            "passwordEnv": "OPENCLAW_STOMP_PASSWORD"
          }
        ]
      },
      "heartbeat": {
        "serverMs": 10000,
        "clientMs": 10000
      },
      "limits": {
        "maxConnections": 500,
        "maxFrameSize": 262144,
        "maxBufferedBytes": 1048576,
        "maxSubscriptionsPerConnection": 100,
        "maxPendingMessages": 32,
        "maxPendingAcks": 100,
        "messagesPerMinute": 120,
        "connectTimeoutMs": 10000
      },
      "ws": {
        "allowedOrigins": ["https://console.example.com"]
      },
      "tls": {
        "enabled": false,
        "minVersion": "TLSv1.2"
      }
    }
  }
}
```

若监听器直接对外暴露，需要设置非回环 `host` 并配置 TLS：

```json
{
  "host": "0.0.0.0",
  "tls": {
    "enabled": true,
    "keyFile": "/etc/openclaw/tls/stomp.key",
    "certFile": "/etc/openclaw/tls/stomp.crt",
    "caFile": "/etc/openclaw/tls/ca.crt",
    "minVersion": "TLSv1.2"
  }
}
```

明文连接被有意限制在回环地址。若由反向代理终止 TLS，应让插件继续监听回环地址，再由代理转发 WSS。生产环境不要在配置中直接写 `password`，优先使用 `passwordEnv` 或 `passwordHash`。`allowedOrigins` 只接受规范化的 `http/https` Origin，不接受 `*`、路径、查询参数或片段；非浏览器客户端未发送 Origin 时不受浏览器白名单影响。

## Destination 流程

```mermaid
sequenceDiagram
    autonumber
    participant C as STOMP 客户端
    participant S as Web STOMP Server
    participant O as OpenClaw Agent
    C->>S: CONNECT(login, passcode, heart-beat)
    S-->>C: CONNECTED(session, heart-beat)
    C->>S: SUBSCRIBE 当前 session Topic + receipt
    S-->>C: RECEIPT
    C->>S: SEND /queue/agent.id + receipt
    S->>O: 串行 dispatchChannelMessage
    O-->>S: Agent 回复
    S-->>C: MESSAGE(ack id)
    S-->>C: SEND RECEIPT
    C->>S: ACK(ack id) + receipt
    S-->>C: ACK RECEIPT
```

`CONNECT` 成功后，服务端返回的 `CONNECTED` 帧包含动态生成的 `session` 头。假设其值为 `SESSION_ID`：

| 操作 | Destination | 含义 |
|---|---|---|
| 发送 | `/queue/agent` | 发送给 `defaultAgentId` |
| 发送 | `/queue/agent.support` | 发送给白名单 Agent `support` |
| 订阅 | `/topic/session.stomp:SESSION_ID@support` | 接收本连接的 `support` 回复 |

默认 `allowSharedTopics: false`，任何不属于当前连接 `stomp:SESSION_ID@...` 会话的订阅都会被拒绝。只有完全可信且确实需要共享主题的客户端才应显式开启 `allowSharedTopics`。

```javascript
import { Client } from "@stomp/stompjs";

const client = new Client({
  brokerURL: "wss://gateway.example.com/ws",
  connectHeaders: {
    login: "browser",
    passcode: "<injected-at-runtime>",
  },
  heartbeatIncoming: 10_000,
  heartbeatOutgoing: 10_000,
  onConnect(frame) {
    const sessionId = frame.headers.session;
    const destination = `/topic/session.stomp:${sessionId}@support`;

    client.subscribe(destination, (message) => {
      console.log(JSON.parse(message.body));
    }, { id: "support-replies", ack: "auto" });

    client.publish({
      destination: "/queue/agent.support",
      headers: { receipt: "request-1" },
      body: JSON.stringify({ text: "你好" }),
    });
  },
});

client.activate();
```

示例中的浏览器凭证只是占位符，不能硬编码到前端产物；应通过应用的安全启动流程注入短期或部署范围凭证。

`SEND` 的 `RECEIPT` 只会在 OpenClaw 成功接收入站派发后返回。使用 `client` 或 `client-individual` 确认模式时，应确认 `MESSAGE` 帧中的 `ack` 头。

## 失败与背压语义

```mermaid
flowchart TD
    F["收到 STOMP 帧"] --> V{"协议、认证、速率与 Destination 合法？"}
    V -- 否 --> E["ERROR；严重 framing 错误关闭连接"]
    V -- 是 --> Q{"连接队列有容量？"}
    Q -- 否 --> C1["1013 关闭：Inbound queue full"]
    Q -- 是 --> A["执行 Agent Turn"]
    A --> P{"订阅存在且出站缓冲/ACK 窗口可用？"}
    P -- 否 --> C2["1013 关闭或投递失败；不返回成功 RECEIPT"]
    P -- 是 --> M["发送 MESSAGE / RECEIPT"]
```

`auto` 模式在 MESSAGE 写入 WebSocket 后不保留确认状态；`client-individual` 逐条确认；`client` 会累计确认同一订阅中目标消息及之前的消息。达到 `maxPendingAcks` 或 `maxBufferedBytes` 时连接会以 1013 关闭，从源头限制慢消费者占用内存。

```mermaid
stateDiagram-v2
    [*] --> Sent: MESSAGE 写入 WebSocket
    Sent --> Done: auto
    Sent --> Pending: client / client-individual
    Pending --> Done: ACK
    Pending --> Dropped: NACK
    Pending --> Dropped: 连接断开 / Gateway 停机
    note right of Pending
      client 按单调投递序号累计确认
      目标消息及之前消息；不使用毫秒
      时间戳，避免同毫秒误确认后续消息
    end note
```

`NACK` 的 `Dropped` 是本插件的明确边界：只释放内存 ACK 状态，不自动重投。需要重投/DLQ 时应使用真正的 Broker。

## 生产运维

- 收紧 `allowedAgentIds`；客户端无法访问不在名单中的 Agent。
- 浏览器场景必须配置 Origin 白名单，并在入口层增加网络访问控制。
- 监控 `/stomp/status`；接口提供连接/订阅/待处理帧/待 ACK 数量，以及连接拒绝、认证失败、协议错误和入出站丢弃计数，并返回脱敏配置。
- 压测前按真实负载设置帧、队列、待确认消息和连接上限。
- Gateway 重启会断开全部 WebSocket 会话，并清空订阅和待确认状态。

## 开发验证

```bash
pnpm --filter @partme.ai/openclaw-web-stomp typecheck
pnpm --filter @partme.ai/openclaw-web-stomp test
pnpm --filter @partme.ai/openclaw-web-stomp build
```

2026-07-17 本地门禁：12 个测试文件、74 个测试通过，typecheck/build 通过；其中包含同一毫秒多条投递的累计 ACK 顺序回归。

许可证：MIT。
