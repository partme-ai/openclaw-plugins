# OpenClaw Grafana Dashboards — v0.3.0

企业级 Grafana Dashboard，适用于 `@partme.ai/openclaw-prometheus` v0.3.0 生产环境。

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

- [CLUSTER.md](./CLUSTER.md) - 集群版详细说明
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - 故障排查
