# @partme.ai/openclaw-web-socket

OpenClaw **WebSocket** channel plugin — uses [`ws`](https://github.com/websockets/ws) as **client** and/or **server**.

## 运行模式

[`ws`](https://github.com/websockets/ws) 同时提供：

- **`WebSocket`** — Node.js 作为客户端连外部 `ws://` / `wss://`
- **`WebSocketServer`** — 内嵌 WebSocket 服务，等待外部连接

本插件通过 `channels.web-socket.mode` 选择：

| mode | 说明 |
|------|------|
| `server` | **服务端模式**（默认）：Gateway 内置 WS，客户方连进来，智能体经同一 socket 回复 |
| `client` | **客户端模式**：OpenClaw 作为 WS 客户端连到**外部** WS 服务，在外部网关里与终端用户通信 |
| `both` | **双模式**：同时启动内置服务 + 连外部 WS（例如本地调试 + 生产桥接） |

```mermaid
flowchart LR
  subgraph server_mode [server 模式]
    C1[客户 App] -->|WS 入站| S1[OpenClaw 内置 WS]
    S1 --> A1[Agent]
    A1 --> S1
    S1 -->|WS 回复| C1
  end

  subgraph client_mode [client 模式]
    A2[Agent] --> OC[OpenClaw WS Client]
    OC <-->|WS| EXT[外部 WS 网关]
    EXT <--> C2[客户 App]
  end
```

## Features

- Embedded `WebSocketServer`（`server` / `both`）
- Outbound `WebSocket` client with reconnect（`client` / `both`）
- Inbound via `@partme.ai/openclaw-message-sdk`
- Session ↔ connection mapping
- Optional token auth（server 入站 / client 出站）
- HTTP status: `GET /web-socket/status`

## Client protocol

**Connect (server mode)** → server sends:

```json
{ "type": "connected", "connectionId": "<uuid>" }
```

**Send message:**

```json
{
  "type": "message",
  "text": "Hello",
  "agentId": "optional",
  "messageId": "optional",
  "peerId": "optional-user-id"
}
```

`peerId` / `userId` / `from` 用于 **client 模式**下外部网关在同一连接上区分多个终端用户。

Plain text (non-JSON) is also accepted as the message body.

## Configuration (`channels.web-socket`)

### 服务端模式（默认）

```json
{
  "channels": {
    "web-socket": {
      "mode": "server",
      "wsPort": 18789,
      "path": "/openclaw/ws",
      "defaultAgentId": "your-agent-id",
      "auth": { "enabled": false }
    }
  }
}
```

### 客户端模式（连外部 WS）

```json
{
  "channels": {
    "web-socket": {
      "mode": "client",
      "url": "wss://your-gateway.example.com/ws/openclaw",
      "clientToken": "shared-secret",
      "clientId": "openclaw-bridge",
      "defaultAgentId": "your-agent-id",
      "client": {
        "reconnect": { "enabled": true, "initialDelayMs": 1000, "maxDelayMs": 30000 }
      }
    }
  }
}
```

### 双模式

```json
{
  "channels": {
    "web-socket": {
      "mode": "both",
      "url": "wss://prod-gateway/ws",
      "wsPort": 18789,
      "path": "/openclaw/ws",
      "defaultAgentId": "your-agent-id"
    }
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `mode` | `server` | `client` / `server` / `both` |
| `url` | — | 外部 WS 地址（client/both 必填） |
| `wsPort` | `18789` | 内置服务端口（server/both） |
| `path` | `/openclaw/ws` | 内置服务路径 |
| `defaultAgentId` | — | 默认 Agent |
| `clientId` | `openclaw-client` | client 模式下的 peer 前缀 |
| `clientToken` | — | 连外部 WS 的 Bearer / query token |
| `auth.*` | — | 内置服务入站认证 |

## Build

```bash
cd extensions/web-socket
pnpm install
pnpm build
pnpm test
```

## Related

- `extensions/mqtt` — embedded MQTT broker
- `extensions/web-mqtt` — MQTT over WebSocket
- `extensions/web-stomp` — STOMP over WebSocket
