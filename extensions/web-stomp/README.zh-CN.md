# OpenClaw Web STOMP

面向 OpenClaw 2026.7.1 的 STOMP 1.2 over WebSocket/WSS 渠道插件。它接收经过认证的浏览器或服务端连接，将 `SEND` 帧路由到白名单内的 Agent，并通过 `MESSAGE` 帧返回该连接对应的 Agent 回复。

[English](README.md)

## 能力边界

- 支持 STOMP 1.2 的 `CONNECT`、`SEND`、`SUBSCRIBE`、`UNSUBSCRIBE`、`ACK`、`NACK`、`DISCONNECT`
- 支持 WebSocket 和启用 TLS 的 WSS
- 支持 login/passcode 认证，凭证可来自环境变量或 SHA-256/SHA-512 哈希
- 支持 STOMP 心跳协商、连接/订阅限制、消息速率限制、帧大小限制和出站背压
- 支持浏览器 Origin 精确白名单
- 默认只允许订阅当前连接自己的回复主题，防止跨连接窃听
- 接入 OpenClaw Gateway 生命周期，并提供脱敏的 `/stomp/status` 状态接口

本插件是 OpenClaw 渠道适配器，不是持久化消息代理。订阅和待确认消息仅保存在内存中；`NACK` 只清理待确认状态，不会重投，也没有死信队列。消息体是 UTF-8 文本，不能包含 NUL 字节。若业务需要持久化队列、回放、事务或 Broker 集群，应使用 RabbitMQ 等专业消息代理。

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

明文连接被有意限制在回环地址。若由反向代理终止 TLS，应让插件继续监听回环地址，再由代理转发 WSS。生产环境不要在配置中直接写 `password`，优先使用 `passwordEnv` 或 `passwordHash`。虽然支持 `allowedOrigins: ["*"]`，但公开浏览器场景不应使用通配符。

## Destination 流程

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

## 生产运维

- 收紧 `allowedAgentIds`；客户端无法访问不在名单中的 Agent。
- 浏览器场景必须配置 Origin 白名单，并在入口层增加网络访问控制。
- 监控 `/stomp/status`；该接口只返回连接计数和脱敏配置，不暴露密码或哈希。
- 压测前按真实负载设置帧、队列、待确认消息和连接上限。
- Gateway 重启会断开全部 WebSocket 会话，并清空订阅和待确认状态。

## 开发验证

```bash
pnpm --filter @partme.ai/openclaw-web-stomp typecheck
pnpm --filter @partme.ai/openclaw-web-stomp test
pnpm --filter @partme.ai/openclaw-web-stomp build
```

许可证：MIT。
