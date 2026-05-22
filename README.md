# openclaw-plugins

<p align="center">
  <strong>28 Enterprise Plugins. One Unified Ecosystem.</strong><br>
  <sub>IM channels · Message queues · AI capabilities · Infrastructure — production-ready, independently published.</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/search?q=%40partme.ai"><img src="https://img.shields.io/badge/npm-@partme.ai-cb3837?logo=npm" alt="npm"></a>
  <a href="https://github.com/partme-ai/openclaw-plugins"><img src="https://img.shields.io/badge/github-partme--ai%2Fopenclaw--plugins-green.svg" alt="GitHub"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg" alt="Node"></a>
  <a href="https://pnpm.io"><img src="https://img.shields.io/badge/pnpm-9-orange.svg" alt="pnpm"></a>
</p>

<p align="center">
  <a href="#-packages">Packages</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#-official-upstreams">Official Upstreams</a> ·
  <a href="#-plugindevelopment">Plugin Development</a> ·
  <a href="#-cicd">CI/CD</a>
</p>

---

## What is openclaw-plugins?

**openclaw-plugins** is the official plugin ecosystem for [OpenClaw](https://github.com/partme-ai/openclaw) — a pnpm monorepo of 28 independently published npm packages under the `@partme.ai` scope. Built by **PartMe.AI** for enterprise AI agent infrastructure.

Each plugin is **self-contained** — zero cross-plugin dependencies, independently versioned and published. Install only what you need.

---

## Packages

### IM Channels

| Package | Channel ID | Description | Source |
|---------|-----------|-------------|--------|
| [@partme.ai/wecom](./extensions/wecom) | `wecom` | WeChat Work Bot + Agent dual-mode · WebSocket / Webhook / Agent · 20 Skills · MCP tool · dynamic agent routing · 77 source files | Self-built |
| [@partme.ai/weixin](./extensions/wechat) | `openclaw-weixin` | WeChat Official Account / Customer Service · iLink long-poll protocol · CDN upload · SILK audio | Self-built |
| [@partme.ai/wecom-kf](./extensions/wecom-kf) | `wecom-kf` | WeChat Work Customer Service (external WeChat users) · human transfer · session management · satisfaction survey · ICS REST API | Self-built |
| [@partme.ai/wechat-ipad](./extensions/wechat-ipad) | `wechat-ipad` | WeChat iPad protocol bridge · personal WeChat account integration | Self-built |
| [@partme.ai/openclaw-douyin](./extensions/douyin) | `douyin` | Douyin (TikTok China) · OAuth · Webhook | Self-built |
| [@partme.ai/openclaw-bridge](./extensions/bridge) | 21 channels | Unified IM Bridge — one plugin bridges all upstream channels (DingTalk / Feishu / QQ / Discord / Slack / Telegram / WhatsApp / Signal / LINE / Matrix / IRC / Teams / Google Chat / iMessage / Mattermost / Nextcloud Talk / Nostr / Zalo / Twitch / Tlon / Synology Chat) · context injection + UnifiedMessage MQ forwarding | Bridge adapter |

### AI Capabilities

| Package | Plugin ID | Description | Key Features |
|---------|----------|-------------|--------------|
| [@partme.ai/openclaw-knowledge](./extensions/knowledge) | `knowledge` | RAG knowledge base engine | 5 embedding providers (OpenAI / DashScope / Zhipu / Qianfan / Ollama) · 3 vector stores (sqlite-vec / zvec / zvec-native) · hybrid retrieval · reranker · intent gate · auto-injection via `before_prompt_build` |
| [@partme.ai/openclaw-memory](./extensions/memory) | `memory` | Multi-level long-term memory (L0→L3) | `kind: "memory"` contract · MemorySearchManager interface · JSONL primary storage · keyword search · auto-recall |
| [@partme.ai/openclaw-router](./extensions/router) | `router` | Enterprise cross-channel message routing engine | 118 lines of core logic · `agent_end` listener · rule-based forwarding · reply-via cross-channel · topic templating |
| [@partme.ai/openclaw-message-sdk](./extensions/message-sdk) | *(shared library)* | Unified message format SDK | `UnifiedMessage` type + builders · media parsing · HTTP client + retry · Tencent ASR · OCR · TTS · shared error types |

### Message Queues & IoT

| Package | Channel ID | Port | Protocol | Key Features |
|---------|-----------|------|----------|--------------|
| [@partme.ai/openclaw-mqtt](./extensions/mqtt) | `mqtt` | — | MQTT 3.1.1/5.0 | Broker · ACL · QoS · topic routing · will handler · Redis persistence |
| [@partme.ai/openclaw-web-mqtt](./extensions/web-mqtt) | `mqtt-ws` | 15675 | MQTT over WebSocket | User auth · ACL rules · TLS (WSS) · topic bindings · idle timeout |
| [@partme.ai/openclaw-stomp](./extensions/stomp) | `stomp-tcp` | 61613 | STOMP 1.0/1.1/1.2 (TCP) | TLS port 61614 · heartbeat · auth · subscription management |
| [@partme.ai/openclaw-web-stomp](./extensions/web-stomp) | `stomp` | 15674 | STOMP over WebSocket | Frame parser · destination routing · acknowledgement handler |
| [@partme.ai/openclaw-rabbitmq](./extensions/rabbitmq) | `rabbitmq` | — | AMQP 0-9-1 | Exchange (topic/direct/fanout/headers) · quorum queues · retry DLX · idempotency · prefetch |
| [@partme.ai/openclaw-redis-stream](./extensions/redis-stream) | `redis-stream` | — | Redis Pub/Sub + Stream | Consumer groups · dual mode (pubsub / stream) · field mapping · reconnect · connection pooling |
| [@partme.ai/openclaw-rocketmq](./extensions/rocketmq) | `rocketmq` | — | RocketMQ 5.x | Producer/Consumer · topic/tag bindings · session credentials · dispatch modes |
| [@partme.ai/openclaw-cluster](./extensions/cluster) | — | — | Multi-protocol | 8 discovery modes (static/etcd/dns-srv/consul/nacos/redis/eureka/mdns) · config sync · session store · proxy |

**MQ plugins share a common pattern**: `topicBindings` (topicPattern → agentId/accountId/replyTopic) · `payload.mode` (jsonTextOrPlain / jsonOnly / plainText) · `dispatch.mode` (reply-pipeline / embedded-agent / subagent) · `idempotency` (TTL-based dedup).

### Infrastructure

| Package | Plugin ID | Description | Key Features |
|---------|----------|-------------|--------------|
| [@partme.ai/openclaw-nacos](./extensions/nacos) | `openclaw-nacos` | Nacos config center & service registration | Spring Cloud compatible · shared configs merge · cluster peer discovery · webhook registration · 30+ config properties |
| [@partme.ai/openclaw-prometheus](./extensions/prometheus) | `openclaw-prometheus` | Prometheus metrics exporter | Port 9090 · scrape auth (Bearer) · model usage histograms · runtime metrics · Grafana dashboards |
| [@partme.ai/openclaw-tracing](./extensions/tracing) | `openclaw-tracing` | OpenTelemetry distributed tracing | 4 backends (log / file / OTLP / SkyWalking) · sampling · span limits · message body capture |
| [@partme.ai/openclaw-mtls](./extensions/mtls) | `openclaw-mtls` | Mutual TLS authentication | Certificate management · client whitelist · protected paths · passthrough mode · cert info header |
| [@partme.ai/openclaw-oauth2](./extensions/oauth2) | `openclaw-oauth2` | OAuth 2.0 authentication | 5 providers (Sa-Token / Keycloak / Auth0 / Azure AD / generic) · JWT · introspection |
| [@partme.ai/openclaw-gotify](./extensions/gotify) | `openclaw-gotify` | Gotify push notifications | REST + WebSocket stream · bootstrap auto-create app · multi-account · priority · reconnect |

### Platform Integrations

| Package | Channel ID | Description | Key Features |
|---------|-----------|-------------|--------------|
| [@partme.ai/openclaw-amap](./extensions/amap) | `amap` | Amap (Gaode Map) | POI management · Webhook callback |
| [@partme.ai/openclaw-meituan](./extensions/meituan) | `meituan` | Meituan | Shop management · Webhook |
| [@partme.ai/openclaw-rednode](./extensions/rednode) | `xhs` | RedNote (Xiaohongshu) | Dual-mode (direct + ddd4j multi-tenant base) |

---

## Architecture

openclaw-plugins follows a **five-layer model**:

```
Layer 5 — Business Apps       SCRM, dashboards, analytics
Layer 4 — Router + Bridge     Rule engine, forwarding, audit, cross-channel context
Layer 3 — OpenClaw Agents     Per-tenant/per-function, each binds memory + knowledge + tools
Layer 2 — AI Capabilities     Knowledge/RAG · Memory L0-L3 · Tracing · OAuth2
Layer 1 — Channels            IM (5 self-built + 21 via bridge) · MQ (8 protocol bridges)
```

**Core design principle**: Never modify channel code. The router and bridge plugins sit outside all channels, observing `agent_end` and `before_prompt_build` events that fire for every channel. This enables cross-channel message routing and context injection without touching any channel plugin.

### Three Message Flows

1. **IM Inbound**: User message → Channel plugin → Agent → Reply to channel + Router forwards copy to MQ for audit
2. **MQ Inbound**: Business system publishes to MQ → Agent → Reply to channel + Router forwards copy
3. **Enhancement**: Any message → `before_prompt_build` → knowledge auto-search + memory auto-recall → injected before LLM sees prompt

---

## Official Upstreams

These IM channels are maintained by their platform teams. They are integrated into the PartMe.AI ecosystem via `@partme.ai/openclaw-bridge` — **no local forks**:

| Platform | Official Plugin | Repository | Docs |
|----------|----------------|------------|------|
| 钉钉 (DingTalk) | `@dingtalk-real-ai/dingtalk-connector` | [DingTalk-Real-AI/dingtalk-openclaw-connector](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector) | [dws CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) |
| 飞书 (Feishu/Lark) | `@larksuite/openclaw-lark` | [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark) | [Official Docs](https://bytedance.larkoffice.com/docx/MFK7dDFLFoVlOGxWCv5cTXKmnMh) |
| QQ | `@tencent-connect/openclaw-qqbot` | [tencent-connect/openclaw-qqbot](https://github.com/tencent-connect/openclaw-qqbot) | — |

### Bundled Channels (18)

The following are bundled with OpenClaw and bridged via `@partme.ai/openclaw-bridge` with zero additional install:

`discord` `slack` `telegram` `whatsapp` `signal` `line` `matrix` `irc` `msteams` `googlechat` `imessage` `mattermost` `nextcloud-talk` `nostr` `zalo` `twitch` `tlon` `synology-chat`

See [@partme.ai/openclaw-bridge](./extensions/bridge) for full configuration.

---

## Quick Start

### Prerequisites

- **Node.js** >= 22.0.0 · **pnpm** >= 9 · **OpenClaw** >= 2026.4.12

### Install a Plugin

```bash
# Self-built IM channels
openclaw plugins install @partme.ai/wecom

# Official upstream (requires separate install)
openclaw plugins install @dingtalk-real-ai/dingtalk-connector
openclaw plugins install @larksuite/openclaw-lark
openclaw plugins install @tencent-connect/openclaw-qqbot

# Bridge adapter (integrates all channels into PartMe.AI ecosystem)
openclaw plugins install @partme.ai/openclaw-bridge

# Infrastructure & AI capabilities
openclaw plugins install @partme.ai/openclaw-knowledge
openclaw plugins install @partme.ai/openclaw-prometheus
```

### Development

```bash
git clone https://github.com/partme-ai/openclaw-plugins.git
cd openclaw-plugins
pnpm install

# Build all
pnpm build

# TypeScript check all
pnpm typecheck

# Work on a single plugin
cd extensions/wecom
pnpm dev            # watch mode
pnpm test:watch     # test watch mode

# Create new plugin from template
pnpm new-plugin <name> --label "Display Name" --desc "Description"
```

---

## Plugin Development

All plugins follow the [Plugin Specification](./spec/PLUGIN_SPEC.md). Every plugin:

| File | Purpose |
|------|---------|
| `index.ts` | Plugin entry: default export with `id`, `name`, `configSchema`, `register(api)` |
| `openclaw.plugin.json` | Manifest: channel ownership, config schema, contracts, activation hints |
| `package.json` | npm metadata: `@partme.ai/<name>`, `type: "module"`, `openclaw` block |
| `src/channel.ts` | ChannelPlugin implementation (for channel plugins) |
| `src/config.ts` | Zod schema for runtime validation |
| `src/runtime.ts` | Runtime state singleton |
| `src/monitor.ts` | Message dedup (60s TTL, 10K max) + webhook handler |
| `src/media.ts` | Media loading: `detectMediaType`, `loadMedia`, `downloadMedia` |

### Entry Point Patterns

Three registration styles coexist in the monorepo:

```typescript
// Style A: Direct object export (most plugins)
const plugin = { id, name, configSchema, register(api) { ... } };
export default plugin;

// Style B: defineChannelPluginEntry wrapper (wechat, some MQ plugins)
export default defineChannelPluginEntry({ id, plugin, setRuntime });

// Style C: Re-export from src/ (infrastructure & platform plugins)
export { default } from "./src/index.js";
```

### Manifest Patterns

| Pattern | Plugin Type | Example |
|---------|------------|---------|
| Full channel + channelConfigs schema | Channel plugins | wecom, mqtt, gotify, rabbitmq |
| Simple channel config | Lightweight channels | amap, meituan, wechat-ipad |
| Pure capability (no channels) | Infrastructure / AI | knowledge, prometheus, nacos, tracing |
| Minimal (additionalProperties: true) | Router, bridge | router |

### Build Toolchain

- **TypeScript**: ES2022 target, NodeNext modules, strict mode, base config at root
- **Build**: `tsup` (ESM) for most plugins; `tsc` for wecom and gotify
- **Test**: `vitest` with co-located `*.test.ts` files, 80%+ coverage target
- **Versioning**: `YYYY.M.D` for active plugins; semver for stable; prerelease via `--tag next`

---

## CI/CD

| Workflow | File | Description |
|----------|------|-------------|
| CI | `.github/workflows/ci.yml` | Matrix build per changed plugin: install → typecheck → build |
| Nacos | `.github/workflows/build-nacos.yml` | Dedicated strict build for nacos plugin |
| Publish | `.github/workflows/publish.yml` | Manual trigger with dry-run default |

### Publishing

```bash
# Preview
node scripts/publish-changed.mjs --dry-run

# Publish a single plugin
node scripts/publish-changed.mjs --plugin wecom

# Publish all changed (local version > npm version)
node scripts/publish-changed.mjs

# Prerelease
node scripts/publish-changed.mjs --plugin wecom --tag next
```

---

## Documentation

| Document | Description |
|----------|------------|
| [Architecture](./doc/OpenClaw-Plugins-Architecture.md) / [架构设计](./doc/OpenClaw-Plugins-Architecture_CN.md) | Full architectural design |
| [Getting Started](./doc/OpenClaw-Plugins-Getting-Started.md) / [快速开始](./doc/OpenClaw-Plugins-Getting-Started_CN.md) | Installation and configuration |
| [Contributing](./doc/OpenClaw-Plugins-Contributing.md) / [贡献指南](./doc/OpenClaw-Plugins-Contributing_CN.md) | How to add a new plugin |
| [Plugin Spec](./spec/PLUGIN_SPEC.md) | Plugin contract |
| [IM Channels](./doc/im-channels/OpenClaw-IM-Channels.md) | All IM channel plugins overview |
| [WeCom Guide](./doc/im-channels/wecom/OpenClaw-WeCom-Configuration.md) | WeChat Work full configuration |
| [Bridge README](./extensions/bridge/README.md) | Bridge plugin: 21 channels, one config |

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22+ (ESM) |
| Language | TypeScript 5.x (strict mode) |
| Package Manager | pnpm 9 (workspaces) |
| Build | tsup (ES2022) / tsc |
| Test | Vitest 4.x |
| Config Validation | Zod 4.x |
| HTTP Client | undici |
| Message SDK | [@partme.ai/openclaw-message-sdk](./extensions/message-sdk) |

---

## License

Plugins are released under their respective licenses.  
Core infrastructure and self-built plugins: **MIT License**.  
Forked official plugins retain their original licenses.

**Made with ❤️ by PartMe.AI Team**
