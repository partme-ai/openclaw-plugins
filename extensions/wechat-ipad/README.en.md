# OpenClaw WeChat iPad External Bridge

`@partme.ai/wechat-ipad` is an opt-in OpenClaw 2026.7.1 channel for a separately operated external bridge. It consumes inbound events over WebSocket and sends messages through HTTP; it does not ship or implement the underlying WeChat iPad protocol.

This is not an official WeChat API. The plugin is disabled by default and requires both `enabled=true` and `acknowledgeUnofficialProtocolRisk=true`. Evaluate account, terms, privacy, and operational risk yourself. It is not production-ready for your deployment until the external bridge and an isolated account pass real-environment acceptance tests.

Security properties:

- Remote endpoints require `wss://` and `https://`; plaintext is loopback-only.
- The bridge token is sent as `Authorization: Bearer`, never in URLs or status output. `WECHAT_IPAD_BRIDGE_TOKEN` is supported.
- Groups are disabled by default and require a non-empty allowlist unless `allowAllGroups=true` is explicit.
- Connection, request, payload, response, heartbeat, and text limits are configurable.
- `/wechat-ipad/status` uses exact routing plus OpenClaw Gateway authentication and returns sanitized state only.
- Managed start/stop lifecycle, bounded exponential reconnect with jitter, and message deduplication are included.

See [README.md](./README.md) for the complete configuration and external bridge contract.

Verification:

```bash
pnpm --filter @partme.ai/wechat-ipad typecheck
pnpm --filter @partme.ai/wechat-ipad test
pnpm --filter @partme.ai/wechat-ipad build
```
