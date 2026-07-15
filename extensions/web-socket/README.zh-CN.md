# @partme.ai/openclaw-web-socket

OpenClaw 2026.7.1+ 的生产型 WebSocket 渠道插件，支持内置服务端、外部客户端和双模式。

## 能力

- `server`：应用连接 OpenClaw 内置 WebSocket，消息交给 Agent，同一连接返回回复。
- `client`：OpenClaw 主动连接外部 `wss://` 网关，支持指数退避重连。
- HTTP upgrade 前完成 Bearer token、路径、Origin 和连接数校验。
- 每连接消息限速、串行异步入站队列、payload/待发送字节上限。
- WebSocket ping/pong 心跳、连接超时、可等待的关闭流程。
- 通过 `defaultAgentId` 或 `agentBindings` 路由到 Agent。
- 默认不信任客户端帧中的 `agentId`；只有显式启用 `allowFrameAgentId` 才允许客户端选择 Agent。

## 最小配置

```json
{
  "channels": {
    "web-socket": {
      "mode": "server",
      "host": "127.0.0.1",
      "wsPort": 18789,
      "path": "/openclaw/ws",
      "defaultAgentId": "main"
    }
  }
}
```

客户端发送：

```json
{ "type": "message", "text": "你好", "messageId": "msg-1", "peerId": "user-1" }
```

## 生产安全

- 默认仅监听 `127.0.0.1`。推荐使用 Nginx、Envoy 或云网关终止 TLS，外部只暴露 `wss://`。
- 非 loopback 明文监听必须开启 token 鉴权，并显式设置 `allowInsecureRemote: true`。
- 远程客户端默认必须使用 `wss://`；`client.allowInsecureRemote` 仅用于明确接受风险的旧环境。
- token 默认只接受 `Authorization: Bearer`。查询参数 token 会进入代理或访问日志，因此 `auth.allowQueryToken` 默认关闭。
- 浏览器生产接入应配置 `allowedOrigins` 精确白名单；不发送 Origin 的原生客户端仍可使用 token 接入。
- `/web-socket/status` 受 OpenClaw 插件认证保护，输出不会包含 token 或自定义客户端 header。

完整模式、协议和参数见 [README.md](./README.md)。
