# OpenClaw Prometheus 指标目录

> 版本：2026.7.1。最终指标集合以运行中 `/metrics` 输出为准；部分事件驱动指标只有产生对应流量后才出现。

## Exporter 自监控

| 指标 | 类型 | 含义 |
| --- | --- | --- |
| `openclaw_exporter_build_info` | gauge | 插件 ID 与版本 |
| `openclaw_metrics_collector_success{collector}` | gauge | collector 最近一次采集是否成功 |
| `openclaw_metrics_collect_errors_total{collector}` | counter | collector 累计失败次数 |
| `openclaw_metrics_last_scrape_duration_seconds` | gauge | 最近一次真实 collection 耗时 |
| `openclaw_metrics_http_requests_total` | counter | 插件 HTTP 请求数 |
| `openclaw_metrics_http_request_duration_seconds_*` | histogram | 插件 HTTP 延迟 |
| `openclaw_prometheus_series_dropped_total` | counter | diagnostics store 超过 2048 series 后丢弃数 |
| `openclaw_runtime_metric_series_dropped_total` | counter | runtime registry 超过 4096 series 后丢弃数 |

累计错误不等于当前不健康；健康端点依据 `collector_success` 的最近状态判断。

## Internal diagnostics

主要指标族：

- `openclaw_model_tokens_total`、`openclaw_model_cost_usd_total`、`openclaw_model_usage_duration_seconds_*`；
- `openclaw_run_duration_seconds_*`、`openclaw_model_call_duration_seconds_*`；
- `openclaw_tool_execution_duration_seconds_*`；
- `openclaw_message_*`、`openclaw_queue_*`、`openclaw_harness_*`、`openclaw_memory_*`；
- `openclaw_telemetry_exporter_total`。

这些指标来自 trusted internal diagnostics，不依赖 `agent_end`/`llm_input`，也不需要会话内容访问权限。标签会经过低基数校验和敏感文本脱敏。

## Gateway RPC collectors

| 前缀 | 数据源 |
| --- | --- |
| `openclaw_usage_*` | `usage.cost`、`sessions.usage` |
| `openclaw_session_*` | `sessions.list` |
| `openclaw_channel_*` | `channels.status` |
| `openclaw_model_*` / `openclaw_model_auth_*` | `models.list`、`models.authStatus` |
| `openclaw_node_*` | `node.list` |
| `openclaw_skill_*` | `skills.status` |
| `openclaw_cron_*` | `cron.status`、`cron.list` |
| `openclaw_presence_*` | `system-presence` |
| `openclaw_gateway_*` | `health` |

单个 RPC 失败只会使对应 collector 的最近状态为 0，其他 collector 仍正常导出。

## Public hooks/runtime events

- 消息：`openclaw_session_messages_received_total`、`openclaw_session_messages_sent_total`；
- 工具：`openclaw_tool_calls_total`、`openclaw_tool_call_failures_total`、`openclaw_tool_call_duration_seconds_*`；
- 会话/压缩：`openclaw_sessions_*`、`openclaw_session_compaction_*`、`openclaw_session_reset_requests_total`；
- 子代理/runtime event：`openclaw_agent_events_total`、`openclaw_agent_item_events_total`、`openclaw_agent_subagent_ended_total`；
- 生命周期/运行时：`openclaw_up`、`openclaw_ready`、`openclaw_plugin_uptime_seconds`、`openclaw_runtime_*`；
- Node.js：`openclaw_nodejs_*`（`includeRuntime=true`）。

## 推荐告警基线

```promql
min_over_time(openclaw_metrics_collector_success[5m]) == 0
increase(openclaw_metrics_collect_errors_total[15m]) > 0
increase(openclaw_prometheus_series_dropped_total[15m]) > 0
increase(openclaw_runtime_metric_series_dropped_total[15m]) > 0
histogram_quantile(0.95, sum by (le) (rate(openclaw_metrics_http_request_duration_seconds_bucket[5m]))) > 1
```

仓库中的告警规则和 Grafana dashboard 是模板，必须在目标环境按真实流量、SLO 和实际 `/metrics` 指标名校准。
