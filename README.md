<div align="center">

# openclaw-plugins

**28 Enterprise Plugins. One Unified Ecosystem.**

*IM channels · Message queues · AI capabilities · Infrastructure — production-ready, independently published.*

[![npm](https://img.shields.io/badge/npm-@partme.ai-cb3837?logo=npm)](https://www.npmjs.com/search?q=%40partme.ai)
[![GitHub](https://img.shields.io/badge/github-partme--ai%2Fopenclaw--plugins-green.svg)](https://github.com/partme-ai/openclaw-plugins)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-9-orange.svg)](https://pnpm.io)

English | [简体中文](./README.zh-CN.md)

[Introduction](#-introduction) ·
[Design Principles](#-core-design-principles) ·
[Architecture](#-architecture) ·
[Plugins](#-plugin-catalog) ·
[Quick Start](#-quick-start) ·
[Core Features](#-core-features) ·
[Development](#-plugin-development) ·
[CI/CD](#-cicd) ·
[Docs](#-documentation) ·
[Contributing](#-contributing)

</div>

---

## 📖 Introduction

**openclaw-plugins** is the official enterprise plugin ecosystem for [OpenClaw](https://github.com/partme-ai/openclaw) — a **pnpm monorepo** of **28 independently published npm packages** under the `@partme.ai` scope, maintained by **PartMe.AI**.

OpenClaw Gateway runs AI Agents at the center. This repository connects **IM channels**, **message queues**, **RAG knowledge**, **long-term memory**, **observability**, and **enterprise infrastructure** into one closed-loop, multi-platform information flow.

Each plugin is **self-contained**: zero cross-plugin runtime dependencies (except the shared `@partme.ai/openclaw-message-sdk` library). Install only what you need; version and publish independently.

### Problems We Solve

| Gap | Problem | Solution |
|-----|---------|----------|
| **Cross-channel routing** | IM messages cannot auto-forward to MQ; MQ messages cannot reply to IM | [@partme.ai/openclaw-router](./extensions/router) |
| **Knowledge out-of-the-box** | Agents must manually call RAG tools | Router + [@partme.ai/openclaw-knowledge](./extensions/knowledge) auto-inject via `before_prompt_build` |
| **Long-term memory** | Every conversation starts from zero | [@partme.ai/openclaw-memory](./extensions/memory) (L0→L3) + [@partme.ai/openclaw-openmem](./extensions/openmem) |
| **Message audit** | No unified message record | Router audit + MQ forward-copy rules |
| **Unified wire format** | Each MQ plugin reimplements parsing | [@partme.ai/openclaw-message-sdk](./extensions/message-sdk) Wire / Transcript dual path |

See the full design in [Architecture](./doc/OpenClaw-Plugins-Architecture.md).

---

## 🎯 Core Design Principles

#### **Self-Contained Plugins**

- One npm package per plugin under `extensions/<name>/`
- No runtime dependency on sibling plugins
- **Exception**: `@partme.ai/openclaw-message-sdk` — shared message types, ingress/egress, and OpenClaw bridge helpers
- **Monorepo dev**: consumers use `workspace:^<sdkVersion>`; `publish-changed.mjs` materializes to `^version` on npm publish, then restores

#### **Never Modify Channel Code**

> OpenClaw's `api.on("agent_end", ctx)` fires for **all** channels. Non-channel plugins can observe every message flow.

The **router** and **bridge** sit outside channel plugins, listening to `agent_end` and `before_prompt_build`. Cross-channel routing, audit forwarding, and context injection work without forking wecom, mqtt, or any upstream channel.

#### **message-sdk Dual Path (Wire vs Transcript)**

| Path | Typical plugins | SDK entry | Use case |
|------|-----------------|-----------|----------|
| **Wire** | mqtt, rabbitmq, redis-stream, rocketmq, stomp, web-mqtt, web-stomp | `dispatchWireMessage` → `dispatchInbound` | Machine-to-machine JSON envelopes |
| **Transcript** | gotify, wecom, feishu-style IM | `dispatchTranscriptTurn` → `turn.runAssembled` | Human-readable Control UI turns |

Both paths share `UnifiedMessage`, dedup, and reply helpers. Details: [message-sdk ARCHITECTURE](./extensions/message-sdk/docs/ARCHITECTURE.md).

#### **Multi-Account Isolation**

Most channel plugins support `accounts` + `defaultAccount`. Sessions, Agents, and runtime state are fully isolated per `accountId` — one Gateway, many tenants.

---

## ✨ Ecosystem Capabilities

| Layer | Category | Count | Representative packages | Key capabilities |
|-------|----------|-------|-------------------------|------------------|
| L1 | **IM (self-built)** | 6 | wecom, weixin, wecom-kf, wechat-ipad, douyin, gotify | Bot/Webhook/Agent modes · media · dedup · Skills |
| L1 | **IM (bridge)** | 1 + 21 upstream | openclaw-bridge | Context injection · UnifiedMessage MQ forwarding · 21 bundled channels |
| L1 | **Message queues** | 8 | mqtt, web-mqtt, stomp, web-stomp, rabbitmq, redis-stream, rocketmq, cluster | topicBindings · Wire dispatch · idempotency · multi-protocol discovery |
| L2 | **AI capabilities** | 5 | knowledge, memory, router, openmem, message-sdk | RAG · L0–L3 memory · routing rules · OpenMem HTTP bridge · unified wire format |
| L2–L4 | **Infrastructure** | 5 | nacos, prometheus, tracing, oauth2, mtls | Config center · metrics · OTel · auth · mTLS |
| — | **Platform integrations** | 3 | amap, meituan, rednode | POI/shop webhooks · Xiaohongshu dual-mode |

**Full plugin matrix** (all 28 packages, npm names, feature notes): [Architecture — Plugin Overview](./doc/OpenClaw-Plugins-Architecture.md).

---

## 🏢 Use Cases

| Scenario | Typical plugin stack |
|----------|---------------------|
| **Enterprise IM customer service** | wecom / wecom-kf + knowledge + memory + router |
| **Business system ↔ Agent** | mqtt / rabbitmq + message-sdk Wire path |
| **Multi-cloud config & registration** | nacos + cluster |
| **Production observability** | prometheus + tracing |
| **Omnichannel without forking upstream** | openclaw-bridge + official dingtalk / lark / qq connectors |
| **Local-first external memory** | openmem + OpenMem sidecar (port 3317) |
| **Push alerts to mobile** | gotify + prometheus / custom publishers |

---

## 📦 Project Positioning

**openclaw-plugins** targets **production enterprise AI agent infrastructure**, not demos:

- **Independent npm publishing** — each `@partme.ai/*` package versioned separately (`YYYY.M.D` for active plugins)
- **Composable** — Gateway + only the plugins you need
- **Upstream-friendly** — official DingTalk / Feishu / QQ plugins are **not forked**; integrate via bridge
- **OpenClaw-native** — implements OpenClaw Plugin API, ChannelPlugin, Memory Host SDK, and setupEntry patterns

---

## 🏗️ Architecture

### Five-Layer Model

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5 — Business Applications                            │
│  SCRM dashboard · Live chat console · Data analytics          │
│  Subscribe to MQ topics for real-time conversation feed     │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Layer 4 — Router + Bridge                                  │
│  Rule engine · Forward engine · Audit · Knowledge/Memory inj. │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Layer 3 — OpenClaw Agents                                  │
│  Agent-1 (ops) · Agent-2 (sales) · Agent-3 (support) …      │
│  bindings[].match → agentId · memory + knowledge + tools      │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Layer 2 — AI Capabilities                                  │
│  knowledge (RAG) · memory (L0→L3) · openmem · tracing       │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Layer 1 — Channels (no modification needed)                │
│  IM: wecom wechat wecom-kf gotify … + bridge (21 upstream)  │
│  MQ: mqtt rabbitmq redis-stream rocketmq stomp cluster …    │
└─────────────────────────────────────────────────────────────┘
```

### Monorepo Layout

```
openclaw-plugins/
├── extensions/              # 28 npm packages (excludes _template)
│   ├── wecom/ mqtt/ …         # Channel & capability plugins
│   └── message-sdk/           # Shared library (not a Gateway plugin)
├── doc/                       # Architecture, getting started, contributing
├── spec/PLUGIN_SPEC.md        # Plugin contract
├── scripts/
│   ├── publish-changed.mjs    # npm publish with workspace materialize
│   └── sync-message-sdk-deps.mjs
└── .github/workflows/         # CI, nacos build, publish
```

### message-sdk Layers

| Layer | Responsibility | Location |
|-------|----------------|----------|
| **Transport** | Connect, subscribe, publish, ACK, platform protocol | Each MQ/IM extension |
| **Message** | UnifiedMessage, parse/serialize, dedup, bridge dispatch | message-sdk |
| **Agent** | Routing, session, LLM | OpenClaw Gateway |

### Three Message Flows

**Flow 1 — IM inbound (user → Agent → MQ audit)**

```
Customer @WeCom → [wecom] → Agent → reply to WeCom
                              └── [router] agent_end → forward-copy → [mqtt] audit topic → SCRM
```

**Flow 2 — MQ inbound (business system → Agent → IM reply)**

```
Monitoring → MQTT publish → [mqtt] → Agent → reply on topic
                              └── [router] agent_end → reply-via:wecom → ops engineer notified
```

**Flow 3 — Enhancement (every conversation)**

```
Any message → [router] before_prompt_build
                ├─ [knowledge] auto-search → inject into system context
                └─ [memory] auto-recall → inject user history
              → Agent sees RAG + memory without explicit tool calls
```

Full diagrams: [Architecture §2.3](./doc/OpenClaw-Plugins-Architecture.md).

---

## 📋 Plugin Catalog

Summary by category. For npm names, channel IDs, ports, and feature matrices, see [Architecture doc](./doc/OpenClaw-Plugins-Architecture.md).

| Category | Packages | Highlights |
|----------|----------|------------|
| **IM (self-built)** | 6 | WeCom dual-mode · WeChat OA · WeCom KF · WeChat iPad · Douyin · Gotify push |
| **IM (bridge)** | 1 | 21 upstream channels via single config — see [bridge README](./extensions/bridge/README.md) |
| **AI & routing** | 5 | knowledge · memory · router · openmem · message-sdk |
| **Message queues** | 8 | MQTT/STOMP/RabbitMQ/Redis/RocketMQ + Web variants + cluster discovery |
| **Infrastructure** | 5 | nacos · prometheus · tracing · oauth2 · mtls |
| **Platform** | 3 | amap · meituan · rednode (XHS) |

**MQ plugins share**: `topicBindings` · `payload.mode` (jsonTextOrPlain / jsonOnly / plainText) · `dispatch.mode` (reply-pipeline / embedded-agent / subagent) · `idempotency` (TTL dedup).

Per-plugin READMEs live under `extensions/<name>/README.md` and `README.zh-CN.md`.

---

## 🔗 Official Upstreams

These IM channels are maintained by platform teams. Integrate via `@partme.ai/openclaw-bridge` — **no local forks**:

| Platform | Official plugin | Repository | Docs |
|----------|----------------|------------|------|
| DingTalk | `@dingtalk-real-ai/dingtalk-connector` | [dingtalk-openclaw-connector](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector) | [dws CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) |
| Feishu / Lark | `@larksuite/openclaw-lark` | [openclaw-lark](https://github.com/larksuite/openclaw-lark) | [Official docs](https://bytedance.larkoffice.com/docx/MFK7dDFLFoVlOGxWCv5cTXKmnMh) |
| QQ | `@tencent-connect/openclaw-qqbot` | [openclaw-qqbot](https://github.com/tencent-connect/openclaw-qqbot) | — |

### Bundled Channels (18)

Shipped with OpenClaw, bridged via `@partme.ai/openclaw-bridge` with zero extra install:

`discord` `slack` `telegram` `whatsapp` `signal` `line` `matrix` `irc` `msteams` `googlechat` `imessage` `mattermost` `nextcloud-talk` `nostr` `zalo` `twitch` `tlon` `synology-chat`

---

## 📖 Quick Start

#### Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 9 (monorepo contributors)
- **OpenClaw** >= 2026.4.12 — [OpenClaw repository](https://github.com/partme-ai/openclaw)

#### 1. Install OpenClaw Gateway

Follow the OpenClaw project docs to install and start the Gateway on your host or cluster.

#### 2. Install plugins

```bash
# Self-built IM channels
openclaw plugins install @partme.ai/wecom
openclaw plugins install @partme.ai/openclaw-gotify

# Official upstream (install separately, then bridge)
openclaw plugins install @dingtalk-real-ai/dingtalk-connector
openclaw plugins install @larksuite/openclaw-lark
openclaw plugins install @tencent-connect/openclaw-qqbot

# Bridge adapter (unifies all channels into PartMe.AI ecosystem)
openclaw plugins install @partme.ai/openclaw-bridge

# AI capabilities & infrastructure
openclaw plugins install @partme.ai/openclaw-knowledge
openclaw plugins install @partme.ai/openclaw-memory
openclaw plugins install @partme.ai/openclaw-router
openclaw plugins install @partme.ai/openclaw-nacos
openclaw plugins install @partme.ai/openclaw-prometheus

# Message queues
openclaw plugins install @partme.ai/openclaw-mqtt
openclaw plugins install @partme.ai/openclaw-rabbitmq
```

#### 3. Configure (minimal example)

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "dmPolicy": "open",
      "groupPolicy": "open",
      "defaultAccount": "main",
      "accounts": {
        "main": {
          "botId": "your-bot-id",
          "secret": "your-secret"
        }
      }
    }
  }
}
```

Common fields: `enabled`, `dmPolicy`, `groupPolicy`, `allowFrom`, `accounts`, `defaultAccount`. See [Getting Started](./doc/OpenClaw-Plugins-Getting-Started.md).

#### 4. Restart Gateway

```bash
openclaw gateway restart
```

#### 5. Develop from source

```bash
git clone https://github.com/partme-ai/openclaw-plugins.git
cd openclaw-plugins
pnpm install
pnpm build
pnpm typecheck

cd extensions/wecom
pnpm dev            # watch mode
pnpm test           # vitest
```

#### 6. Monorepo: sync message-sdk deps

After bumping `extensions/message-sdk` version:

```bash
pnpm sync-message-sdk-deps
pnpm install
```

---

## 📝 Core Features

#### 1. Cross-Channel Routing (router)

- Listens to `agent_end` on **all** channels
- Rule engine: forward-copy, reply-via, topic templating
- Audit logging to MQ without modifying channel code
- ~118 lines of core routing logic — see [router](./extensions/router)

#### 2. RAG Knowledge (knowledge)

- 5 embedding providers (OpenAI, DashScope, Zhipu, Qianfan, Ollama)
- 3 vector stores (sqlite-vec, zvec, zvec-native)
- Hybrid retrieval, reranker, intent gate
- Auto-injection via `before_prompt_build` when combined with router

#### 3. Long-Term Memory (memory + openmem)

- **memory**: L0→L3 levels, `kind: "memory"` contract, JSONL storage, keyword search, auto-recall
- **openmem**: HTTP bridge to OpenMem sidecar — hybrid recall via `/inspect/search`, ingest via `/events/ingest`, `openmem_search` tool

#### 4. Unified MQ Access (message-sdk + MQ plugins)

- Wire JSON envelope v1 with backward-compatible plain text
- Shared `topicBindings`, dispatch modes, idempotency cache
- Plugins: mqtt, rabbitmq, redis-stream, rocketmq, stomp, web-mqtt, web-stomp, cluster

#### 5. Enterprise Infrastructure

- **nacos**: Spring Cloud compatible config merge, service registration, cluster peer discovery ([Nacos docs](./doc/nacos/OpenClaw-Nacos-Guide.md))
- **oauth2**: Sa-Token, Keycloak, Auth0, Azure AD, generic JWT/introspection
- **mtls**: Client cert whitelist, protected paths, passthrough mode

#### 6. Observability

- **prometheus**: Port 9090, scrape auth, model usage histograms, Grafana dashboards ([Prometheus docs](./doc/prometheus/OpenClaw-Prometheus-Deployment.md))
- **tracing**: OpenTelemetry — log / file / OTLP / SkyWalking backends, sampling, span limits

---

## 🛠️ Plugin Development

All plugins follow the [Plugin Specification](./spec/PLUGIN_SPEC.md). Scaffold:

```bash
pnpm new-plugin <name> --label "Display Name" --desc "Description"
```

| File | Purpose |
|------|---------|
| `index.ts` | Entry: `id`, `name`, `configSchema`, `register(api)` |
| `openclaw.plugin.json` | Manifest: channels, config schema, contracts |
| `package.json` | npm metadata, `openclaw` block, `@partme.ai/<name>` |
| `src/channel.ts` | ChannelPlugin (channel plugins) |
| `src/config.ts` | Zod schema + JSON Schema export |
| `src/runtime.ts` | Runtime singleton |
| `src/monitor.ts` | Dedup (60s TTL, 10K max) + webhook handler |
| `src/media.ts` | `detectMediaType`, `loadMedia`, `downloadMedia` |

### Entry Point Patterns

```typescript
// Style A: Direct object export (most plugins)
const plugin = { id, name, configSchema, register(api) { ... } };
export default plugin;

// Style B: defineChannelPluginEntry (wechat, some MQ plugins)
export default defineChannelPluginEntry({ id, plugin, setRuntime });

// Style C: Re-export from src/ (infrastructure & platform plugins)
export { default } from "./src/index.js";
```

### Manifest Patterns

| Pattern | Plugin type | Example |
|---------|-------------|---------|
| Full channel + channelConfigs schema | Channel plugins | wecom, mqtt, gotify, rabbitmq |
| Simple channel config | Lightweight channels | amap, meituan, wechat-ipad |
| Pure capability (no channels) | Infrastructure / AI | knowledge, prometheus, nacos, tracing |
| Minimal (`additionalProperties: true`) | Router, bridge | router, bridge |

Requirements: TypeScript strict, Zod validation, co-located tests, 80%+ coverage target. Full guide: [Contributing](./doc/OpenClaw-Plugins-Contributing.md).

---

## 🔄 CI/CD

| Workflow | File | Description |
|----------|------|-------------|
| CI | `.github/workflows/ci.yml` | Matrix build per changed plugin: install → typecheck → build |
| Nacos | `.github/workflows/build-nacos.yml` | Dedicated strict build + test for nacos |
| Publish | `.github/workflows/publish.yml` | Manual trigger, dry-run by default |

### Publishing

```bash
node scripts/publish-changed.mjs --dry-run
node scripts/publish-changed.mjs --plugin wecom
node scripts/publish-changed.mjs
node scripts/publish-changed.mjs --plugin wecom --tag next   # prerelease
```

**Workspace deps**: consumers declare `workspace:^<sdkVersion>` in dev; publish script temporarily replaces with `^version` for npm, then restores `package.json`.

---

## 🛠️ Tech Stack

#### Core

- **Node.js** 22+ (ESM)
- **TypeScript** 5.x strict mode
- **pnpm** 9 workspaces
- **OpenClaw** Plugin API >= 2026.4.6

#### Build & Test

- **tsup** (ES2022) / **tsc** — production builds
- **Vitest** 4.x — co-located `*.test.ts`
- **Zod** 4.x — runtime config validation

#### Integration

- **undici** — HTTP client (where applicable)
- **@partme.ai/openclaw-message-sdk** — unified wire format + bridge
- Platform SDKs per plugin (nacos, amqp, mqtt, etc.)

#### Observability

- **Prometheus** metrics exporter
- **OpenTelemetry** tracing (OTLP / SkyWalking / file / log)

---

## 📦 Version Information

| Item | Current |
|------|---------|
| OpenClaw peer dependency | >= 2026.4.12 |
| message-sdk | 2026.5.22 |
| openclaw-nacos | 2026.5.24 |
| openclaw-gotify | 2026.5.22 |
| Most active plugins | 2026.5.20 |
| Version scheme | `YYYY.M.D` (active) · semver (stable) · prerelease via `--tag next` |

Check npm for published versions: [@partme.ai on npm](https://www.npmjs.com/search?q=%40partme.ai).

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [Architecture](./doc/OpenClaw-Plugins-Architecture.md) / [架构设计](./doc/OpenClaw-Plugins-Architecture_CN.md) | Full five-layer design & plugin matrix |
| [Getting Started](./doc/OpenClaw-Plugins-Getting-Started.md) / [快速开始](./doc/OpenClaw-Plugins-Getting-Started_CN.md) | Install, configure, multi-account |
| [Contributing](./doc/OpenClaw-Plugins-Contributing.md) / [贡献指南](./doc/OpenClaw-Plugins-Contributing_CN.md) | New plugin scaffold & test conventions |
| [Plugin Spec](./spec/PLUGIN_SPEC.md) | Plugin contract |
| [message-sdk ARCHITECTURE](./extensions/message-sdk/docs/ARCHITECTURE.md) | Wire vs Transcript, bridge API |
| [Nacos Guide](./doc/nacos/OpenClaw-Nacos-Guide.md) / [中文](./doc/nacos/zh/OpenClaw-Nacos-Guide_CN.md) | Config center & registration |
| [WeCom Configuration](./doc/wecom/OpenClaw-WeCom-Configuration.md) | WeChat Work full setup |
| [Bridge README](./extensions/bridge/README.md) | 21 channels, one config |
| [Doc index](./doc/README.md) | All topic guides (prometheus, gotify, rocketmq, …) |

---

## 🔗 Related Links

#### Official resources

- **OpenClaw**: [github.com/partme-ai/openclaw](https://github.com/partme-ai/openclaw)
- **openclaw-plugins**: [github.com/partme-ai/openclaw-plugins](https://github.com/partme-ai/openclaw-plugins)
- **npm scope**: [npmjs.com — @partme.ai](https://www.npmjs.com/search?q=%40partme.ai)
- **Issues**: [GitHub Issues](https://github.com/partme-ai/openclaw-plugins/issues)

#### Upstream connectors

- [DingTalk OpenClaw Connector](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector)
- [Feishu OpenClaw Lark](https://github.com/larksuite/openclaw-lark)
- [Tencent QQ Bot](https://github.com/tencent-connect/openclaw-qqbot)

---

## 🤝 Contributing

We welcome contributions. Typical flow:

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/my-plugin`)
3. Commit changes (`git commit -m 'feat(wecom): add example handler'`)
4. Push to the branch (`git push origin feature/my-plugin`)
5. Open a Pull Request

Use `pnpm new-plugin` for scaffolding. Ensure `pnpm test` and `pnpm typecheck` pass in your plugin directory. See [Contributing guide](./doc/OpenClaw-Plugins-Contributing.md).

---

## 📄 License

Plugins are released under their respective licenses.  
Core infrastructure and self-built plugins: **MIT License**.  
Forked or upstream-derived plugins retain their original licenses.

---

## 🙏 Acknowledgments

Thanks to the teams and projects that make this ecosystem possible:

- [OpenClaw](https://github.com/partme-ai/openclaw) — AI agent gateway
- [Nacos](https://nacos.io) — configuration & service discovery
- [Vitest](https://vitest.dev) — test runner
- [pnpm](https://pnpm.io) — monorepo package manager
- DingTalk / Feishu / Tencent — official channel connectors

---

<div align="center">

**If this project helps you, please give us a ⭐️**

Made with ❤️ by PartMe.AI Team

</div>
