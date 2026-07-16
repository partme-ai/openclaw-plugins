# OpenClaw STOMP TCP

Authenticated STOMP 1.2 over native TCP/TLS for OpenClaw 2026.7.1. This embedded channel accepts bounded STOMP connections, routes `SEND` frames to configured Agents, and returns Agent replies through connection-scoped topics.

[中文说明](README.zh-CN.md)

## Scope

- STOMP 1.2 `CONNECT`, `SEND`, `SUBSCRIBE`, `UNSUBSCRIBE`, `ACK`, `NACK`, and `DISCONNECT`
- Plain TCP on loopback and TLS 1.2+ for remote listeners
- Login/passcode authentication using environment-backed, SHA-256, or SHA-512 credentials
- Negotiated heartbeats, CONNECT timeout, message rate limits, frame and socket-buffer limits
- Connection, subscription, inbound queue, prefetch, ACK, durable-state, and per-subscription queue bounds
- Correct cumulative `client` ACK and individual `client-individual` ACK behavior
- Optional process-memory durable subscriptions and NACK requeue
- Claim/commit/release inbound idempotency; a `message-id` is committed only after the Agent turn and reply delivery succeed
- Agent allowlists, explicit topic bindings, and connection-scoped reply subscriptions by default
- OpenClaw Gateway lifecycle integration and a credential-redacted `/stomp-tcp/status` endpoint

This is an embedded OpenClaw channel, not a durable broker. Durable subscription state is process memory only and is lost on Gateway restart. It does not implement STOMP transactions, persistent storage, dead-letter queues, broker clustering, or exactly-once delivery. Use RabbitMQ or another dedicated broker when those properties are required.

## Configuration

The default plaintext listener is restricted to `127.0.0.1:61613`. Authentication is required and startup fails until a valid user is configured.

```json
{
  "channels": {
    "stomp-tcp": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 61613,
      "tlsPort": 61614,
      "defaultAgentId": "main",
      "allowedAgentIds": ["support"],
      "auth": {
        "required": true,
        "users": [
          {
            "login": "service-a",
            "passwordEnv": "OPENCLAW_STOMP_TCP_PASSWORD"
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
        "maxQueueDepthPerSubscription": 1000,
        "maxPendingMessages": 32,
        "messagesPerMinute": 120,
        "connectTimeoutMs": 10000,
        "maxDurableSubscriptions": 1000
      },
      "defaultAckMode": "auto",
      "prefetchCount": 100,
      "allowSharedTopics": false,
      "allowDurableSubscriptions": false
    }
  }
}
```

For a remote TLS-only listener, disable plaintext with `port: 0`:

```json
{
  "host": "127.0.0.1",
  "port": 0,
  "tlsPort": 61614,
  "tls": {
    "enabled": true,
    "host": "0.0.0.0",
    "keyFile": "/etc/openclaw/tls/stomp.key",
    "certFile": "/etc/openclaw/tls/stomp.crt",
    "caFile": "/etc/openclaw/tls/ca.crt",
    "minVersion": "TLSv1.2",
    "requestCert": false,
    "rejectUnauthorized": false
  }
}
```

Set both client-certificate flags to `true` to require mTLS. `rejectUnauthorized: true` without `requestCert: true` is rejected. Avoid inline `password`; use `passwordEnv` or a precomputed `passwordHash`.

## Routing and session isolation

Standard destinations:

| Operation | Destination | Meaning |
|---|---|---|
| Send | `/queue/agent` | Route to `defaultAgentId` |
| Send | `/queue/agent.support` | Route to allowlisted Agent `support` |
| Subscribe | `/topic/session.stomp-tcp:SESSION_ID@support` | Receive this connection's `support` replies |

The `CONNECTED` frame provides `session:SESSION_ID`. With the default `allowSharedTopics: false`, the server rejects every subscription outside that connection's session topics.

Custom enterprise destinations require an explicit binding:

```json
{
  "subscribeTopics": ["devices/*/in"],
  "topicBindings": [
    {
      "topicPattern": "devices/*/in",
      "agentId": "iot-agent",
      "accountId": "default",
      "replyTopic": "/topic/devices/reply"
    }
  ],
  "allowSharedTopics": true
}
```

`subscribeTopics` is an optional inbound destination allowlist. A custom `replyTopic` is shared, so clients can subscribe to it only when `allowSharedTopics` is explicitly enabled.

## Protocol flow

```text
CONNECT
accept-version:1.2
heart-beat:10000,10000
login:service-a
passcode:<runtime-secret>

\0

SEND
destination:/queue/agent.support
receipt:request-1
content-type:application/json

{"text":"Hello"}\0
```

`RECEIPT` for `SEND` is emitted only after the OpenClaw Agent turn completes and at least one active or in-process durable subscription accepts the reply. A missing reply subscriber produces `ERROR` instead of a false success receipt. For `ack:client`, ACK is cumulative through the referenced delivery. For `ack:client-individual`, only that delivery is acknowledged. `NACK` requeues by default; set `requeue:false` to discard it.

Durable subscriptions require both `allowDurableSubscriptions: true` and `durable:true` (or `persistent:true`) on `SUBSCRIBE`. They survive a TCP reconnect only inside the same Gateway process and authenticated login; they do not survive a process restart.

## Operations

- Expose only TLS to remote networks and apply ingress/firewall controls.
- Restrict `allowedAgentIds` and custom `topicBindings` to required Agents.
- Keep shared topics and durable subscriptions disabled unless the business case requires them.
- Monitor the authenticated `/stomp-tcp/status` endpoint for queues, pending ACKs, dropped messages, and listener state.
- Load-test slow consumers, queue bounds, heartbeat timeouts, and reconnect storms with production-sized payloads.

## Development

```bash
pnpm --filter @partme.ai/openclaw-stomp typecheck
pnpm --filter @partme.ai/openclaw-stomp test
pnpm --filter @partme.ai/openclaw-stomp build
```

License: MIT.
