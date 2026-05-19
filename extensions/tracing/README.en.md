# OpenClaw Tracing

**OpenClaw plugin — Distributed tracing for message flows and agent interactions**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--tracing-blue)
![Node](https://img.shields.io/badge/Node.js-20+-green)
![License](https://img.shields.io/badge/License-MIT-green)

[English](./README.md) | [简体中文](./README_CN.md)

---

## 📖 Introduction

`@partme.ai/openclaw-tracing` is a **distributed tracing plugin** for [OpenClaw](https://github.com/openclaw/openclaw) that captures message flows, agent interactions, and tool calls as a complete trace chain. Inspired by rabbitmq_tracing, it uses an OpenTelemetry-compatible data model and supports multiple backends for trace storage.

---

## 🎯 Core Capabilities

- **Complete trace chain**: Captures the full lifecycle from message arrival → agent processing → tool calls → response
- **Multiple backends**: Supports Log / File (JSONL + daily rotation) / OTLP HTTP backends
- **Sampling control**: Deterministic sampling based on traceId hash
- **Privacy protection**: Optional message body capture
- **HTTP API**: Query recent traces via REST endpoints
- **Hook integration**: Automatically traces `command:new`, `tool_result_persist`, and `agent:bootstrap` events
- **Session isolation**: Follows OpenClaw global `session.dmScope` for consistent session tracking

---

## 🏗️ How It Works

### Tracing Data Model

The project uses the [OpenTelemetry Span model](src/types.ts):

```
Trace
  └── Span
        ├── traceId      # Global trace ID linking all related Spans
        ├── spanId       # Current operation ID
        ├── parentSpanId  # Parent Span ID (builds call chain)
        ├── name         # Operation name
        ├── kind         # Span type (server/internal/client)
        ├── startTimeMs  # Start time
        ├── endTimeMs    # End time
        ├── attributes    # Key-value attributes
        └── events       # Time point events
```

### Trace Flow

```
Message Arrives → command:new → agent:bootstrap → tool:xxx → Response
        ↓               ↓              ↓              ↓
   [Root Span]   [Agent Span]   [Tool Span]   [Export Complete]
```

Reference the three core event hooks in [hooks.ts](src/hooks.ts):

| Event | Created Span | Type |
|-------|-------------|------|
| `command:new` | Message arrival root Span | server |
| `agent:bootstrap` | Agent processing Span | internal |
| `tool_result_persist` | Tool call Span | client |

### Session Isolation Strategy

The plugin uses OpenClaw's global `session.dmScope` configuration for session isolation, reference [dm-scope.ts](src/dm-scope.ts):

| dmScope | Session Key Format | Description |
|---------|-------------------|-------------|
| `main` | `agent:agentId:main` | All interactions share one session |
| `per-peer` | `agent:agentId:direct:peerId` | Separate session per peer |
| `per-channel-peer` | `agent:agentId:channel:direct:peerId` | Channel + peer session isolation |
| `per-account-channel-peer` | `agent:agentId:channel:accountId:direct:peerId` | Account + channel + peer isolation |

This aligns with `openclaw-mqtt`, `openclaw-web-mqtt`, `openclaw-stomp`, `openclaw-web-stomp`.

### Tracing Backends

The project supports three backend storage types, reference the [backends/](src/backends/) directory:

| Backend | Config Value | Description |
|---------|--------------|-------------|
| **Log** | `backend: "log"` | Output to console as JSON |
| **File** | `backend: "file"` | JSONL files with daily rotation |
| **OTLP** | `backend: "otlp"` | Push to OTLP-compatible backend |

### Sampling Mechanism

Reference [sampler.ts](src/sampler.ts):

- **Deterministic sampling**: Same `traceId` always produces the same sampling result
- Based on comparing `traceId` hash with `sampleRate`
- Config range: `0.0` (reject all) ~ `1.0` (accept all)

---

## 🚀 Quick Start

### Prerequisites

- OpenClaw `>= 2026.4.0`
- Node.js `20+`

### Install

```bash
openclaw plugins install @partme.ai/openclaw-tracing
```

### Minimal Config (`openclaw.json`)

```json
{
  "tracing": {
    "enabled": true,
    "backend": "log",
    "sampleRate": 1.0,
    "captureMessageBody": false
  },
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

### Full Config Options

```json
{
  "tracing": {
    "enabled": true,
    "backend": "file",
    "otlpEndpoint": "http://localhost:4318",
    "sampleRate": 0.5,
    "traceDir": "./traces",
    "maxSpansPerTrace": 100,
    "captureMessageBody": true
  }
}
```

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | false | Enable tracing |
| `backend` | string | "log" | Backend type: log/file/otlp |
| `otlpEndpoint` | string | "http://localhost:4318" | OTLP HTTP endpoint |
| `sampleRate` | number | 1.0 | Sampling rate 0.0~1.0 |
| `traceDir` | string | "./traces" | File backend storage directory |
| `maxSpansPerTrace` | number | 100 | Max spans per trace |
| `captureMessageBody` | boolean | false | Capture message body |

---

## 📍 HTTP Endpoints

| Endpoint | Method | Description |
| -------- | ------ | ----------- |
| `/tracing/status` | GET | Tracing status and configuration |
| `/tracing/traces` | GET | Recent trace list (supports `?limit=N`) |
| `/tracing/trace` | GET | Detailed trace info (requires `?traceId=xxx`) |

---

## 📁 Project Structure

```
openclaw-tracing/
├── src/
│   ├── index.ts              # Plugin entry point
│   ├── hooks.ts              # Gateway event hooks
│   ├── sampler.ts            # Trace sampler
│   ├── dm-scope.ts           # Session isolation based on dmScope
│   ├── types.ts              # Type definitions
│   ├── backends/
│   │   ├── log-backend.ts    # Log backend
│   │   ├── file-backend.ts   # File backend (JSONL)
│   │   └── otlp-backend.ts   # OTLP HTTP backend
│   └── openclaw-sdk.d.ts     # OpenClaw SDK types
├── .github/workflows/
│   ├── ci.yml               # CI workflow
│   └── release.yml           # Release workflow
├── openclaw.plugin.json       # Plugin manifest
├── package.json
└── README.md / README_CN.md
```

---

## 🧪 Testing

### Unit Tests

```bash
npm test
```

### Test Coverage

```bash
npm run test:coverage
```

---

## 🤖 GitHub Actions

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `.github/workflows/ci.yml` | Push / PR to `main` or `master` | Install, typecheck, build, test, upload `dist/` |
| `.github/workflows/release.yml` | Tag `v*` / manual dispatch | Build, test, publish npm package |

---

## 📦 Publishing

- Package: `@partme.ai/openclaw-tracing`
- Required secret: `NPM_TOKEN`

Tag release example:

```bash
npm version patch
git push origin main --follow-tags
```

---

## OpenClaw Documentation

Official docs for plugins, the SDK, and related topics:

### Plugins

- [Tools — Plugins](https://docs.openclaw.ai/tools/plugin)
- [Community plugins](https://docs.openclaw.ai/plugins/community)
- [Bundles](https://docs.openclaw.ai/plugins/bundles)

### Building Plugins

- [Building plugins](https://docs.openclaw.ai/plugins/building-plugins)
- [SDK overview](https://docs.openclaw.ai/plugins/sdk-overview)
- [SDK entry points](https://docs.openclaw.ai/plugins/sdk-entrypoints)
- [SDK runtime](https://docs.openclaw.ai/plugins/sdk-runtime)

---

## ❓ FAQ

### How does session isolation work?

The plugin uses OpenClaw's global `session.dmScope` configuration to generate consistent session keys, ensuring traces are properly isolated according to your desired scope.

### Can I use this with external observability systems?

Yes, the OTLP backend allows you to export traces to systems like Jaeger, Zipkin, or Prometheus.

### How do I control trace sampling?

Set `sampleRate` between 0.0 and 1.0 in the configuration to control the fraction of traces captured.

### How is message body privacy protected?

Set `captureMessageBody: false` (default) to avoid capturing message content, logging only metadata.

---

## 📄 License

MIT