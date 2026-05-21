# OpenClaw Prometheus Plugin — 架构总结

> 版本：0.3.0 | 更新：2026-05-02 | 状态：✅ 全部 18 测试通过

---

## 1. 系统架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OpenClaw Gateway                             │
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐               │
│  │ Plugin SDK   │  │ Runtime API │  │ Plugin Hooks │               │
│  │  Events API  │  │ (RPC)       │  │ (实时回调)    │               │
│  └──────┬───────┘  └──────┬──────┘  └──────┬───────┘               │
│         │                 │                │                        │
│         ▼                 ▼                ▼                        │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              openclaw-prometheus Plugin                       │  │
│  │                                                              │  │
│  │  ┌─────────────────────────────────────────────────────────┐ │  │
│  │  │                 Observer Layer                          │ │  │
│  │  │  (28 hooks → MetricsRegistry, 实时计数)                  │ │  │
│  │  └────────────────────────┬────────────────────────────────┘ │  │
│  │                           │                                  │  │
│  │  ┌────────────────────────┴────────────────────────────────┐ │  │
│  │  │              Collector Layer                            │ │  │
│  │  │  12 collectors (RPC pull + Hook snapshot + Node.js)     │ │  │
│  │  └────────────────────────┬────────────────────────────────┘ │  │
│  │                           │                                  │  │
│  │  ┌────────────────────────┴────────────────────────────────┐ │  │
│  │  │              Export Layer                               │ │  │
│  │  │  4 HTTP routes → Prometheus text / JSON / Health        │ │  │
│  │  └─────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
│         │                                                           │
└─────────┼───────────────────────────────────────────────────────────┘
          │ HTTP scrape
          ▼
   ┌──────────────┐    ┌──────────────┐
   │  Prometheus   │    │    Grafana    │
   │  Server       │───▶│  Dashboard   │
   └──────────────┘    └──────────────┘
```

---

## 2. 分层架构

### 2.1 Observer Layer（实时 Hook → Registry）

**职责**：监听 Plugin SDK hooks，将事件转为 Prometheus 计数器/仪表盘。

```
Plugin Hooks (28)                    MetricsRegistry (内存)
─────────────────                   ─────────────────────

message_received ─────┐
message_sending ──────┤
message_sent ─────────┤▶ session_messages_received_total
session_start ────────┤  session_messages_sent_total
session_end ──────────┤  sessions_started_total
before_reset ─────────┤  sessions_ended_total
                      │  session_reset_requests_total
before_compaction ────┤  session_compaction_events_total
after_compaction ─────┘  session_compaction_messages_compacted_total

llm_output ───────────┐
llm_input ────────────┤▶ model_llm_tokens_input/output/cache_*
                      │  model_llm_input_images_total

before_tool_call ─────┐
after_tool_call ──────┤▶ tool_calls_total / tool_call_failures_total
tool_result_persist ──┘  tool_calls_success_total

before_agent_start ───┐
agent_end ────────────┤▶ agent_runs_started/total/failed/ok_total
subagent_spawned ─────┤  agent_events_total
subagent_ended ───────┘  agent_subagent_ended_total

before_dispatch ──────┐
reply_dispatch ───────┤▶ channel_failures_total
inbound_claim ────────┘  channel_last_inbound/outbound_age_seconds

before_model_resolve ─┐
gateway_start ────────┤▶ plugin_hook_invocations_total
gateway_stop ──────────┘
```

### 2.2 Collector Layer（采集编排）

**职责**：在 scrape 请求到达时，按策略拉取/聚合指标。

```
CollectCache (TTL)
     │
     ▼
collectAll()
     │
     ├── PluginRuntimeCollector ──▶ refreshRuntimeSnapshots()
     │   (hooks + snapshot)           └── modelAuth.resolveApiKeyForProvider()
     │                               └── refreshHousekeepingMetrics()
     │                               └── refreshSliMetrics() ← O(1) 直查
     │
     ├── HealthCollector ────────▶ Gateway health RPC
     ├── ChannelsCollector ──────▶ channels.listAccounts RPC
     ├── SessionsCollector ──────▶ sessions.listSessions RPC
     ├── ModelsCollector ────────▶ models.listModels RPC
     ├── ModelAuthCollector ─────▶ modelAuth.* RPC (probe + expiry)
     ├── NodesCollector ─────────▶ nodes.listNodes RPC
     ├── SkillsCollector ────────▶ skills.listSkills RPC
     ├── CronCollector ──────────▶ cron.listJobs RPC
     ├── PresenceCollector ──────▶ presence.listOnline RPC
     ├── UsageCollector ─────────▶ sessions.usage RPC (聚合窗口)
     └── [RuntimeCollector] ──────▶ Node.js process metrics (可选)
```

### 2.3 Export Layer（HTTP 端点）

```
GET /metrics              → Prometheus text format (标准 scrape)
GET /metrics/per-object   → JSON (每对象独立，含 diagnostics)
GET /metrics/detailed     → JSON (?family= 前缀过滤)
GET /metrics/health       → JSON (插件健康状态，含 RPC 检查)
GET /metrics/debug        → JSON (调试信息，含 collector 状态)
```

---

## 3. 数据流

```
                ┌─────────────────────────────────────────┐
                │           请求处理流水线                  │
                └─────────────────────────────────────────┘

Prometheus ──── GET /metrics ──────────────────────────────────────┐
                    │                                              │
                    ▼                                              │
              scrapeAuth? ──否──▶ 401                             │
                    │是                                            │
                    ▼                                              │
         CollectCache.getOrCollect()                              │
              │          │                                        │
         缓存命中    缓存过期/首次                                   │
              │          │                                        │
              │          ▼                                        │
              │    collectAll() ──▶ 12 collectors 并行             │
              │          │                                        │
              │          ├── PluginRuntimeCollector                │
              │          │    ├── refreshRuntimeSnapshots() ── RPC│
              │          │    ├── refreshHousekeepingMetrics()     │
              │          │    └── refreshSliMetrics() ← O(1)     │
              │          │                                        │
              │          └── 11 RPC collectors (并行)             │
              │                   │                               │
              ▼                   ▼                               │
              ◄───────────────────┘                               │
                    │                                              │
                    ▼                                              │
           updateRpcSamples(bundle) ──▶ runtimeStore.rpcSamples   │
                    │                                              │
                    ▼                                              │
           appendMetaSamples() ──▶ +build_info, +scrape_duration  │
                    │                                              │
                    ▼                                              │
           formatPrometheus() ──▶ 预分配 buffer + 索引分桶         │
                    │                                              │
                    ▼                                              │
              200 text/plain ──────────────────▶ Prometheus       │
```

---

## 4. 指标域 Taxonomy

命名规范：`openclaw_{domain}_{entity}_{metric}_{suffix}`

```
域 (9)          前缀                   来源            指标数
───────────────────────────────────────────────────────────────
session         openclaw_session_*     Hooks+RPC       ~10
channel         openclaw_channel_*     Hooks+RPC       ~6
model           openclaw_model_*       Hooks+RPC       ~10
model_auth      openclaw_model_auth_*  RPC+Snapshot    ~12
agent           openclaw_agent_*       Hooks           ~7
tool            openclaw_tool_*        Hooks           ~4
usage           openclaw_usage_*       RPC             ~14
node            openclaw_node_*        RPC             ~3
infra           openclaw_(metrics|     内部            ~8
                 exporter|up|ready|
                 plugin|runtime|sli|
                 inflow|gateway)
───────────────────────────────────────────────────────────────
sli             openclaw_sli_*         衍生计算        4
                                         (基于上述 counter)
```

### SLI 衍生指标（真实计算）

```
openclaw_sli_message_success_ratio  = sent_ok / (sent_ok + sent_error)
openclaw_sli_agent_error_ratio      = agent_failed / agent_started
openclaw_sli_tool_error_ratio       = tool_failures / tool_total
openclaw_sli_channel_health_ratio   = channel_linked / channel_total (RPC)
openclaw_sli_agent_run_p95_seconds = percentile(0.95, agent_run_duration_samples)
openclaw_sli_agent_run_p99_seconds = percentile(0.99, agent_run_duration_samples)
openclaw_sli_http_request_p95_seconds = percentile(0.95, http_latency_samples)
openclaw_sli_http_request_p99_seconds = percentile(0.99, http_latency_samples)
```

**性能优化**：
- Agent 延迟 P95/P99 使用 `registry.getSamplesByName()` O(1) 查询
- HTTP 请求延迟使用环形缓冲区（1000 样本）计算 P95/P99

---

## 5. 模块依赖图

```
                    index.ts (入口)
                        │
            ┌───────────┼───────────┐
            │           │           │
            ▼           ▼           ▼
      plugin-config  runtime-store  observer.ts
      (配置解析)     (全局状态)     (Hook 注册)
                        │               │
                        ▼               │
                   metrics-registry ◄───┘
                   (指标存储+缓存)
                        │
            ┌───────────┼───────────┐
            │           │           │
            ▼           ▼           ▼
      collect-cache  scrape-auth  ws-bridge
      (TTL 缓存)    (鉴权)       (WS 推送)
            │
            ▼
      collectors/ (12)
        ├── plugin-runtime  ← 核心，编排 snapshot + SLI
        ├── health          ← Gateway health RPC
        ├── channels        ← channels.listAccounts
        ├── sessions        ← sessions.listSessions
        ├── models          ← models.listModels
        ├── model-auth      ← modelAuth.* (probe)
        ├── nodes           ← nodes.listNodes
        ├── skills          ← skills.listSkills
        ├── cron            ← cron.listJobs
        ├── presence        ← presence.listOnline
        ├── usage           ← sessions.usage (聚合窗口)
        └── runtime         ← Node.js process (可选)
            │
            ▼
      formatters/
        ├── prometheus.ts   ← 预分配 + 索引分桶
        └── json.ts         ← per-object + diagnostics
```

---

## 6. 性能优化清单

| 组件 | 优化 | 效果 |
|------|------|------|
| `MetricsRegistry` | `define()` 相等性检查跳过 | 减少无效对象创建 |
| `MetricsRegistry` | `snapshotSamples/Definitions` 带 cache | 两次 scrape 间 O(1) |
| `MetricsRegistry` | 新增 `getSampleValue()` O(1) 直查 | SLI 计算免 snapshot |
| `sampleKey()` | NUL 分隔替代 `JSON.stringify` | 减少 GC 压力 |
| `formatPrometheus` | 预分配 `parts[]` + 索引分桶 | 减少动态扩容 |
| `refreshSliMetrics` | 4× `getSampleValue` 替代全量快照 | O(1) vs O(n·log n) |
| `CollectCache` | TTL 控制 RPC 调用频率 | 避免高频 scrape 风暴 |

---

## 7. 配置项

```yaml
# openclaw.plugin.yaml
prometheus:
  metricsPath: "/metrics"           # 指标端点路径
  collectIntervalMs: 15000          # 采集缓存 TTL（0=禁用）
  snapshotIntervalMs: 30000         # Runtime snapshot 刷新间隔
  monitoredProviders: ["openai"]    # 监控的 model provider
  includeRuntime: false             # 是否包含 Node.js 进程指标
  scrapeAuthEnabled: false          # 是否启用 scrape 鉴权
  scrapeAuthToken: ""               # Bearer token（可选）
```

---

## 8. 文件清单 (24 文件, ~4070 行)

| 文件 | 行数 | 职责 |
|------|------|------|
| `index.ts` | 355 | 入口 + HTTP 路由 + 采集编排 |
| `observer.ts` | 669 | Hook 注册 + SLI 计算 |
| `types.ts` | 339 | 类型定义 |
| `metrics-registry.ts` | 261 | 指标存储 + 快照缓存 + O(1) 查询 |
| `collectors/usage.ts` | 422 | Usage RPC 采集器 |
| `collectors/model-auth.ts` | 169 | Model Auth 探测 |
| `collectors/sessions.ts` | 136 | Sessions RPC |
| `collectors/cron.ts` | 117 | 定时任务 RPC |
| `formatters/prometheus.ts` | 109 | Prometheus 文本序列化 |
| `collectors/health.ts` | 101 | 健康检查 |
| `plugin-config.ts` | 92 | 配置解析 + 校验 |
| `collectors/channels.ts` | 89 | 渠道 RPC |
| `collectors/runtime.ts` | 89 | Node.js 进程指标 |
| `ws-bridge.ts` | 88 | WebSocket 推送 |
| `runtime-store.ts` | 84 | 全局状态 + RPC 缓存 |
| `collectors/skills.ts` | 73 | 技能 RPC |
| `collectors/models.ts` | 67 | 模型 RPC |
| `formatters/json.ts` | 60 | JSON 序列化 |
| `collect-cache.ts` | 47 | TTL 缓存 |
| `scrape-auth.ts` | 42 | Bearer 鉴权 |
| `collectors/nodes.ts` | 68 | 节点 RPC |
| `collectors/presence.ts` | 77 | 在线状态 RPC |
| `collectors/plugin-runtime.ts` | 18 | 核心 collector（编排） |
| `version.ts` | 4 | 版本号 |
