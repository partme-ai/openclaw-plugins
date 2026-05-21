<div align="center">

# OpenClaw Prometheus

**OpenClaw plugin — Prometheus metrics and JSON diagnostics built on the official plugin SDK**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw__prometheus-blue)
![Node](https://img.shields.io/badge/Node.js-20+-green)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

[English](./README.md) | [简体中文](./README.zh-CN.md)

## Introduction

`@partme.ai/openclaw-prometheus` is a **non-channel** plugin for [OpenClaw](https://github.com/openclaw/openclaw). It follows the official plugin model: manifest-driven discovery plus [`definePluginEntry`](https://docs.openclaw.ai/plugins/sdk-entrypoints#definepluginentry), documented `api.runtime.*` helpers, plugin hooks, runtime event listeners, and plugin-owned HTTP routes.

This version intentionally avoids host-private imports and undocumented Gateway internals. Metrics are built from facts the plugin can legally observe:

- `api.runtime.modelAuth`, `api.runtime.channel`, `api.runtime.state`
- plugin hooks such as `message_received`, `message_sent`, `before_tool_call`, `after_tool_call`, `llm_output`, `agent_end`
- `api.runtime.events.onAgentEvent(...)` and `onSessionTranscriptUpdate(...)`
- exporter self metrics for scrape quality, route health, and snapshot freshness

## Core capabilities

- **Pure plugin architecture**: uses only documented SDK surfaces, no host source patching.
- **Metrics layers**: exporter self metrics, runtime snapshot metrics, and hook/event-derived workload metrics.
- **Endpoints**: Prometheus exposition on `{path}` (default `/metrics`), JSON on `{path}/per-object`, `{path}/detailed?family=`, and `{path}/health`.
- **Snapshot refresh**: `snapshotIntervalMs` controls model-auth and channel-activity probe refresh.
- **Collection cache**: `collectIntervalMs` reuses the last successful scrape bundle to reduce cost under frequent Prometheus scrapes (set `0` to disable).
- **Meta metrics**: `openclaw_exporter_build_info`, `openclaw_metrics_last_scrape_duration_seconds`.
- **Optional scrape auth**: Bearer token via `openclaw-prometheus_BEARER_TOKEN` (recommended) or dev-only `scrapeAuth.bearerToken` in config.
- **Enterprise-style operations** (aligned with common Prometheus exporter practice and ideas from [RabbitMQ’s Prometheus guide](https://www.rabbitmq.com/docs/prometheus)): stable metric names, separate “full text” vs JSON drill-down, TLS termination at the Gateway/reverse proxy, and cardinality-aware use of `/detailed?family=`.

### Plugin lifecycle

- Loaded through `package.json` / `openclaw.plugin.json` discovery like any other OpenClaw plugin.
- `register()` wires `api.runtime`, installs hook/event observers, and registers plugin-owned routes with `api.registerHttpRoute`.
- Dedicated `port` in manifest is informational for operators; actual listen port follows the Gateway unless you front it with a separate listener in core.

## Endpoints

| Method & path | Format | Description |
| --- | --- | --- |
| `GET {path}` | Prometheus text | Scrape target (`Content-Type: text/plain; version=0.0.4`) |
| `GET {path}/per-object` | JSON | Grouped metrics for tooling |
| `GET {path}/detailed?family=` | JSON | Filter by substring of metric name |
| `GET {path}/health` | JSON | Exporter health and latest snapshot status |

Default `{path}` is `/metrics`.

## Metric families (prefixes)

| Prefix | Source |
| --- | --- |
| `openclaw_metrics_*` | Exporter-owned route/scrape metrics |
| `openclaw_model_auth_*` | `api.runtime.modelAuth` |
| `openclaw_channel_*` | message hooks + `api.runtime.channel.activity.get(...)` |
| `openclaw_agent_*` | `before_agent_start` / `agent_end` + runtime agent events |
| `openclaw_tool_*` | `before_tool_call` / `after_tool_call` |
| `openclaw_messages_*` | `message_received` / `message_sent` |
| `openclaw_usage_*` | `llm_output` usage aggregation |
| `openclaw_session_transcript_*` | `api.runtime.events.onSessionTranscriptUpdate(...)` |
| `openclaw_runtime_*` | runtime namespace availability + state/snapshot age |
| `openclaw_nodejs_*` | Local process (optional via `includeRuntime`) |
| `openclaw_exporter_*`, `openclaw_metrics_*` | Plugin meta |

## Quick start

### Prerequisites

- OpenClaw `>= 2026.4.0`
- Node.js `20+`

### Install

```bash
openclaw plugins install @partme.ai/openclaw-prometheus
```

### Minimal config (`openclaw.json`)

```json
{
  "plugins": {
    "entries": {
      "openclaw-prometheus": {
        "enabled": true,
        "config": {
          "path": "/metrics",
          "collectIntervalMs": 15000,
          "snapshotIntervalMs": 30000,
          "workloadWindowMs": 300000,
          "includeRuntime": true,
          "monitoredProviders": ["openai", "anthropic", "gemini"],
          "scrapeAuth": {
            "enabled": false
          }
        }
      }
    }
  }
}
```

### Prometheus scrape (with Bearer)

```yaml
scrape_configs:
  - job_name: openclaw
    scrape_interval: 15s
    bearer_token_file: /etc/prometheus/openclaw-metrics.token
    static_configs:
      - targets: ["127.0.0.1:18789"]
    metrics_path: /metrics
```

Set `scrapeAuth.enabled: true` and store the same secret in `openclaw-prometheus_BEARER_TOKEN` on the Gateway host.

### Manual probe (CLI)

```bash
pnpm run test:client -- http://127.0.0.1:18789/metrics
openclaw-prometheus_BEARER_TOKEN=secret pnpm run test:client -- http://127.0.0.1:18789/metrics
```

## Grafana dashboards

Import JSON from [`grafana/`](./grafana/) (single-node and cluster layouts). Prometheus handles metrics; Loki handles historical logs. See [`grafana/README.md`](./grafana/README.md).

## Development

```bash
pnpm install
pnpm run build
pnpm dev
pnpm test
```

## Release version sync

Bump **`package.json` `version`** and [`src/version.ts`](src/version.ts) **`PLUGIN_VERSION`** together before tagging.

## Related plugins

| Plugin | Description |
| --- | --- |
| [openclaw-oauth2](https://github.com/partme-ai/openclaw-oauth2) | OAuth2 authentication |
| [openclaw-mqtt](https://github.com/partme-ai/openclaw-mqtt) | MQTT protocol adapter |
| [openclaw-stomp](https://github.com/partme-ai/openclaw-stomp) | STOMP server |
| [openclaw-web-mqtt](https://github.com/partme-ai/openclaw-web-mqtt) | WebSocket MQTT |
| [openclaw-web-stomp](https://github.com/partme-ai/openclaw-web-stomp) | WebSocket STOMP |
| [openclaw-tracing](https://github.com/partme-ai/openclaw-tracing) | Distributed tracing |
| [openclaw-prometheus](https://github.com/partme-ai/openclaw-prometheus) | Prometheus metrics |
| [openclaw-nacos](https://github.com/partme-ai/openclaw-nacos) | Nacos naming / config |

## License

MIT
