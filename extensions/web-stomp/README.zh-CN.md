<div align="center">

# OpenClaw Web STOMP

**STOMP over WebSocket — STOMP 1.2 · ACK · 心跳 · Spring / stomp.js**

![Version](https://img.shields.io/badge/Version-0.1.0-blue) ![License](https://img.shields.io/badge/License-MIT-green)

</div>

中文 | [English](README.md)

---

## 概述

受 `rabbitmq_web_stomp` 启发，本插件将 STOMP（简单文本导向消息协议）通过 WebSocket 桥接到 OpenClaw，允许 Web 浏览器和企业系统（如 Spring STOMP 客户端）使用熟悉的 STOMP 协议与 AI Agent 通信。

### rabbitmq_web_stomp 做了什么

RabbitMQ web-stomp 插件将 STOMP 协议桥接到 WebSocket，让浏览器通过 STOMP 协议订阅/发布消息。

**OpenClaw 场景**：
- 让 Web 应用通过标准 STOMP 协议订阅 Agent 的实时回复流
- 支持 STOMP 客户端库（stomp.js）直接连接 OpenClaw
- 桥接 STOMP 消息为 OpenClaw 的 `chat.send` / `chat` 事件

**价值**：让非 WS 原生的企业系统（如 Spring STOMP 客户端）也能与 OpenClaw 对话。

### 核心功能

- **STOMP 1.2 支持**：完整实现 STOMP 1.2 规范
- **WebSocket 传输**：浏览器友好的 WebSocket 通信
- **基于 Destination 路由**：通过 STOMP destination 将消息路由到 Agent
- **订阅管理**：订阅会话事件和 Agent 响应
- **ACK/NACK 支持**：带确认模式的可靠消息投递
- **心跳**：长会话的连接保活

## 架构

```
Web 浏览器 / 企业系统                  OpenClaw Gateway
    │                                        │
    │  ┌─────────────────────────────────────┤
    │  │    openclaw-web-stomp 插件          │
    │  │  ┌─────────────────────────────┐    │
    │  │  │                             │    │
    ├──┼──► stomp-server.ts             │    │
    │  │  │   (STOMP over WS)           │    │
    │  │  │         │                   │    │
    │  │  │         ▼                   │    │
    │  │  │   frame-parser.ts           │    │
    │  │  │         │                   │    │
    │  │  │         ▼                   │    │
    │  │  │   destination-router.ts ────┼────┼──► OpenClaw Agent
    │  │  │         │                   │    │      (AI 处理)
    │  │  │         ▼                   │    │
    │  │  │   subscription-mgr.ts       │    │
    │  │  │         │                   │    │
    │  │  │         ▼                   │    │
    ◄──┼──┤   channel.ts                │    │
    │  │  │   (MESSAGE 帧)               │    │
    │  │  └─────────────────────────────┘    │
    │  └─────────────────────────────────────┤
```

## STOMP Destination 规范

```
/topic/session.<sessionKey>           → 订阅会话事件流
/topic/agent.<agentId>.events         → 订阅 Agent 级别事件
/queue/agent                          → 发送消息给默认 Agent
/queue/agent.<agentId>                → 发送消息给指定 Agent
```

### 示例：发送消息给 Agent

```
SEND
destination:/queue/agent.support-bot
content-type:application/json

{"text": "你好，有什么可以帮您？"}
^@
```

### 示例：订阅会话事件

```
SUBSCRIBE
id:sub-1
destination:/topic/session.user123

^@
```

### 示例：接收 Agent 响应

```
MESSAGE
subscription:sub-1
message-id:msg-001
destination:/topic/session.user123
content-type:application/json

{"text": "我可以帮您解决这个问题！", "timestamp": 1699999999}
^@
```

## 目录结构

```
openclaw-web-stomp/
  package.json
  tsconfig.json
  tsup.config.ts
  openclaw.plugin.json    # channels: ["stomp"]
  src/
    index.ts              # 入口：启动 STOMP 服务器 + 注册渠道
    types.ts              # StompFrame, StompSubscription 等
    stomp-server.ts       # STOMP over WebSocket 服务器
    frame-parser.ts       # STOMP 帧解析/序列化
    channel.ts            # stomp 渠道定义
    destination-router.ts # STOMP destination → Agent 路由
    subscription-mgr.ts   # 订阅管理
    ack-handler.ts        # ACK/NACK 消息确认
```

## 协议映射

| STOMP 概念 | OpenClaw 映射 |
|---|---|
| CONNECT | Gateway WS connect（认证） |
| SUBSCRIBE `/topic/session.<key>` | 订阅会话的 Agent 事件流 |
| SEND `/queue/agent` | 发送消息给 Agent (chat.send) |
| MESSAGE | Agent 回复事件（流式） |
| ACK/NACK | 消息确认（用于可靠投递） |
| DISCONNECT | 优雅结束会话 |

## 配置

### openclaw.json 中的渠道配置

最低依赖：`@partme.ai/openclaw-message-sdk >= 2026.5.22`。

### message-sdk 复用

STOMP over WebSocket 帧解析与订阅管理留在本插件；下列能力通过 **薄封装** 委托 message-sdk：

| message-sdk 模块 | web-stomp 挂载点 | 用途 |
|------------------|------------------|------|
| `ingress/wire-ingress`（`normalizeWireIngress`） | `inbound.ts` | 入站 payload 解析 + 幂等短路 |
| `dedup`（`createIdempotencyCache` + `getGlobalSingleton`） | `shared/wire-helpers.ts` | 入站 message-id 进程内去重 |
| `bridge`（`dispatchChannelMessage`、`resolveChannelDispatchIdentity`） | `inbound.ts` | Wire 路径 OpenClaw reply 管线 |
| `pipeline/serialize-payload` | `inbound.ts` reply.deliver | 出站 JSON 信封（`outboundFormat: envelope`） |
| `config/resolveChannelAgentReplyTimeoutMs` | `config/resolvers.ts` | Agent 回复超时 |
| `config/resolveChannelMediaMaxBytes` | `config/resolvers.ts` | 媒体/载荷上限解析 |

```json
{
  "channels": {
    "stomp": {
      "port": 15674,
      "path": "/ws",
      "heartbeat": {
        "incoming": 10000,
        "outgoing": 10000
      },
      "authentication": {
        "enabled": true,
        "users": {
          "webapp": "secret123"
        }
      }
    }
  }
}
```

### Agent 绑定

```json
{
  "bindings": [
    {
      "channel": "stomp",
      "peer": "webapp-*",
      "agent": "customer-support"
    }
  ]
}
```

## 客户端示例

### JavaScript (stomp.js)

```javascript
import { Client } from '@stomp/stompjs';

const client = new Client({
  brokerURL: 'ws://gateway:15674/ws',
  connectHeaders: {
    login: 'webapp',
    passcode: 'secret123'
  },
  onConnect: () => {
    // 订阅会话事件
    client.subscribe('/topic/session.user123', (message) => {
      const response = JSON.parse(message.body);
      console.log('Agent 说:', response.text);
    });

    // 发送消息给 Agent
    client.publish({
      destination: '/queue/agent.support-bot',
      body: JSON.stringify({ text: '你好！' })
    });
  }
});

client.activate();
```

### Java (Spring WebSocket STOMP)

```java
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {
    
    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        config.enableStompBrokerRelay("/topic", "/queue")
              .setRelayHost("gateway")
              .setRelayPort(15674)
              .setClientLogin("webapp")
              .setClientPasscode("secret123");
    }
}

@Controller
public class ChatController {
    
    @MessageMapping("/chat")
    @SendTo("/topic/session.{sessionId}")
    public AgentResponse chat(@DestinationVariable String sessionId, 
                               ChatMessage message) {
        // 消息转发给 OpenClaw Agent
        return agentResponse;
    }
}
```

### Python

```python
import stomp

class MyListener(stomp.ConnectionListener):
    def on_message(self, frame):
        print(f"Agent 响应: {frame.body}")

conn = stomp.Connection([('gateway', 15674)])
conn.set_listener('', MyListener())
conn.connect('webapp', 'secret123', wait=True)

conn.subscribe('/topic/session.user123', id=1)
conn.send('/queue/agent.support-bot', '{"text": "你好！"}')
```

## ACK 模式

| 模式 | 说明 |
|---|---|
| `auto` | 消息投递时自动确认 |
| `client` | 客户端必须为每条消息发送 ACK |
| `client-individual` | 每条消息需要单独 ACK |

对于关键应用的可靠投递，使用 `client` 或 `client-individual` 模式：

```
SUBSCRIBE
id:sub-1
destination:/topic/session.user123
ack:client

^@
```

然后确认收到的消息：

```
ACK
id:msg-001

^@
```

## 心跳

配置心跳以检测连接问题：

```
CONNECT
accept-version:1.2
host:gateway
heart-beat:10000,10000
login:webapp
passcode:secret123

^@
```

服务器响应：

```
CONNECTED
version:1.2
heart-beat:10000,10000

^@
```

## 企业级可靠性

> 完整说明：[队列可靠性指南](../../doc/OpenClaw-Queue-Reliability-Guide.md)

| 项 | 行为 |
|----|------|
| **分级** | 协议限制需文档约束 |
| **入站** | SEND → `/queue/agent/*`；无 deferred ACK |
| **出站** | MESSAGE client ACK + prefetch；**NACK 不重投** |
| **隔离** | 入站 queue、回复 `/topic/session.*` |

## 监控

通过 HTTP 访问服务器状态：

```
GET /stomp/status
```

响应：

```json
{
  "connectedClients": 15,
  "activeSubscriptions": 42,
  "messagesReceived": 1234,
  "messagesSent": 5678,
  "uptime": 86400
}
```

## 测试

```bash
pnpm test            # 运行单元测试
pnpm test:watch      # 监听模式
pnpm test:coverage   # 覆盖率报告
```

测试覆盖：
- `frame-parser.test.ts` — STOMP 帧解析/序列化 + 转义 + 构建器（13 个测试）

## 开发

```bash
pnpm install
pnpm build
pnpm dev   # watch 模式
```

## 依赖

- `ws` - WebSocket 服务器实现

## 应用场景

### Web 聊天应用

浏览器中连接 AI 客服 Agent 的实时聊天界面。

### 企业集成

基于 Spring 的企业系统与 OpenClaw Agent 通信实现自动处理。

### 仪表板通知

订阅 Agent 事件实现仪表板的实时更新。

### 多客户端广播

多个客户端订阅同一会话实现协作交互。

## 插件配置（configSchema）

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `port` | number | 15674 | STOMP WebSocket 监听端口 |
| `path` | string | `/ws` | WebSocket 端点路径 |
| `heartbeat.serverMs` / `clientMs` | number | 10000 | 服务端/客户端心跳（毫秒） |
| `maxFrameSize` | number | 65536 | STOMP 帧最大大小（字节） |
| `prefetchCount` | number | 10 | 订阅默认预取数 |
| `destinations.agentPrefix` / `topicPrefix` / `queuePrefix` | string | `/agent/`、`/topic/`、`/queue/` | 目标前缀 |
| `auth.required` | boolean | true | 是否要求 STOMP CONNECT 认证 |

## OpenClaw 生态插件

| 插件 | 说明 |
|------|------|
| [openclaw_auth_oauth2](https://github.com/partme-ai/openclaw_auth_oauth2) | OAuth2 认证 |
| [openclaw-cluster](https://github.com/partme-ai/openclaw-cluster) | 集群协调（发现 / 配置同步 / 会话存储 / 代理） |
| [openclaw_mqtt](https://github.com/partme-ai/openclaw_mqtt) | MQTT 协议接入 |
| [openclaw_prometheus](https://github.com/partme-ai/openclaw_prometheus) | Prometheus 指标导出 |
| [openclaw-stomp](https://github.com/partme-ai/openclaw-stomp) | STOMP 服务端 |
| [openclaw_tracing](https://github.com/partme-ai/openclaw_tracing) | 链路追踪 |
| [openclaw-web-mqtt](https://github.com/partme-ai/openclaw-web-mqtt) | WebSocket MQTT |
| [openclaw-web-stomp](https://github.com/partme-ai/openclaw-web-stomp) | WebSocket STOMP |
| [openclaw_wecom_kf](https://github.com/partme-ai/openclaw_wecom_kf) | 企微客服渠道 |

## 与 rabbitmq_web_stomp 对比

| 特性 | rabbitmq_web_stomp | openclaw-web-stomp |
|---|---|---|
| 协议 | STOMP 1.0, 1.1, 1.2 | STOMP 1.2 |
| 传输 | WebSocket, SockJS | WebSocket |
| 路由 | Exchange/Queue | Destination → Agent |
| 用途 | 通用消息 | AI Agent 交互 |

## 许可证

MIT

## 消息格式指南

Web STOMP 使用共享的 OpenClaw 队列 wire 契约完成入站解析，并固定以 envelope 回复。标准 `MessageEnvelope`、非标准消息归一化、固定 envelope 回复与多语言 SDK 适配说明见 [OpenClaw 队列消息格式指南](../../doc/OpenClaw-Queue-Message-Format-Guide.md)。
