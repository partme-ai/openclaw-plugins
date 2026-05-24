<div align="center">

# OpenClaw Web STOMP

**STOMP over WebSocket — STOMP 1.2 · ACK · Heartbeat · Spring / stomp.js**

![Version](https://img.shields.io/badge/Version-0.1.0-blue) ![License](https://img.shields.io/badge/License-MIT-green)

</div>

[中文](README.zh-CN.md) | English

---

## Overview

Inspired by `rabbitmq_web_stomp`, this plugin bridges STOMP (Simple Text Oriented Messaging Protocol) over WebSocket to OpenClaw, allowing web browsers and enterprise systems (like Spring STOMP clients) to communicate with AI agents using the familiar STOMP protocol.

### RabbitMQ web-stomp Context

**What rabbitmq_web_stomp does**: Bridges STOMP protocol to WebSocket, enabling browsers to subscribe/publish messages via STOMP.

**OpenClaw scenarios**:
- Web applications subscribe to Agent real-time reply streams via standard STOMP protocol
- STOMP client libraries (stomp.js) connect directly to OpenClaw
- Bridge STOMP messages to OpenClaw `chat.send` / `chat` events

**Value**: Enables non-WS-native enterprise systems (e.g., Spring STOMP clients) to communicate with OpenClaw agents.

### Key Features

- **STOMP 1.2 Support**: Full implementation of STOMP 1.2 specification
- **WebSocket Transport**: Browser-friendly WebSocket-based communication
- **Destination-based Routing**: Route messages to agents via STOMP destinations
- **Subscription Management**: Subscribe to session events and agent responses
- **ACK/NACK Support**: Reliable message delivery with acknowledgment modes
- **Heartbeat**: Connection keep-alive for long-running sessions

## Architecture

```
Web Browser / Enterprise System        OpenClaw Gateway
    │                                        │
    │  ┌─────────────────────────────────────┤
    │  │    openclaw-web-stomp Plugin        │
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
    │  │  │         │                   │    │      (AI Processing)
    │  │  │         ▼                   │    │
    │  │  │   subscription-mgr.ts       │    │
    │  │  │         │                   │    │
    │  │  │         ▼                   │    │
    ◄──┼──┤   channel.ts                │    │
    │  │  │   (MESSAGE frame)           │    │
    │  │  └─────────────────────────────┘    │
    │  └─────────────────────────────────────┤
```

## STOMP Destination Convention

```
/topic/session.<sessionKey>           → Subscribe to session event stream
/topic/agent.<agentId>.events         → Subscribe to agent-level events
/queue/agent                          → Send message to default Agent
/queue/agent.<agentId>                → Send message to specific Agent
```

### Example: Sending Message to Agent

```
SEND
destination:/queue/agent.support-bot
content-type:application/json

{"text": "Hello, how can I help?"}
^@
```

### Example: Subscribing to Session Events

```
SUBSCRIBE
id:sub-1
destination:/topic/session.user123

^@
```

### Example: Receiving Agent Response

```
MESSAGE
subscription:sub-1
message-id:msg-001
destination:/topic/session.user123
content-type:application/json

{"text": "I can help you with that!", "timestamp": 1699999999}
^@
```

## Directory Structure

```
openclaw-web-stomp/
  package.json
  tsconfig.json
  tsup.config.ts
  openclaw.plugin.json    # channels: ["stomp"]
  src/
    index.ts              # Entry: start STOMP server + register channel
    types.ts              # StompFrame, StompSubscription, etc.
    stomp-server.ts       # STOMP over WebSocket server
    frame-parser.ts       # STOMP frame parsing/serialization
    channel.ts            # stomp channel definition
    destination-router.ts # STOMP destination → Agent routing
    subscription-mgr.ts   # Subscription management
    ack-handler.ts        # ACK/NACK message confirmation
```

## Protocol Mapping

| STOMP Concept | OpenClaw Mapping |
|---|---|
| CONNECT | Gateway WS connect (authentication) |
| SUBSCRIBE `/topic/session.<key>` | Subscribe to session's agent event stream |
| SEND `/queue/agent` | Send message to Agent (chat.send) |
| MESSAGE | Agent reply event (streaming) |
| ACK/NACK | Message confirmation (for reliable delivery) |
| DISCONNECT | End session gracefully |

## Configuration

### Channel Configuration in `openclaw.json`

Requires `@partme.ai/openclaw-message-sdk >= 2026.5.22`.

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

### Agent Binding

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

## Client Examples

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
    // Subscribe to session events
    client.subscribe('/topic/session.user123', (message) => {
      const response = JSON.parse(message.body);
      console.log('Agent says:', response.text);
    });

    // Send message to agent
    client.publish({
      destination: '/queue/agent.support-bot',
      body: JSON.stringify({ text: 'Hello!' })
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
        // Message forwarded to OpenClaw agent
        return agentResponse;
    }
}
```

### Python

```python
import stomp

class MyListener(stomp.ConnectionListener):
    def on_message(self, frame):
        print(f"Agent response: {frame.body}")

conn = stomp.Connection([('gateway', 15674)])
conn.set_listener('', MyListener())
conn.connect('webapp', 'secret123', wait=True)

conn.subscribe('/topic/session.user123', id=1)
conn.send('/queue/agent.support-bot', '{"text": "Hello!"}')
```

## ACK Modes

| Mode | Description |
|---|---|
| `auto` | Messages auto-acknowledged on delivery |
| `client` | Client must send ACK for each message |
| `client-individual` | Each message requires individual ACK |

For reliable delivery in critical applications, use `client` or `client-individual` mode:

```
SUBSCRIBE
id:sub-1
destination:/topic/session.user123
ack:client

^@
```

Then acknowledge received messages:

```
ACK
id:msg-001

^@
```

## Heartbeat

Configure heartbeat to detect connection issues:

```
CONNECT
accept-version:1.2
host:gateway
heart-beat:10000,10000
login:webapp
passcode:secret123

^@
```

Server response:

```
CONNECTED
version:1.2
heart-beat:10000,10000

^@
```

## Monitoring

Access server status via HTTP:

```
GET /stomp/status
```

Response:

```json
{
  "connectedClients": 15,
  "activeSubscriptions": 42,
  "messagesReceived": 1234,
  "messagesSent": 5678,
  "uptime": 86400
}
```

## Development

```bash
pnpm install
pnpm build
pnpm dev   # watch mode
```

## Dependencies

- `ws` - WebSocket server implementation

## Use Cases

### Web Chat Application

Real-time chat interface in browser connecting to AI support agent.

### Enterprise Integration

Spring-based enterprise systems communicating with OpenClaw agents for automated processing.

### Dashboard Notifications

Subscribe to agent events for real-time dashboard updates.

### Multi-client Broadcasting

Multiple clients subscribed to same session for collaborative interactions.

## Plugin Configuration (configSchema)

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | number | 15674 | WebSocket listener port for STOMP |
| `path` | string | `/ws` | WebSocket endpoint path |
| `heartbeat.serverMs` / `clientMs` | number | 10000 | Server and client heartbeat (ms) |
| `maxFrameSize` | number | 65536 | Max STOMP frame size (bytes) |
| `prefetchCount` | number | 10 | Default prefetch for subscriptions |
| `destinations.agentPrefix` / `topicPrefix` / `queuePrefix` | string | `/agent/`, `/topic/`, `/queue/` | Destination prefixes |
| `auth.required` | boolean | true | Require STOMP CONNECT authentication |

## Related OpenClaw plugins

| Plugin | Description |
|--------|--------------|
| [openclaw_auth_oauth2](https://github.com/partme-ai/openclaw_auth_oauth2) | OAuth2 authentication |
| [openclaw-cluster](https://github.com/partme-ai/openclaw-cluster) | Cluster coordination (discovery, config sync, session store, proxy) |
| [openclaw_mqtt](https://github.com/partme-ai/openclaw_mqtt) | MQTT protocol adapter |
| [openclaw_prometheus](https://github.com/partme-ai/openclaw_prometheus) | Prometheus metrics exporter |
| [openclaw-stomp](https://github.com/partme-ai/openclaw-stomp) | STOMP server |
| [openclaw_tracing](https://github.com/partme-ai/openclaw_tracing) | Distributed tracing |
| [openclaw-web-mqtt](https://github.com/partme-ai/openclaw-web-mqtt) | WebSocket MQTT |
| [openclaw-web-stomp](https://github.com/partme-ai/openclaw-web-stomp) | WebSocket STOMP |
| [openclaw_wecom_kf](https://github.com/partme-ai/openclaw_wecom_kf) | WeChat Work customer service channel |

## Comparison with rabbitmq_web_stomp

| Feature | rabbitmq_web_stomp | openclaw-web-stomp |
|---|---|---|
| Protocol | STOMP 1.0, 1.1, 1.2 | STOMP 1.2 |
| Transport | WebSocket, SockJS | WebSocket |
| Routing | Exchange/Queue | Destination → Agent |
| Use Case | General messaging | AI Agent interaction |

## License

MIT
