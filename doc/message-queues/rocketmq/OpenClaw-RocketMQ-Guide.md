# Usage Guide — openclaw-rockermq

## Prerequisites

- **Node.js** >= 22
- **OpenClaw** >= 2026.4.0
- **RocketMQ** >= 5.1.0 (Namesrv + Proxy on port 8081)
- **npm** (or pnpm/yarn)

## Installation

### 1. Start RocketMQ (if not already running)

```bash
# Using Docker (recommended for development)
docker run -d --name rocketmq-namesrv -p 9876:9876 \
  apache/rocketmq:5.3.1 sh mqnamesrv

docker run -d --name rocketmq-broker \
  -p 10911:10911 -p 8081:8081 \
  apache/rocketmq:5.3.1 sh mqbroker -n 127.0.0.1:9876 \
  --enable-proxy
```

> **Security**: Ensure your RocketMQ broker is >= 5.3.0 to avoid known CVEs (CVE-2023-33246, CVE-2023-37582, CVE-2024-23321).

### 2. Install the plugin

```bash
# From local source
cd openclaw-rocketmq
npm install
npm run build

# Install into OpenClaw
openclaw plugins install
```

Or use the npm registry:
```bash
openclaw plugins install @partme.ai/openclaw-rockermq
```

### 3. Enable the plugin

```bash
openclaw plugins enable openclaw-rockermq
```

## Configuration

Add a `channels.rockermq` section to your `openclaw.json`:

### Minimal Configuration

```json
{
  "channels": {
    "rockermq": {
      "endpoints": "127.0.0.1:8081",
      "consumer": {
        "subscriptions": [
          { "topic": "openclaw-agent-main-in", "filterExpression": "*" }
        ]
      }
    }
  }
}
```

### Full Configuration

```json
{
  "channels": {
    "rockermq": {
      "endpoints": "127.0.0.1:8081",
      "namespace": "",
      "topicPrefix": "openclaw",

      "sessionCredentials": {
        "accessKey": "your-access-key",
        "accessSecret": "your-access-secret",
        "securityToken": "optional-token"
      },

      "producer": {
        "groupId": "openclaw-rockermq-producer",
        "requestTimeout": 5000
      },

      "consumer": {
        "groupId": "openclaw-rockermq-consumer",
        "subscriptions": [
          { "topic": "device-status", "filterExpression": "*" },
          { "topic": "openclaw-agent-support-in-device1", "filterExpression": "iot" }
        ],
        "maxCacheMessageCount": 1024,
        "maxCacheMessageSizeInBytes": 67108864,
        "longPollingTimeout": 30000,
        "requestTimeout": 3000,
        "reconsumeOnError": true
      },

      "topicBindings": [
        {
          "topic": "device-status",
          "tag": "iot",
          "agentId": "iot-agent",
          "accountId": "default",
          "peerId": "device-001",
          "replyTopic": "device-command",
          "replyTag": "command"
        }
      ],

      "payload": { "mode": "jsonTextOrPlain" },

      "dispatch": {
        "mode": "embedded-agent",
        "timeoutMs": 120000,
        "reply": { "enabled": true }
      },

      "idempotency": {
        "enabled": false,
        "ttlMs": 600000,
        "maxEntries": 10000
      }
    }
  }
}
```

## Topic Naming

### Standard Format

```
{topicPrefix}-agent-{agentId}-{direction}[-{peerId}]
```

Examples:
- `openclaw-agent-main-in` — inbound to the "main" agent
- `openclaw-agent-main-out` — outbound from "main"
- `openclaw-agent-support-in-device123` — inbound to "support" from device123

### Explicit Bindings

Use `topicBindings` for custom topic names:

```json
{
  "topic": "iot-sensor-data",
  "tag": "temperature",
  "agentId": "sensor-agent",
  "accountId": "default",
  "replyTopic": "iot-commands",
  "replyTag": "ack"
}
```

### Wildcard Matching

Consumer subscriptions support wildcards:
- `*` — matches exactly one segment (e.g., `device.*` matches `device.temp`)
- `#` — matches zero or more segments (e.g., `device.#` matches `device`, `device.temp`, `device.temp.humidity`)

## Message Format

### Inbound Messages

Messages sent to subscribed topics are parsed based on `payload.mode`:

**`jsonTextOrPlain`** (default):
```json
{
  "agentId": "main",
  "peerId": "device-001",
  "content": "Temperature alert: 42°C",
  "timestamp": "2026-05-19T08:00:00Z",
  "correlationId": "optional-idempotency-key"
}
```
- If `text` field exists and is non-empty → used as prompt
- Otherwise → raw message body is used as prompt

**`jsonOnly`**:
```json
{ "text": "This exact field is used" }
```
- Requires valid JSON; uses `text` field or full JSON string

**`plainText`**:
```
Raw text is used directly as the prompt
```

### Outbound (Reply) Messages

Agent replies are published as JSON:
```json
{
  "text": "Agent response text here..."
}
```

## Dispatch Modes

| Mode | Use Case | Latency | Isolation |
|------|----------|---------|-----------|
| `embedded-agent` | Most cases | Medium | In-process |
| `subagent` | Heavy workloads | Higher | Separate process |
| `reply-pipeline` | Standard channels | Low | Pipeline-driven |

## HTTP Endpoints

After installation, the following endpoints are available at `http://127.0.0.1:18790`:

| Endpoint | Description |
|----------|-------------|
| `/rockermq/health` | Connection health (200=healthy, 503=unhealthy) |
| `/rockermq/stats` | Message statistics + session counts |
| `/rockermq/status` | Full status including config snapshot |

All endpoints require the Gateway auth token (`Authorization: Bearer <token>`).

## Debug Tool

The `mq.publish` tool allows publishing messages directly via the agent:

```
Tool: mq.publish
Params: { topic, tag?, payload, keys? }
```

## Troubleshooting

### Plugin not connecting
```bash
# Check plugin status
openclaw plugins list | grep rockermq

# Check channel status  
openclaw status | grep RocketMQ

# Check health
curl -H "Authorization: Bearer <token>" http://127.0.0.1:18790/rockermq/health
```

### Messages not being consumed
1. Verify `consumer.subscriptions` includes the topic
2. Check that the topic exists in RocketMQ
3. Ensure consumer `groupId` is unique per plugin instance

### Messages not routing to agent
1. Check `topicBindings` for matching topic + tag
2. Verify standard topic format: `{prefix}-agent-{agentId}-in`
3. Check gateway logs: `openclaw logs --follow`
