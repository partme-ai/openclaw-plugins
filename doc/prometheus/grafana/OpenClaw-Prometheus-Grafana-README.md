# OpenClaw Grafana Dashboards — v0.3.1

企业级 Grafana Dashboard，适用于 `@partme.ai/openclaw-prometheus` v0.3.1+（内置 diagnostics-prometheus parity）。

> 部署前请在 `openclaw.json` 中 **禁用** bundled `diagnostics-prometheus`，详见 [OpenClaw-Prometheus-Deployment.md](../OpenClaw-Prometheus-Deployment.md#34-禁用-bundled-diagnostics-prometheus必做)。

## PromQL 约定（v0.3.1+）

| 场景 | 指标 | 示例 PromQL |
|------|------|-------------|
| Token 吞吐 / s | `openclaw_model_tokens_total` (counter) | `sum(rate(openclaw_model_tokens_total{token_type="input"}[5m])) by (model)` |
| 窗口用量/成本 | `openclaw_usage_*` (gauge) | `openclaw_usage_model_cost_usd_total`（勿对 gauge 滥用 `rate()`） |
| Run 延迟 P95（SLO / 按 model） | `openclaw_run_duration_seconds` (diagnostics histogram) | `histogram_quantile(0.95, sum(rate(openclaw_run_duration_seconds_bucket[5m])) by (le, model))` |
| Run 延迟 P95（按 agent_id） | `openclaw_agent_run_duration_seconds` (hooks histogram) | `histogram_quantile(0.95, sum(rate(openclaw_agent_run_duration_seconds_bucket[5m])) by (le, agent_id))` |

> 两套 run 时长指标来源不同，详见 [OpenClaw-Prometheus-Metrics.md § Run 延迟指标选择](../OpenClaw-Prometheus-Metrics.md#run-延迟指标选择)。

## Dashboard

| Dashboard | Panels | Use Case |
|-----------|--------|----------|
| [cluster/dashboard-overview.json](./cluster/dashboard-overview.json) | 10 | 生产环境 SLO & 系统健康概览 |
| [cluster/dashboard-metrics.json](./cluster/dashboard-metrics.json) | 12 | 详细指标分析、Agent/Tool 性能 |

### Dashboard 1: Cluster Overview (10 panels)

| Row | Panels | Type |
|-----|--------|------|
| Health & Availability | Instances, Plugin Up, Plugin Ready, Snapshot Age | Stat ×4 |
| Traffic & SLO | Message Throughput, Agent Activity, Tool Activity, SLO Ratios | Timeseries ×4 |
| Channels & Infrastructure | Channels, Channel Health Ratio, Cardinality, HTTP Latency, Node.js Memory | Timeseries/Stat ×5 |

### Dashboard 2: Detailed Metrics (12 panels)

| Row | Panels | Type |
|-----|--------|------|
| Agent Performance | Agent Duration P50/P95/P99, Agent Runs Rate, Agent Runs by ID | Timeseries ×2 + Table |
| Tool Performance | Tool Duration P95, Tool Calls Detail | Timeseries + Table |
| Usage & Cost | LLM Token Throughput, Estimated Cost | Timeseries ×2 |
| Channels & Sessions | Message Rate by Channel, Sessions | Timeseries ×2 |
| System Health | Collector Status, Plugin Uptime, Node.js Memory, Event Loop Lag | Table + Timeseries ×3 |

## 变量

| Variable | Query |
|----------|-------|
| `$instance` | `label_values(openclaw_up, instance)` |
| `$datasource` | Prometheus 数据源 |

## 导入

```bash
# 在 Grafana UI: Dashboards → New → Import → Upload JSON
grafana/cluster/dashboard-overview.json
grafana/cluster/dashboard-metrics.json
```

**Grafana 版本**：10.x+（schemaVersion 39）

## 相关文档

- [OpenClaw-Prometheus-Grafana-Cluster.md](./OpenClaw-Prometheus-Grafana-Cluster.md) - 集群版详细说明
- [OpenClaw-Prometheus-Grafana-Troubleshooting.md](./OpenClaw-Prometheus-Grafana-Troubleshooting.md) - 故障排查
