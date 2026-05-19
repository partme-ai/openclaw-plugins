# OpenClaw Prometheus 指标定义

> 版本：v0.3.0 | 更新：2026-04-20
> 遵循 [Prometheus 命名规范](https://prometheus.io/docs/practices/naming/) 与 [Grafana 最佳实践](https://grafana.com/docs/grafana/latest/fundamentals/exemplars/)

---

## 设计原则

1. **命名**：`openclaw_{domain}_{entity}_{metric}_{unit}`
2. **域（domain）**：按业务语义划分，详见目录
3. **类型**：counter 用 `_total` 后缀；gauge 无后缀；histogram 用 `_seconds`/`_bytes`
4. **标签**：低基数优先；`channel`、`provider`、`model`、`agent_id`、`tool` 为常用分组维度
5. **Grafana 友好**：每个域都有对应的 PromQL 模板

---

## 目录

| 域 | 前缀 | 核心指标 |
|----|------|---------|
| [1. 应用](#1-应用域-openclaw_app_) | `openclaw_app_*` | Exporter 元数据、采集健康、HTTP 端点、SLI |
| [2. 智能体](#2-智能体域-openclaw_agent_) | `openclaw_agent_*` | Agent 生命周期、运行时长、事件流 |
| [3. 模型](#3-模型域-openclaw_model_) | `openclaw_model_*` | Token 消耗、LLM 图片、模型认证、可用模型 |
| [4. 工具](#4-工具域-openclaw_tool_) | `openclaw_tool_*` | 工具调用、延迟分布、失败计数 |
| [5. 会话](#5-会话域-openclaw_session_) | `openclaw_session_*` | 会话生命周期、消息量、压缩、重置 |
| [6. 渠道](#6-渠道域-openclaw_channel_) | `openclaw_channel_*` | 渠道连接状态、账号数、活跃度 |
| [7. 用量](#7-用量域-openclaw_usage_) | `openclaw_usage_*` | 成本聚合（按 provider/model/agent/date 分组） |
| [8. 系统](#8-系统域-openclaw_cron__openclaw_skill__openclaw_node__openclaw_presence_) | `openclaw_cron_*` 等 | Cron、Skills、Nodes、Presence |
| [9. 进程](#9-进程域-openclaw_nodejs_) | `openclaw_nodejs_*` | Node.js 内存、CPU、事件循环延迟 |

---

## 1. 应用域 (`openclaw_app_*`)

> 来源：Exporter 内置、HTTP 端点采集、PluginRuntimeCollector 周期计算

### 1.1 Exporter 元数据

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_exporter_build_info` | gauge | `plugin`, `version` | 插件版本信息；Grafana 用 `group_left` enrich |
| `openclaw_metrics_last_scrape_duration_seconds` | gauge | - | 最近一次完整采集耗时 |
| `openclaw_metrics_collector_success` | gauge | `collector` | 采集器健康：1=成功 0=失败 |
| `openclaw_metrics_collect_errors_total` | counter | `collector` | 采集器累计失败次数 |
| `openclaw_metrics_http_requests_total` | counter | `route`, `method`, `status` | HTTP 端点请求计数 |
| `openclaw_metrics_http_request_duration_seconds` | histogram | `route`, `method` | HTTP 端点延迟（16 档 buckets，支持 `histogram_quantile` 聚合） |
| `openclaw_gateway_operator_rpc_requests_total` | counter | `method` | Gateway RPC 调用计数 |

### 1.2 插件运行时

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_plugin_uptime_seconds` | gauge | - | 插件运行时长 |
| `openclaw_plugin_hook_invocations_total` | counter | `hook` | 各 SDK hook 调用次数 |
| `openclaw_ready` | gauge | - | Gateway start/stop 生命周期：1=up 0=down |

### 1.3 App Runtime 快照

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_runtime_snapshot_age_seconds` | gauge | - | 快照数据新鲜度（距上次刷新秒数） |
| `openclaw_runtime_snapshot_refresh_timestamp_seconds` | gauge | - | 快照刷新时间戳 |
| `openclaw_runtime_namespace_available` | gauge | `namespace` | API namespace 可用性：events/modelAuth/channel/state |
| `openclaw_runtime_state_dir_configured` | gauge | - | `api.runtime.state.resolveStateDir()` 是否返回值 |
| `openclaw_inflight_operations` | gauge | `kind` | 当前进行中操作数（agent/tool） |

### 1.4 SLI 衍生指标

> 由 `refreshSliMetrics()` 周期计算

| 指标 | 类型 | 说明 |
|------|------|------|
| `openclaw_sli_message_success_ratio` | gauge | 消息投递成功率（0~1）；来源 `openclaw_session_messages_sent_total{result=ok|error}` |
| `openclaw_sli_agent_error_ratio` | gauge | Agent 运行错误率（0~1）；来源 `openclaw_agent_runs_total{result=ok|error}` |
| `openclaw_sli_tool_error_ratio` | gauge | 工具调用错误率（0~1）；来源 `openclaw_tool_call_failures_total / openclaw_tool_calls_total` |
| `openclaw_sli_channel_health_ratio` | gauge | 渠道健康比率（0~1）；来源 `openclaw_channel_linked_total / openclaw_channel_total` |

**Grafana PromQL - Error Budget**：
```promql
# SLO 错误预算
1 - openclaw_sli_agent_error_ratio

# Burn Rate（1 小时错误率超过 SLO 容限的倍数）
rate(openclaw_sli_agent_error_ratio[1h]) / (1 - 0.999)
```

**Grafana 面板建议**：
- **Stat**：每个 SLI gauge → 绿色（>0.99）/ 黄色 / 红色（<0.95）
- **Time series**：`rate(openclaw_sli_agent_error_ratio[5m])` → 错误率趋势

---

## 2. 智能体域 (`openclaw_agent_*`)

> 来源：`before_agent_start` / `agent_end` hooks + `onAgentEvent` events

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_agent_runs_started_total` | counter | `agent_id`, `channel` | Agent 启动次数 |
| `openclaw_agent_runs_total` | counter | `agent_id`, `result` | Agent 完成次数（result: ok/error） |
| `openclaw_agent_runs_failed_total` | counter | `agent_id` | Agent 失败次数（用于 SLO 关联，无 result 标签避免 cardinality 爆炸） |
| `openclaw_agent_run_duration_seconds` | histogram | `agent_id` | Agent 运行时长（16 档 buckets：5ms~600s）；**Grafana**: `histogram_quantile(0.95, ...)` |
| `openclaw_agent_events_total` | counter | `stream` | Agent 事件流计数（stream: item/...) |
| `openclaw_agent_item_events_total` | counter | `kind`, `phase`, `status` | Agent 子事件（kind: text/tool/call；phase: begin/end；status: ok/error） |
| `openclaw_agent_subagent_ended_total` | counter | `outcome` | 子智能体结束事件 |

**PromQL 示例**：
```promql
# P95 Agent 延迟，按 agent_id 分组
histogram_quantile(0.95,
  sum(rate(openclaw_agent_run_duration_seconds_bucket[5m])) by (le, agent_id)
)

# Agent 错误率
rate(openclaw_agent_runs_failed_total[5m])
  / rate(openclaw_agent_runs_started_total[5m])

# Top 5 最慢 Agent
topk(5,
  histogram_quantile(0.99,
    sum(rate(openclaw_agent_run_duration_seconds_bucket[5m])) by (le, agent_id)
  )
)
```

---

## 3. 模型域 (`openclaw_model_*`)

### 3.1 LLM Token 实时消耗（Hooks）

> 来源：`llm_output` / `llm_input` hooks；counter 类型，支持 `rate()` 聚合

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_model_llm_tokens_input_total` | counter | `provider`, `model` | 实时 input tokens |
| `openclaw_model_llm_tokens_output_total` | counter | `provider`, `model` | 实时 output tokens |
| `openclaw_model_llm_tokens_cache_read_total` | counter | `provider`, `model` | 实时 cache read tokens |
| `openclaw_model_llm_tokens_cache_write_total` | counter | `provider`, `model` | 实时 cache write tokens |
| `openclaw_model_llm_tokens_total` | counter | `provider`, `model` | 实时总 tokens |
| `openclaw_model_llm_input_images_total` | counter | `provider`, `model` | LLM 图片输入数 |

**PromQL**：`rate(openclaw_model_llm_tokens_total[5m]) by (model)` → token/s 吞吐

### 3.2 模型列表（RPC）

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_model_total` | gauge | - | 可用模型总数 |
| `openclaw_model_by_provider` | gauge | `provider` | 按 provider 的模型数 |

### 3.3 模型认证（RPC + Runtime）

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_model_auth_providers_total` | gauge | - | 认证 provider 总数 |
| `openclaw_model_auth_providers_expiring_total` | gauge | - | 即将过期（<24h）数 |
| `openclaw_model_auth_providers_expired_total` | gauge | - | 已过期/缺失数 |
| `openclaw_model_auth_provider_status` | gauge | `provider`, `status` | 单 provider 状态 one-hot（ok/missing/error） |
| `openclaw_model_auth_provider_profiles_total` | gauge | `provider` | 认证 profile 数 |
| `openclaw_model_auth_provider_expiry_timestamp_seconds` | gauge | `provider` | 过期时间戳 |
| `openclaw_model_auth_provider_remaining_seconds` | gauge | `provider` | 剩余有效秒数 |
| `openclaw_model_auth_provider_usage_used_ratio` | gauge | `provider` | 用量占比（0~1） |
| `openclaw_model_auth_provider_info` | gauge | `provider`, `name`, `auth_type` | Provider 基本信息（probe 结果） |
| `openclaw_model_auth_provider_probe_errors_total` | counter | `provider`, `error_type` | Provider probe 错误计数 |

---

## 4. 工具域 (`openclaw_tool_*`)

> 来源：`before_tool_call` / `after_tool_call` hooks

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_tool_calls_total` | counter | `tool` | 工具调用计数 |
| `openclaw_tool_call_failures_total` | counter | `tool` | 工具调用失败 |
| `openclaw_tool_call_duration_seconds` | histogram | `tool` | 工具调用延迟（16 档 buckets）；**Grafana**: `histogram_quantile(0.95, ...)` |
| `openclaw_tool_result_persist_total` | counter | - | 工具结果持久化次数 |

**PromQL**：
```promql
# Top 10 最慢工具
topk(10,
  histogram_quantile(0.95,
    sum(rate(openclaw_tool_call_duration_seconds_bucket[5m])) by (le, tool)
  )
)

# 工具错误率
rate(openclaw_tool_call_failures_total[5m])
  / rate(openclaw_tool_calls_total[5m])
```

---

## 5. 会话域 (`openclaw_session_*`)

### 5.1 会话生命周期（Hooks）

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_sessions_started_total` | counter | - | 会话启动次数 |
| `openclaw_sessions_ended_total` | counter | `reason` | 会话结束次数（reason: new/reset/idle/daily/compaction/deleted/other） |
| `openclaw_sessions_active_estimated` | gauge | - | 估计活跃会话数 |

### 5.2 消息（Hooks）

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_session_messages_received_total` | counter | `channel` | 入站消息 |
| `openclaw_session_messages_sent_total` | counter | `channel`, `result` | 出站消息（result: ok/error） |

### 5.3 会话统计（Sessions RPC）

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_session_total` | gauge | - | 会话总数 |
| `openclaw_session_active_recent` | gauge | - | 最近 30 分钟活跃会话 |
| `openclaw_session_by_channel` | gauge | `channel` | 按渠道分会话数 |
| `openclaw_session_tokens_input_total` | gauge | - | 累计 input tokens |
| `openclaw_session_tokens_output_total` | gauge | - | 累计 output tokens |
| `openclaw_session_tokens_total` | gauge | - | 累计总 tokens |
| `openclaw_session_tokens_context_total` | gauge | - | 累计 context tokens |
| `openclaw_session_estimated_cost_usd_total` | gauge | - | 预估总成本 (USD) |
| `openclaw_session_tokens_avg_per_session` | gauge | - | 平均每会话 tokens |
| `openclaw_session_tokens_max_per_session` | gauge | - | 单会话最大 tokens |

### 5.4 会话压缩（Hooks）

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_session_compaction_events_total` | counter | `phase` | 压缩事件（phase: before/after） |
| `openclaw_session_compaction_messages_compacted_total` | counter | - | 压缩的消息数 |
| `openclaw_session_compaction_last_tokens_before` | gauge | - | 压缩前 token 数 |
| `openclaw_session_compaction_last_tokens_after` | gauge | - | 压缩后 token 数 |

### 5.5 会话重置（Hooks）

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_session_reset_requests_total` | counter | `reason` | 会话重置请求（reason: new/reset/idle/daily/compaction/deleted/other） |

### 5.6 会话事件（Runtime Events）

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_session_transcript_updates_total` | counter | - | Transcript 更新次数 |
| `openclaw_session_transcript_last_update_timestamp_seconds` | gauge | - | 最近 transcript 更新时间戳 |
| `openclaw_session_transcript_last_seen_timestamp_seconds` | gauge | `scope` | 聚合级最近更新（scope: aggregate） |

---

## 6. 渠道域 (`openclaw_channel_*`)

> 来源：`channels.status` RPC + `message_received/sent` hooks

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_channel_total` | gauge | - | 配置渠道总数 |
| `openclaw_channel_linked_total` | gauge | - | 已链接渠道数 |
| `openclaw_channel_unlinked_total` | gauge | - | 未链接渠道数 |
| `openclaw_channel_linked` | gauge | `channel_id`, `channel_type`, `channel_label` | 单渠道链接状态（0/1） |
| `openclaw_channel_accounts` | gauge | `channel_id` | 每渠道账号数 |
| `openclaw_channel_last_event_timestamp_seconds` | gauge | `channel`, `account` | 最近事件时间戳 |
| `openclaw_channel_last_inbound_age_seconds` | gauge | `channel`, `account` | 最近入站消息距今秒数 |
| `openclaw_channel_last_outbound_age_seconds` | gauge | `channel`, `account` | 最近出站消息距今秒数 |
| `openclaw_channel_failures_total` | counter | `channel`, `reason` | 渠道发送失败数 |

**PromQL**：
```promql
# 渠道活跃度（秒）
time() - openclaw_channel_last_event_timestamp_seconds

# 断开渠道数
sum(openclaw_channel_linked == 0)
```

---

## 7. 用量域 (`openclaw_usage_*`)

> 来源：`usage.cost` + `sessions.usage` RPC（窗口聚合，非实时）

### 7.1 总量

| 指标 | 类型 | 说明 |
|------|------|------|
| `openclaw_usage_requests_total` | gauge | 请求计数 |
| `openclaw_usage_tokens_input_total` | gauge | Input tokens |
| `openclaw_usage_tokens_output_total` | gauge | Output tokens |
| `openclaw_usage_tokens_cache_read_total` | gauge | Cache read tokens |
| `openclaw_usage_tokens_cache_write_total` | gauge | Cache write tokens |
| `openclaw_usage_tokens_total` | gauge | 总 tokens |
| `openclaw_usage_cost_usd_total` | gauge | 总成本 USD |
| `openclaw_usage_missing_cost_entries_total` | gauge | 缺失成本条目数 |

### 7.2 消息统计

| 指标 | 类型 | 说明 |
|------|------|------|
| `openclaw_usage_messages_total` | gauge | 消息总数 |
| `openclaw_usage_messages_user_total` | gauge | 用户消息 |
| `openclaw_usage_messages_assistant_total` | gauge | 助手消息 |
| `openclaw_usage_messages_tool_calls_total` | gauge | 工具调用消息 |
| `openclaw_usage_messages_tool_results_total` | gauge | 工具结果消息 |
| `openclaw_usage_messages_errors_total` | gauge | 错误消息 |

### 7.3 延迟统计

| 指标 | 类型 | 说明 |
|------|------|------|
| `openclaw_usage_latency_count` | gauge | 延迟样本数 |
| `openclaw_usage_latency_avg_seconds` | gauge | 平均延迟 |
| `openclaw_usage_latency_p95_seconds` | gauge | P95 延迟 |
| `openclaw_usage_latency_min_seconds` | gauge | 最小延迟 |
| `openclaw_usage_latency_max_seconds` | gauge | 最大延迟 |

### 7.4 按维度分组

| 指标 | 标签 | 说明 |
|------|------|------|
| `openclaw_usage_provider_requests_total` | `provider` | 按 provider 请求数 |
| `openclaw_usage_provider_tokens_input_total` | `provider` | 按 provider input tokens |
| `openclaw_usage_provider_tokens_output_total` | `provider` | 按 provider output tokens |
| `openclaw_usage_provider_tokens_total` | `provider` | 按 provider 总 tokens |
| `openclaw_usage_provider_cost_usd_total` | `provider` | 按 provider 总成本 |
| `openclaw_usage_model_requests_total` | `provider`, `model` | 按 model 请求数 |
| `openclaw_usage_model_tokens_total` | `provider`, `model` | 按 model 总 tokens |
| `openclaw_usage_model_cost_usd_total` | `provider`, `model` | 按 model 总成本 |
| `openclaw_usage_agent_tokens_total` | `agent_id` | 按 agent tokens |
| `openclaw_usage_agent_cost_usd_total` | `agent_id` | 按 agent 成本 |
| `openclaw_usage_channel_tokens_total` | `channel` | 按 channel tokens |
| `openclaw_usage_channel_cost_usd_total` | `channel` | 按 channel 成本 |
| `openclaw_usage_tool_calls_total` | `tool` | 按 tool 调用数 |
| `openclaw_usage_tools_total_calls` | - | 总 tool 调用 |
| `openclaw_usage_tools_unique_total` | - | 去重 tool 数 |

### 7.5 按日分组

| 指标 | 标签 | 说明 |
|------|------|------|
| `openclaw_usage_daily_tokens_total` | `date` | 日 tokens |
| `openclaw_usage_daily_cost_usd_total` | `date` | 日成本 (USD) |
| `openclaw_usage_daily_messages_total` | `date` | 日消息数 |
| `openclaw_usage_daily_tool_calls_total` | `date` | 日 tool 调用数 |
| `openclaw_usage_daily_errors_total` | `date` | 日错误数 |
| `openclaw_usage_daily_latency_count` | `date` | 日延迟样本数 |
| `openclaw_usage_daily_latency_avg_seconds` | `date` | 日平均延迟 |
| `openclaw_usage_daily_latency_p95_seconds` | `date` | 日 P95 延迟 |
| `openclaw_usage_model_daily_requests_total` | `date`, `provider`, `model` | 按 model 按日请求 |
| `openclaw_usage_model_daily_tokens_total` | `date`, `provider`, `model` | 按 model 按日 tokens |
| `openclaw_usage_model_daily_cost_usd_total` | `date`, `provider`, `model` | 按 model 按日成本 |

**PromQL**：
```promql
# 日成本趋势
openclaw_usage_daily_cost_usd_total

# Provider 成本占比（Pie）
openclaw_usage_provider_cost_usd_total
```

---

## 8. 系统域 (`openclaw_cron_*` / `openclaw_skill_*` / `openclaw_node_*` / `openclaw_presence_*`)

### 8.1 Cron（RPC）

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_cron_total` | gauge | - | 配置定时任务总数 |
| `openclaw_cron_running` | gauge | - | 当前运行中任务数 |
| `openclaw_cron_overdue_seconds` | gauge | `job` | 任务超时秒数（>0 表示延迟） |
| `openclaw_cron_last_duration_seconds` | gauge | `job` | 最近一次执行耗时 |
| `openclaw_cron_last_result` | gauge | `job` | 最近结果（1=ok, 0=error） |
| `openclaw_cron_last_start_timestamp_seconds` | gauge | `job` | 最近启动时间戳 |
| `openclaw_cron_last_end_timestamp_seconds` | gauge | `job` | 最近结束时间戳 |
| `openclaw_cron_consecutive_failures_total` | gauge | `job` | 连续失败次数 |

### 8.2 Skills（RPC）

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_skill_total` | gauge | - | 技能总数 |
| `openclaw_skill_active_total` | gauge | - | 活跃技能数 |
| `openclaw_skill_by_category` | gauge | `category` | 按分类的技能数 |
| `openclaw_skill_total_invocations_total` | counter | - | 累计调用次数 |
| `openclaw_skill_invocations_by_name_total` | counter | `skill` | 按技能名调用次数 |
| `openclaw_skill_errors_total` | counter | `skill` | 技能错误次数 |

### 8.3 Nodes（RPC）

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_node_total` | gauge | - | 已配对节点总数 |
| `openclaw_node_connected` | gauge | - | 当前在线节点数 |

### 8.4 Presence（RPC）

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `openclaw_presence_total` | gauge | - | 活跃 presence 会话数 |
| `openclaw_presence_by_channel` | gauge | `channel` | 按渠道的 presence |

---

## 9. 进程域 (`openclaw_nodejs_*`)

> 来源：`RuntimeCollector`（`includeRuntime: true` 时启用）

| 指标 | 类型 | 说明 |
|------|------|------|
| `openclaw_nodejs_heap_used_bytes` | gauge | 堆已用字节 |
| `openclaw_nodejs_heap_total_bytes` | gauge | 堆总量字节 |
| `openclaw_nodejs_external_bytes` | gauge | 外部内存字节 |
| `openclaw_nodejs_array_buffers_bytes` | gauge | ArrayBuffer 内存字节 |
| `openclaw_nodejs_rss_bytes` | gauge | 常驻内存字节 |
| `openclaw_nodejs_event_loop_lag_ms` | gauge | 事件循环延迟（毫秒） |
| `openclaw_nodejs_uptime_seconds` | gauge | 进程运行时长 |
| `openclaw_nodejs_process_cpu_user_seconds_total` | counter | 用户态 CPU 秒数 |
| `openclaw_nodejs_process_cpu_system_seconds_total` | counter | 内核态 CPU 秒数 |

---

## 指标统计

| 域 | 指标数 | 来源 |
|----|--------|------|
| 应用 (`app`) | ~18 | Plugin + HTTP + SLI |
| 智能体 (`agent`) | 7 | Hooks + Events |
| 模型 (`model`) | ~20 | Hooks + RPC |
| 工具 (`tool`) | 4 | Hooks |
| 会话 (`session`) | ~22 | Hooks + RPC |
| 渠道 (`channel`) | 9 | RPC + Hooks |
| 用量 (`usage`) | ~51 | RPC |
| 系统 (`cron/skill/node/presence`) | ~20 | RPC |
| 进程 (`nodejs`) | 9 | Process |
| **合计** | **~160** | |

---

## 变更日志

### v0.3.0（2026-04-20）

| 变更 | Before | After |
|------|--------|-------|
| **域重分类** | 20 个分类（按数据来源） | **9 个业务域**（app/agent/model/tool/session/channel/usage/system/process） |
| 延迟类型 | summary | **histogram**（可跨实例 `histogram_quantile`） |
| Hook token 前缀 | `openclaw_llm_tokens_*` | **`openclaw_model_llm_tokens_*`** |
| 消息指标前缀 | `openclaw_messages_*` | **`openclaw_session_messages_*`** |
| 子智能体前缀 | `openclaw_subagent_ended_total` | **`openclaw_agent_subagent_ended_total`** |
| 健康检查单位 | `_duration_ms` (ms) | **`_duration_seconds`** (s) |
| SLI 指标 | 无 | **新增 4 个** `openclaw_sli_*` |
| Histogram buckets | N/A | **16 档** 5ms~600s |
| HTTP 延迟 | summary | **histogram** |
| Agent duration histogram | 含 `result` 标签（cardinality 爆炸） | **移除 `result` 标签**，新增 `openclaw_agent_runs_failed_total{agent_id}` |

---

## 推荐告警规则

```yaml
# Gateway 宕机
- alert: OpenClawGatewayDown
  expr: openclaw_ready == 0
  for: 2m

# 认证即将过期（<24h）
- alert: OpenClawModelAuthExpiring
  expr: openclaw_model_auth_provider_remaining_seconds < 86400
  for: 5m

# 渠道断开
- alert: OpenClawChannelDisconnected
  expr: openclaw_channel_linked == 0
  for: 5m

# 采集器失败
- alert: OpenClawCollectorFailing
  expr: openclaw_metrics_collector_success == 0
  for: 10m

# 会话成本异常
- alert: OpenClawCostSpike
  expr: rate(openclaw_usage_cost_usd_total[1h]) > 10
  for: 30m

# Agent 错误率高（>10%）
- alert: OpenClawAgentErrorRateHigh
  expr: rate(openclaw_agent_runs_failed_total[5m])
        / rate(openclaw_agent_runs_started_total[5m]) > 0.1
  for: 10m

# SLO Burn Rate
- alert: OpenClawSLOBurnRate
  expr: rate(openclaw_sli_agent_error_ratio[1h]) / (1 - 0.999) > 1
  for: 5m
```
