<div align="center">

# OpenClaw Prometheus

**基于官方插件 SDK 的 Prometheus 指标与 JSON 诊断端点**

[![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw__prometheus-blue)](https://www.npmjs.com/package/@partme.ai/openclaw-prometheus)
[![Node](https://img.shields.io/badge/Node.js-20+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

</div>

[English](./README.en.md) | 简体中文

---

## 功能特性

- **纯插件架构** -- 只使用官方 SDK 暴露的稳定能力，无需修改 OpenClaw 核心
- **三层指标面** -- exporter 自身指标、runtime 快照指标、hooks/events 驱动的 workload 指标
- **多端点支持** -- Prometheus text 格式、按对象分组 JSON、按名称过滤 JSON、健康检查 JSON
- **采集缓存** -- 可配置的采集间隔，复用上次结果减轻 Prometheus 频繁抓取压力
- **可选抓取鉴权** -- Bearer Token 认证，推荐通过环境变量配置
- **Grafana 看板** -- 提供单节点与集群两套 JSON 模板
- **企业级运维取向** -- 专用路径、按实体分组 JSON、TLS 由 Gateway 终止

## 指标族（前缀）

| 前缀 | 数据来源 |
|------|----------|
| `openclaw_metrics_*` | exporter 自己的 route/scrape 指标 |
| `openclaw_model_auth_*` | `api.runtime.modelAuth` |
| `openclaw_channel_*` | message hooks + `api.runtime.channel.activity.get(...)` |
| `openclaw_agent_*` | `before_agent_start` / `agent_end` + runtime agent events |
| `openclaw_tool_*` | `before_tool_call` / `after_tool_call` |
| `openclaw_messages_*` | `message_received` / `message_sent` |
| `openclaw_usage_*` | `llm_output` usage 聚合 |
| `openclaw_session_transcript_*` | `onSessionTranscriptUpdate(...)` |
| `openclaw_runtime_*` | runtime namespace 可用性 + state/snapshot age |
| `openclaw_nodejs_*` | 本进程（`includeRuntime`） |
| `openclaw_exporter_*`、`openclaw_metrics_*` | 插件自身 |

## 快速开始

### 前置条件

- OpenClaw >= 2026.4.0
- Node.js 20+

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-prometheus
```

### 最小配置

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

### Prometheus 抓取配置

```yaml
scrape_configs:
  - job_name: openclaw
    scrape_interval: 15s
    bearer_token_file: /etc/prometheus/openclaw-metrics.token
    static_configs:
      - targets: ["127.0.0.1:18789"]
    metrics_path: /metrics
```

设置 `scrapeAuth.enabled: true`，在 Gateway 环境设置 `openclaw-prometheus_BEARER_TOKEN`，与 Prometheus 使用同一密钥文件。

### 命令行探测

```bash
pnpm run test:client -- http://127.0.0.1:18789/metrics
openclaw-prometheus_BEARER_TOKEN=secret pnpm run test:client -- http://127.0.0.1:18789/metrics
```

## 端点说明

| 路径 | 格式 | 说明 |
|------|------|------|
| `GET {path}` | Prometheus text | 标准抓取目标 |
| `GET {path}/per-object` | JSON | 按对象分组的指标 |
| `GET {path}/detailed?family=` | JSON | 按名称子串过滤 |
| `GET {path}/health` | JSON | Exporter 健康与最近 snapshot 状态 |

默认 `{path}` 为 `/metrics`。

## 数据来源

指标基于插件可合法观测到的 SDK 面构建：

- `api.runtime.modelAuth`、`api.runtime.channel`、`api.runtime.state`
- `message_received`、`message_sent`、`before_tool_call`、`after_tool_call`、`llm_output`、`agent_end` 等 hook
- `api.runtime.events.onAgentEvent(...)` 与 `onSessionTranscriptUpdate(...)`
- exporter 自身的 scrape、route、snapshot 健康指标

## Grafana 看板

从 [`grafana/`](./grafana/) 导入单节点与集群两套 JSON 模板。Prometheus 负责指标，Loki 负责日志历史，接入说明见 `grafana/README.md`。

## 开发与测试

```bash
pnpm install
pnpm run build
pnpm test
```

## 发版注意

同步更新 `package.json` 的 `version` 与 `src/version.ts` 中的 `PLUGIN_VERSION`。

## 许可证

MIT
