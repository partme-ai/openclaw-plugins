# @partme.ai/openclaw-web-socket

<!-- README_STANDARD_START -->

> Standard reading order: positioning → architecture → flow → boundaries → installation → configuration → operations → deep dive.
> This block favors text diagrams that render reliably on npm; when applicable, deeper Mermaid diagrams remain in the repository's `doc/` design material.

[English](./README.md) | [简体中文](./README.zh-CN.md)

## 1. Component positioning

Provides a lightweight embedded WebSocket message endpoint. Component type: **Native WebSocket channel**.

| Item | Value |
|---|---|
| npm package | `@partme.ai/openclaw-web-socket` |
| Version | `2026.7.1` |
| Plugin ID | `web-socket` |
| Channel ID | `web-socket` |
| OpenClaw | `>=2026.7.1` |
| Source | `extensions/web-socket` |

## 2. At a glance

```text
[WebSocket JSON/text clients]
          │
          ▼
┌──────────────────────────────────────────────────────────────┐
│ Inside OpenClaw Gateway: web-socket
│ 1. Authenticate, limit connections, and parse protocol
│ 2. Map sessions and enter the Agent
│ 3. Route responses back to connections
└──────────────────────────────────────────────────────────────┘
          │
          ▼
[WebSocket messages and connection state]
```

## 3. Architecture and core flow

The component keeps protocol and platform differences inside its own boundary and exposes stable plugin, channel, hook, tool, or service contracts to OpenClaw.

```text
WebSocket JSON/text clients
  │
  ▼
Authenticate, limit connections, and parse protocol
  │
  ▼
Map sessions and enter the Agent
  │
  ▼
Route responses back to connections
  │
  ▼
WebSocket messages and connection state

Failure path: Any failed stage: record a diagnosable error, then retry, reject, or degrade per component policy
```

## 4. Capabilities and boundaries

| Area | Contract |
|---|---|
| Owns | Provides a lightweight embedded WebSocket message endpoint |
| Does not own | Does not provide cross-node connection sharing or Socket.IO compatibility |
| Input | WebSocket JSON/text clients |
| Output | WebSocket messages and connection state |
| Failure rule | Failures remain observable; authentication, boundary validation, and persistence failures must not be reported as success |

## 5. Quick start

```bash
openclaw plugins install "@partme.ai/openclaw-web-socket@2026.7.1"
```

Start with least-privilege configuration, then launch the Gateway. Validate connectivity, authorization, and recovery in an isolated profile before production use.

## 6. Configuration entry points

| Layer | Path |
|---|---|
| Plugin configuration | `plugins.entries.web-socket.config` |
| Channel configuration | `channels["web-socket"]` |
| Configuration schema | `extensions/web-socket/openclaw.plugin.json` |

Field definitions, environment variables, and complete examples remain in the preserved detailed reference below.

## 7. Operations, security, and troubleshooting

- Confirm the OpenClaw version, package version, manifest ID, and configuration key first.
- Keep credentials in environment variables or SecretRef values, never in logs, source control, or plaintext examples.
- Diagnose by layer: Gateway logs, plugin health, then the external dependency.
- Back up state before upgrades; for cursors, queues, or indexes, verify restart recovery and duplicate-delivery semantics.

## 8. Verification and deep dives

```bash
pnpm --filter "@partme.ai/openclaw-web-socket" typecheck
pnpm --filter "@partme.ai/openclaw-web-socket" test
pnpm --filter "@partme.ai/openclaw-web-socket" build
```

- [Plugin architecture overview](../../doc/OpenClaw-Plugins-Architecture.md)
- [Unified plugin structure standard](../../doc/OpenClaw-Plugins-Structure-Standard.md)

## 9. Preserved detailed reference

The original configuration tables, protocol details, examples, and troubleshooting material continue below.

<!-- README_STANDARD_END -->


Production WebSocket channel for OpenClaw 2026.7.1+. It uses [`ws`](https://github.com/websockets/ws) as **client** and/or **server** and includes routing, session mapping, authentication, WSS, heartbeat, bounded queues, and backpressure.

> For the detailed architecture, message sequence, routing flowcharts, and Chinese operational guide, see [README.zh-CN.md](./README.zh-CN.md).

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

```text
┌──────────────────────────── OpenClaw Gateway ────────────────────────────┐
│  openclaw-web-socket                                                    │
│                                                                         │
│  Browser/App ─▶ Upgrade gate ─▶ Server transport ─┐                    │
│                  Path · Origin · Token · capacity │                    │
│                                                   ▼                    │
│  External WS gateway ◀──── Client transport ─▶ bounded per-socket FIFO │
│                         auth · reconnect          │                    │
│                                                   ▼                    │
│                         route → session → message-sdk → Agent           │
│                                                   │                    │
│  Browser/App or external gateway ◀── reply + accepted ─────────────────┘│
│                                                                         │
│  stop: reject new frames → drain Agent replies → close sockets         │
└─────────────────────────────────────────────────────────────────────────┘
```

The character view is intended for terminals and source review. The Mermaid graph below keeps the same server/client directions renderable and maintainable.

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
- HTTP upgrade 阶段的 Bearer token 鉴权（server 入站 / client 出站）
- Browser-safe subprotocol token authentication without putting credentials in the URL
- Native WSS listener with configurable certificate, CA and minimum TLS version
- Origin 白名单、每连接速率限制、异步入站队列与出站背压保护
- Two-phase `messageId` dedupe: claim before dispatch, commit only after reply delivery, release on failure
- Outbound adapter failures throw so a Router outbox can retry or dead-letter them instead of accepting a placeholder message ID
- WebSocket ping/pong 心跳、连接超时、指数退避重连与可等待停机
- Reply/accepted/outbound writes wait for the `ws.send` callback and fail within a configured timeout
- HTTP status: `GET /web-socket/status`

## Client protocol

**Connect (server mode)** → server sends:

```json
{ "version": "1", "type": "connected", "connectionId": "<uuid>" }
```

**Send message:**

```json
{
  "version": "1",
  "type": "message",
  "text": "Hello",
  "agentId": "optional",
  "messageId": "optional",
  "peerId": "optional-user-id"
}
```

`peerId` / `userId` / `from` 用于 **client 模式**下外部网关在同一连接上区分多个终端用户。

Plain text (non-JSON) is also accepted as the message body.

After the Agent pipeline and reply delivery complete, the server emits:

```json
{ "version": "1", "type": "accepted", "messageId": "optional" }
```

If dispatch or reply delivery fails, the `messageId` claim is released so the same message can be retried. Only a completed pipeline commits the dedupe record.

All structured outbound frames carry `version: "1"`. Explicit unsupported versions are rejected; unversioned JSON and plain text remain compatible with 0.1.x clients.

### Message completion path

```text
Caller        WS transport       bounded queue       OpenClaw       Agent
  │ message(m-1)   │                  │                  │             │
  ├───────────────▶├── enqueue ──────▶├── dispatch ─────▶├── turn ────▶│
  │                │                  │                  │◀── reply ───┤
  │◀── reply ──────┤◀─────────────────┴──────────────────┤             │
  │◀── accepted ───┤  only after Agent + reply delivery                 │
  │                │  failure: release(m-1) + error, no accepted        │
```

```mermaid
sequenceDiagram
  autonumber
  participant C as Caller / external gateway
  participant W as WebSocket transport
  participant Q as Per-connection queue
  participant O as OpenClaw Runtime
  participant A as Agent
  C->>W: message(version=1, messageId=m-1)
  W->>Q: validate + claim + enqueue
  Q->>O: dispatchChannelMessage
  O->>A: Agent Turn
  A-->>O: reply
  O-->>W: reply pipeline completed
  W-->>C: reply(version=1)
  W-->>C: accepted(version=1, messageId=m-1)
  Note over C,W: server and client modes use the same completion rule
```

### Browser authentication

Browsers cannot set an Authorization header on the native WebSocket API. Use the application protocol plus a Base64URL token protocol:

```js
const encoded = btoa(token).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const socket = new WebSocket(url, ["openclaw.v1", `openclaw.auth.${encoded}`]);
```

The server negotiates only `openclaw.v1`; the authentication protocol is never echoed as the selected application protocol.

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
        "reconnect": { "enabled": true, "initialDelayMs": 1000, "maxDelayMs": 30000, "jitterRatio": 0.2 }
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
| `allowFrameAgentId` | `false` | 是否信任客户端帧中的 `agentId`；生产默认关闭 |
| `clientId` | `openclaw-client` | client 模式下的 peer 前缀 |
| `host` | `127.0.0.1` | 内置服务监听地址；默认不暴露到网络 |
| `clientToken` | — | 连外部 WS 的 `Authorization: Bearer` token |
| `auth.*` | — | 内置服务入站认证；`allowQueryToken` 默认关闭 |
| `auth.allowProtocolToken` | `true` | 允许浏览器通过认证子协议传递 token |
| `tls.enabled` | `false` | 直接启用 WSS；启用时必须提供 `keyFile` 和 `certFile` |
| `tls.minVersion` | `TLSv1.2` | WSS 最低 TLS 版本 |
| `allowedOrigins` | `[]` | 浏览器 Origin 精确白名单；不发送 Origin 的原生客户端不受影响 |
| `allowInsecureRemote` | `false` | 显式允许远程明文监听；生产应优先使用 TLS 反向代理 |
| `limits.maxBufferedBytes` | `1048576` | 慢客户端的最大待发送字节数 |
| `limits.maxPendingMessages` | `32` | 每连接最大待处理入站消息数 |
| `limits.messagesPerMinute` | `120` | 每连接每分钟消息上限 |
| `limits.heartbeatIntervalMs` | `30000` | ping 周期 |
| `limits.heartbeatTimeoutMs` | `10000` | pong 超时 |
| `limits.sendTimeoutMs` | `10000` | reply/accepted 写出回调超时；超时终止慢连接并报告失败 |
| `limits.shutdownTimeoutMs` | `10000` | 停机排空已接纳 Agent 任务和回复的最长时间 |

## Bounded shutdown drain

```text
Gateway stop
    │
    ▼
reject new upgrades / frames → stop reconnect and heartbeat
    │
    ▼
retain Socket + Connection Hub + Runtime references
    │
    ▼
drain accepted Agent tasks → reply → accepted
    │                         │
    ├── completed ────────────┤
    └── timeout → warn ───────┘
                              ▼
                    close sockets and clear mappings
```

```mermaid
sequenceDiagram
  participant G as Gateway
  participant W as WebSocket transport
  participant A as Agent Runtime
  participant C as Connected client
  G->>W: stop / AbortSignal
  W->>W: reject new upgrades and frames
  Note over W,C: retain Socket and Connection Hub during drain
  W->>A: await already accepted tasks
  A-->>W: reply completed
  W-->>C: reply + accepted (ws.send confirmed)
  W--xC: close after drain or shutdownTimeoutMs
  W-->>G: stopped
```

## 生产部署约束

- 默认仅监听 `127.0.0.1`。可以由插件直接终止 WSS，也可以由 Nginx、Envoy 或云网关终止 TLS。
- 非 loopback 明文监听必须同时配置 token 并显式设置 `allowInsecureRemote: true`；这是风险确认开关，不会把明文连接变安全。
- 远程客户端默认只接受 `wss://`。确需远程 `ws://` 时，在 `client.allowInsecureRemote` 中显式确认。
- 原生客户端使用 `Authorization: Bearer`；浏览器使用认证子协议。`auth.allowQueryToken` 仅用于旧客户端，因为 URL 可能进入代理和访问日志。
- `/web-socket/status` 由 OpenClaw 插件认证保护，并对 token 和自定义 client headers 脱敏。
- Client URL exposed by status/logging is reduced to scheme, host, port, and path; userinfo, query, and fragment are removed.
- `agentId`, `messageId`, and `peerId` are bounded to 256 characters and reject control characters before they enter routing, session, or dedupe state.

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
