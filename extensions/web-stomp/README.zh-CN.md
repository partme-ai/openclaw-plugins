<div align="center">

# OpenClaw Web STOMP

**OpenClaw STOMP over WebSocket 插件 -- STOMP 1.2 · ACK · 心跳 · Spring / stomp.js 兼容**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--web--stomp-blue)
![Node](https://img.shields.io/badge/Node.js-20+-green)
![License](https://img.shields.io/badge/License-MIT-green)
![STOMP](https://img.shields.io/badge/STOMP-1.2-orange)

</div>

[English](./README.md) | [简体中文](./README.zh-CN.md)

---

受 `rabbitmq_web_stomp` 启发，本插件将 STOMP（简单文本导向消息协议）通过 WebSocket 桥接到 OpenClaw，使 Web 浏览器和企业系统（如 Spring STOMP 客户端）使用标准 STOMP 协议与 AI Agent 通信。

## 特性

- **STOMP 1.2 支持** -- 完整实现 STOMP 1.2 规范
- **WebSocket 传输** -- 浏览器友好的 WebSocket 通信
- **基于 Destination 路由** -- 通过 STOMP destination 将消息路由到 Agent
- **订阅管理** -- 订阅会话事件和 Agent 响应
- **ACK/NACK 支持** -- 带确认模式的可靠消息投递
- **心跳** -- 长会话的连接保活
- **多客户端支持** -- JavaScript（stomp.js）、Java（Spring）、Python 多语言兼容

## 前置要求

- OpenClaw `>= 2026.4.0`
- Node.js `20+`

## 快速开始

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-web-stomp
```

### 配置

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

## STOMP Destination 规范

| Destination | 说明 |
|-------------|------|
| `/topic/session.<sessionKey>` | 订阅会话事件流 |
| `/topic/agent.<agentId>.events` | 订阅 Agent 级别事件 |
| `/queue/agent` | 发送消息给默认 Agent |
| `/queue/agent.<agentId>` | 发送消息给指定 Agent |

## 客户端示例

### JavaScript（stomp.js）

```javascript
import { Client } from '@stomp/stompjs';

const client = new Client({
  brokerURL: 'ws://gateway:15674/ws',
  connectHeaders: { login: 'webapp', passcode: 'secret123' },
  onConnect: () => {
    client.subscribe('/topic/session.user123', (message) => {
      const response = JSON.parse(message.body);
      console.log('Agent 回复:', response.text);
    });
    client.publish({
      destination: '/queue/agent.support-bot',
      body: JSON.stringify({ text: '你好！' })
    });
  }
});

client.activate();
```

### Java（Spring WebSocket STOMP）

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
    public AgentResponse chat(@DestinationVariable String sessionId, ChatMessage message) {
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

## 协议映射

| STOMP 概念 | OpenClaw 映射 |
|------------|---------------|
| CONNECT | Gateway WS connect（认证） |
| SUBSCRIBE `/topic/session.<key>` | 订阅会话的 Agent 事件流 |
| SEND `/queue/agent` | 发送消息给 Agent（chat.send） |
| MESSAGE | Agent 回复事件（流式） |
| ACK/NACK | 消息确认（可靠投递） |
| DISCONNECT | 优雅结束会话 |

## ACK 模式

| 模式 | 说明 |
|------|------|
| `auto` | 消息投递时自动确认 |
| `client` | 客户端必须为每条消息发送 ACK |
| `client-individual` | 每条消息需要单独 ACK |

```
SUBSCRIBE
id:sub-1
destination:/topic/session.user123
ack:client

ACK
id:msg-001
```

## 架构

```
Web 浏览器 / 企业系统                OpenClaw Gateway
    │                                     │
    │  stomp-server.ts                    │
    ├──────► (STOMP over WS)              │
    │         │                           │
    │         ▼                           │
    │   frame-parser.ts                   │
    │         │                           │
    │         ▼                           │
    │   destination-router.ts ────────────┼──► Agent
    │         │                           │
    │         ▼                           │
    │   subscription-mgr.ts               │
    │         │                           │
    │         ▼                           │
    ◄──── channel.ts (MESSAGE 帧)         │
```

## 配置说明

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | number | 15674 | STOMP WebSocket 监听端口 |
| `path` | string | `/ws` | WebSocket 端点路径 |
| `heartbeat.serverMs` | number | 10000 | 服务端心跳（毫秒） |
| `heartbeat.clientMs` | number | 10000 | 客户端心跳（毫秒） |
| `maxFrameSize` | number | 65536 | STOMP 帧最大大小（字节） |
| `prefetchCount` | number | 10 | 订阅默认预取数 |
| `destinations.agentPrefix` | string | `/agent/` | Agent destination 前缀 |
| `destinations.topicPrefix` | string | `/topic/` | Topic 前缀 |
| `destinations.queuePrefix` | string | `/queue/` | Queue 前缀 |
| `auth.required` | boolean | true | 是否要求 STOMP CONNECT 认证 |

## 监控

```
GET /stomp/status

{
  "connectedClients": 15,
  "activeSubscriptions": 42,
  "messagesReceived": 1234,
  "messagesSent": 5678,
  "uptime": 86400
}
```

## 应用场景

- **Web 聊天应用** -- 浏览器中连接 AI 客服 Agent 的实时聊天界面
- **企业集成** -- 基于 Spring 的企业系统与 OpenClaw Agent 通信
- **仪表板通知** -- 订阅 Agent 事件实现仪表板的实时更新
- **多客户端广播** -- 多个客户端订阅同一会话实现协作交互

## 项目结构

```
openclaw_web_stomp/
├── src/
│   ├── index.ts                  # 入口
│   ├── types.ts                  # StompFrame, StompSubscription 等
│   ├── stomp-server.ts           # STOMP over WebSocket 服务器
│   ├── frame-parser.ts           # STOMP 帧解析/序列化
│   ├── channel.ts                # STOMP 渠道定义
│   ├── destination-router.ts     # STOMP destination → Agent 路由
│   ├── subscription-mgr.ts       # 订阅管理
│   └── ack-handler.ts            # ACK/NACK 消息确认
├── package.json
├── openclaw.plugin.json
└── README.md / README.zh-CN.md
```

## 测试

```bash
pnpm test           # 运行单元测试
pnpm test:watch     # 监听模式
pnpm test:coverage  # 覆盖率报告
```

## 与 rabbitmq_web_stomp 对比

| 特性 | rabbitmq_web_stomp | openclaw_web_stomp |
|------|---------------------|---------------------|
| 协议 | STOMP 1.0, 1.1, 1.2 | STOMP 1.2 |
| 传输 | WebSocket, SockJS | WebSocket |
| 路由 | Exchange/Queue | Destination → Agent |
| 用途 | 通用消息 | AI Agent 交互 |

## 相关链接

- [OpenClaw 文档](https://docs.openclaw.ai)
- [STOMP 协议规范](https://stomp.github.io/)
- [stomp.js](https://github.com/stomp-js/stompjs)
- [Spring WebSocket 文档](https://docs.spring.io/spring-framework/reference/web/websocket.html)

## 许可证

本项目采用 [MIT License](LICENSE) 协议。
