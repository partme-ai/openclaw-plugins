# OpenClaw Queue/Message Channels — Enterprise Reliability Guide (Summary)

> Plugins: `rabbitmq`, `mqtt`, `web-mqtt`, `stomp`, `web-stomp`, `redis-stream`, `gotify`, `message-sdk`.
>
> Full Chinese guide: [OpenClaw-Queue-Reliability-Guide.md](./OpenClaw-Queue-Reliability-Guide.md)

## Grading

| Plugin | Grade | Notes |
|--------|-------|-------|
| **message-sdk** | Production-ready | `deferred-delivery-ack`, dedup, keyed queues |
| **rabbitmq** | Enterprise pilot | Deferred ACK after reply; retry+DLX; no publisher confirms |
| **redis-stream** (stream) | Enterprise pilot | XACK on success; XAUTOCLAIM for stale PEL |
| **redis-stream** (pubsub) | Doc constraints | No ACK — at-most-once |
| **mqtt** | Enterprise pilot | No inbound ACK (MQTT); outbound await; server publish loop skip |
| **web-mqtt** | Doc constraints | QoS0 only; per-client serial inbound queue |
| **stomp / web-stomp** | Doc constraints | No inbound deferred ACK; embedded broker |
| **gotify** | Doc constraints | WS + cursor; no broker ACK |

## Key guarantees (code-backed)

- **RabbitMQ**: ACK only after successful reply publish (`createDeferredDeliveryAck`); nack on failure; `nackAllPendingDeliveries` on stop.
- **Redis Stream**: ACK when handler returns true; `pendingClaimIdleMs` enables XAUTOCLAIM reclaim.
- **MQTT / web-mqtt**: Reply publish is awaited; broker-originated publishes skip inbound handler.
- **STOMP**: Outbound MESSAGE uses client ACK + prefetch; inbound SEND has no app-level settle.

## Production checklist

1. Separate inbound vs outbound topics/channels/destinations.
2. Enable idempotency for multi-instance deployments.
3. Monitor PEL (Redis), nack/requeue (RabbitMQ), dispatch errors (all).
4. Prefer RabbitMQ or Redis Stream for strict at-least-once.

See the Chinese guide for copy-paste `openclaw.json` examples per plugin.
