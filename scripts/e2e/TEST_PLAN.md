# OpenClaw Plugin E2E — Test Plan

## Scope

Primary target: **23 adapters** installed into OpenClaw profile `queue-e2e`. Nine protocol adapters form the default combined run; the remaining external/security/platform/capability scenarios run explicitly in isolation:

| Plugin ID | Package | Category |
|-----------|---------|----------|
| mqtt | `@partme.ai/openclaw-mqtt` | embedded-service |
| stomp | `@partme.ai/openclaw-stomp` | embedded-service |
| web-mqtt | `@partme.ai/openclaw-web-mqtt` | web-browser |
| web-stomp | `@partme.ai/openclaw-web-stomp` | web-browser |
| web-socket | `@partme.ai/openclaw-web-socket` | web-browser (isolated host Gateway) |
| rabbitmq | `@partme.ai/openclaw-rabbitmq` | external-broker |
| rocketmq | `@partme.ai/openclaw-rocketmq` | external-broker |
| gotify | `@partme.ai/openclaw-gotify` | external-broker |
| redis-stream | `@partme.ai/openclaw-redis-stream` | external-broker |
| router | `@partme.ai/openclaw-router` | infra |
| mtls | `@partme.ai/openclaw-mtls` | infra/security (isolated) |
| oauth2 | `@partme.ai/openclaw-oauth2` | infra/security (isolated) |
| tracing | `@partme.ai/openclaw-tracing` | infra/observability (isolated with MQTT turn) |
| bridge | `@partme.ai/openclaw-bridge` | infra/observation (isolated with MQTT turn) |

Dependency: `@partme.ai/openclaw-message-sdk` (built + linked into channel extensions).

## Test layers

### L1 — Build / package / install

- `pnpm install` at repo root
- Per plugin: `typecheck`, unit `test`, `build`, `pnpm pack`
- Extract tarball to `~/.openclaw-queue-e2e/extensions/<extDir>`
- Overlay workspace `dist/` for runtime completeness
- `npm install --omit=dev` in extension dir
- Link message-sdk into each extension
- Register extracted local tarballs in the OpenClaw installed-plugin index via `plugins install --link`

**Pass criteria:** `openclaw --profile queue-e2e plugins list` shows installed plugins; `.e2e-installed.json` written.

### L2 — Compose boot

- Start required Docker services from `docker-compose.yml`:
  - rabbitmq (5672, management 15672)
  - gotify (18080)
  - rocketmq namesrv / broker / proxy (9876, 8081)
  - OpenTelemetry Collector Contrib (OTLP/HTTP 4318, host 14318)
- Optional: `openclaw` gateway container (when not using host fallback)
- Health waits: rabbitmq + gotify healthcheck; rocketmq proxy TCP 8081

**Pass criteria:** `docker ps` shows expected containers; no blocker in report `docker.ok`.

### L3 — Config generation

- Merge fragments from `config/plugins/*.mjs` into `~/.openclaw-queue-e2e/openclaw.json`
- Gateway: local mode, loopback, auth none, port `E2E_GATEWAY_PORT`; mTLS/OAuth2 isolated runs switch to `trusted-proxy`
- mTLS-only runs generate a disposable CA, server certificate, trusted client certificate, and rogue client certificate under the E2E state directory
- Channel-specific ports aligned with `lib/utils.mjs` `E2E_PORTS`
- Meta file `.e2e-config-meta.json` (e.g. dynamic RocketMQ topic)

**Pass criteria:** config file exists; gotify section uses bootstrap tokens when gotify is selected.

### L4 — Service bootstrap / datasets

| Bootstrap | When | Output |
|-----------|------|--------|
| `bootstrap/gotify.mjs` | gotify in `--plugins` | `.e2e-secrets.json` |
| `bootstrap/rocketmq-topic.mjs` | rocketmq in `--plugins` | topic created through broker `mqadmin`; the adapter test performs the real producer publish |

Datasets (`datasets/messages/agent-inbound.json`) provide consistent inbound payloads for adapters.

### L5 — Gateway start

| Mode | Trigger | Evidence |
|------|---------|----------|
| Host | `OPENCLAW_E2E_HOST_GATEWAY=1` | `.gateway.pid`, `gateway.log` |
| Container | default when Docker OK | `openclaw-e2e-gateway` healthy |

**Pass criteria:** TCP connect to `127.0.0.1:E2E_GATEWAY_PORT` within timeout.

### L6 — Installed-plugin smoke tests (adapters)

Each adapter in `plugins/<id>.mjs`:

| Plugin | Method | Evidence |
|--------|--------|----------|
| mqtt | GET `/mqtt/status` + MQTT publish :11883 | PASS/FAIL in report |
| rabbitmq | 等待 Channel 健康 + AMQP confirm publish → 真实 Agent Turn → reply queue | 回复信封/路由正确，模型调用恰好 1 次，received/sent/confirmed/acked 均 > 0 |
| rocketmq | 等待 Channel 健康 + Producer → PushConsumer → 真实 Agent Turn → reply Topic → ACK | 回复信封/路由正确，模型调用恰好 1 次，received/sent/acked > 0 且 inFlight=0 |
| gotify | REST publish → WebSocket → 真实 Agent Turn → 保留回复 → 删除入站 | 回复正文/防回环标记正确，模型调用恰好 1 次，成功后才删除原消息 |
| stomp | CONNECT → 会话隔离 SUBSCRIBE → SEND → 真实 Agent Turn → MESSAGE → ACK/RECEIPT | 回复信封/动态路由正确，模型调用恰好 1 次，入出站计数 > 0 且 ackPending=0 |
| web-mqtt | WS MQTT QoS 1 publish → 真实 Agent Turn → subscribed reply；Chromium 再执行连接/订阅/发布/回复 | 回复信封/动态路由正确，模型调用恰好 1 次，accepted/outbound > 0 |
| web-stomp | CONNECT → 会话隔离 SUBSCRIBE → SEND → 真实 Agent Turn → MESSAGE → ACK/RECEIPT | 回复信封/动态路由正确，模型调用恰好 1 次 |
| web-socket | Bearer/Origin HTTP upgrade + connected/ping/error frames + exact status route | WS :28789 and 401/403/405 guards |
| redis-stream | 等待 Channel 健康 + XADD/XREADGROUP → 真实 Agent Turn → reply Stream | 回复信封/路由正确，模型调用恰好 1 次，XACK 后 PEL=0 |
| router | persisted Outbox recovery + Gotify outbound delivery | durable delivery evidence |
| mtls | missing, rogue, and trusted OpenSSL client certificates against `/mtls/status` | 401/401/200 and trusted-proxy identity acceptance |
| oauth2 | Authorization Code + PKCE, refresh, introspection, revoke, spoofed identity header | complete lifecycle and trusted-proxy identity acceptance |
| douyin | signed challenge + invalid signature + valid Webhook → Agent Turn → duplicate replay around Gateway restart | 200/401, model exactly once, persistent `Msg-Id` dedupe |
| amap | model tool_call → installed `amap_search_places` → local v5 fixture 503/200 → Tool Result → final model reply | one Tool round trip, exactly one safe GET retry, bounded official path/params |
| meituan | model tool_call → installed `meituan_openapi_invoke` → local MTOp signature verifier → Tool Result → final reply | independently valid SHA-1/form/header, allowlisted path, exactly one POST |
| rednode | model tool_call → installed `rednode_ark_invoke` → local Ark signature verifier 502/200 → Tool Result → final reply | independently valid MD5/header/query, allowlisted path, exactly one safe GET retry |
| wechat | local iLink `getUpdates` → pairing → Agent Turn → `sendMessage`, then replay same `message_id` after restart | Bearer/recipient/context-token/reply exact, model and outbound exactly once across restart |
| wechat-ipad | local external bridge WS event → Agent Turn → HTTP `/api/send`, then replay same `msgId` after restart | Bearer/recipient/reply exact, `/readyz` healthy, model and outbound exactly once across restart |
| wecom-kf | independent AES callback → `gettoken`/`sync_msg` → Agent Turn → `send_msg`, then replay same `msgid` after restart | quick 200, callback token then restored cursor, recipient/account/reply exact, model and outbound exactly once |
| knowledge | installed tarball API indexes/searches a fixture document, then two real Agent Turns with the same stable session key around a Gateway restart | configured `/v1/embeddings` parameters, automatic `before_prompt_build` injection, SQLite persistence, and stable-session recovery |
| memory | real Agent Turn → L0-L3 persistence → Gateway restart → CLI search → second session | L3 profile is stored with safe permissions and injected after restart |
| openmem | real Agent Turn → sidecar ingest/drain/archive → Gateway restart → second turn | archived continuity is injected by the restarted Memory Host |
| prometheus | Bearer scrape/health/RPC + exact-route guards + 25 concurrent scrapes | 401/200/405, build info, bounded series, and collection single-flight |
| tracing | MQTT inbound + real Agent turn + MQTT reply + OTLP/HTTP export | Collector receives `message.received`; status has no active/buffered spans |
| bridge | MQTT inbound + real Agent turn + MQTT reply + `message_received`/`message_sent` mirror | inbound/outbound audit Topic each receives exactly one message; no recursive self-audit |

### L7 — Browser tests (optional)

- Playwright against `test-web/` UI (ports patched to E2E WS ports)
- Plugins: web-mqtt, web-stomp
- Skip with `--skip-browser` or when playwright unavailable (SKIP, not fake PASS)

### L8 — Report / artifacts

`e2e-report.json` 保存最近一次运行；`reports/<timestamp>-<plugins>-<runId>.json` 保存每次独立归档，连续执行 isolated adapter 不得覆盖前一次证据。两者 includes:

- `plugins`, `gatewayMode`, `docker`, `installed`, `e2e[]`, `browser[]`
- `serviceUrls`, `dockerPs`, `gatewayLogTail`, `commits`, `runId`, `finishedAt`
- token/secret/password/API key/authorization 字段必须在 latest 与 archive 中同时脱敏

## Execution matrix

```bash
# All plugins, host gateway
OPENCLAW_E2E_HOST_GATEWAY=1 node scripts/e2e/run-e2e.mjs

# Isolated mTLS authentication scenario
OPENCLAW_E2E_HOST_GATEWAY=1 node scripts/e2e/run-e2e.mjs --plugins mtls --skip-browser

# Isolated OAuth2 authentication scenario (host Gateway is selected automatically)
node scripts/e2e/run-e2e.mjs --plugins oauth2 --skip-browser

# Isolated native WebSocket transport scenario (host Gateway is selected automatically)
node scripts/e2e/run-e2e.mjs --plugins web-socket --skip-browser

# Isolated Douyin signed Webhook and restart-dedupe scenario
node scripts/e2e/run-e2e.mjs --plugins douyin --skip-browser

# Isolated AMap Agent Tool and safe-retry scenario
node scripts/e2e/run-e2e.mjs --plugins amap --skip-browser

# Isolated Meituan signed MTOp Agent Tool scenario
node scripts/e2e/run-e2e.mjs --plugins meituan --skip-browser

# Isolated RedNode signed Ark Agent Tool scenario
node scripts/e2e/run-e2e.mjs --plugins rednode --skip-browser

# Isolated WeChat iLink long-poll/reply/restart-dedupe scenario
node scripts/e2e/run-e2e.mjs --plugins wechat --skip-browser

# Isolated WeCom KF encrypted callback/API/restart-dedupe scenario
node scripts/e2e/run-e2e.mjs --plugins wecom-kf --skip-browser

# Isolated Tracing scenario paired with MQTT for a real Agent turn
node scripts/e2e/run-e2e.mjs --plugins tracing,mqtt --skip-browser

# Isolated Bridge scenario paired with MQTT for official Hook and loop-guard verification
node scripts/e2e/run-e2e.mjs --plugins bridge,mqtt --skip-browser

# Container gateway (requires Docker + openclaw CLI resolvable in container)
node scripts/e2e/run-e2e.mjs

# CI-friendly subset without browser
OPENCLAW_E2E_HOST_GATEWAY=1 node scripts/e2e/run-e2e.mjs --plugins mqtt,rabbitmq --skip-browser
```

## Extensibility (future plugins)

1. **Registry** — `lib/registry.mjs`: metadata drives install list + compose services.
2. **Config** — `config/plugins/<id>.mjs`: isolated channel config.
3. **Adapter** — `plugins/<id>.mjs`: protocol-specific assertions.
4. **Categories**:
   - `embedded-service` — no extra compose services
   - `external-broker` — compose services in registry
   - `web-browser` — Playwright + test-web or plugin UI
   - `webhook-platform` — tunnel/mock server + signed webhook fixtures

## Known limitations

- RocketMQ 通过 `mqadmin` 预建合法字符集的入站/回复 Topic；测试失败即失败，不使用 best-effort 假通过。
- Container OpenClaw needs repo mount + global npm install on first run (slower cold start).
- Full install runs unit tests per plugin — long-running on first execution.
- Browser tests require `playwright` devDependency and Chromium download.
- Host `OPENCLAW_BIN` may point outside repo (e.g. wecom extension install) if repo `node_modules` missing.

## Next steps

- Add `--skip-install` CI path with prebuilt extension artifacts
- Add remaining Webhook/platform adapters (wecom, wecom-kf) with real sandbox or faithful local fixtures
- Shared retry/backoff helper in `lib/http.mjs` for flaky broker readiness
- Publish sample (sanitized) `e2e-report.sample.json` for documentation only
