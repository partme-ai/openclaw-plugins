# OpenClaw Grafana Dashboards — Cluster Edition

Ready-to-import Grafana dashboards for metrics from **`@partme.ai/openclaw-prometheus`** v0.3.1+ (diagnostics-prometheus parity).  
**Multi-instance support** with `$instance` variable.

Design reference: [RabbitMQ-Overview](https://grafana.com/grafana/dashboards/10991) enterprise patterns — stats top row + partitioned timeseries sections.

---

## Dashboard 1: Overview

**File**: `cluster/dashboard-overview.json`  
**Panels**: 17 (8 stats + 9 timeseries)

| Section | Panels |
|---------|--------|
| **Stats Row** *(8 stats)* | Instances, Plugin Up, Plugin Ready, Gateway Up, Snapshot Age, Sessions, Msg Success, Channel Health |
| **MESSAGE FLOW** *(2 panels)* | Messages / s (Sent OK + Received + Error), Message Success Ratio |
| **AGENT ACTIVITY** *(3 panels)* | Agent Runs / s, Agent Error Ratio, Agent Duration P95 |
| **TOOL ACTIVITY** *(3 panels)* | Tool Calls / s, Tool Error Ratio, Tool Duration P95 |
| **CHANNELS** *(2 panels)* | Channels (Linked vs Total), Channel Health Ratio |
| **SYSTEM** *(3 panels)* | Node.js Memory, Event Loop Lag, Cardinality |

---

## Dashboard 2: Detailed Metrics

**File**: `cluster/dashboard-metrics.json`  
**Panels**: 12 (9 timeseries + 3 tables)

| Section | Panels |
|---------|--------|
| **AGENT PERFORMANCE** | Duration P50/P95/P99, Runs by Agent ID, Agent Runs Table |
| **TOOL PERFORMANCE** | Duration P95 by Tool, Tool Calls Table |
| **LLM TOKEN USAGE** | Token Throughput by Model, Estimated Cost by Model |
| **MESSAGES & CHANNELS** | Message Rate by Channel, Sessions |
| **COLLECTOR STATUS** | Collector Health Table, Plugin Uptime |

---

## Quick Import

```bash
# Grafana → Dashboards → New → Import
# Upload: grafana/cluster/dashboard-overview.json
# Upload: grafana/cluster/dashboard-metrics.json
# Select your Prometheus data source
```

**Variable**: `$instance` — auto-populated from `label_values(openclaw_up, instance)`  
**Refresh**: 15s | **Schema**: v41 | **Time range**: Last 1h

---

## Version

v2.0 — 2026-05-02 — Redesigned with RabbitMQ-Overview enterprise patterns (stats top row, partitioned sections, shared crosshair, panel descriptions).
