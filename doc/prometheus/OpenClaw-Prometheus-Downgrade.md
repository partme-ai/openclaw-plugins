# 降级策略

## RPC 失败降级

当 RPC 调用失败时，插件应该返回合理的默认值，而不是中断采集。

| RPC 方法 | 失败行为 | 降级指标 |
|---------|---------|----------|
| `channels.listAccounts` | 返回空数组 | `openclaw_channel_linked_total = 0`<br>`openclaw_channel_total = 0` |
| `models.listModels` | 返回空数组 | `openclaw_models_total = 0` |
| `sessions.listSessions` | 返回空数组 | `openclaw_sessions_active_estimated = 0` |
| `nodes.listNodes` | 返回空数组 | `openclaw_node_up = 0` |
| `skills.listSkills` | 返回空数组 | `openclaw_skills_total = 0` |
| `cron.listJobs` | 返回空数组 | `openclaw_cron_jobs_total = 0` |
| `presence.listSessions` | 返回空数组 | `openclaw_presence_sessions_total = 0` |
| `usage.getUsage` | 跳过 Token 用量 | `openclaw_usage_*` 不更新 |
| `modelAuth.resolveApiKeyForProvider` | 跳过探针 | `openclaw_model_auth_provider_status` 不更新 |

## 健康检查降级

- **Snapshot age > 60s** → `openclaw_gateway_healthz_healthy = 0`（数据过期）
- **All RPC fail** → 返回 `healthy: false, degraded: true`（降级状态）
- **Single RPC fail** → 继续采集，但 `openclaw_metrics_collect_errors_total` 累加

## HTTP 请求降级

- **超时 > 30s** → 返回 503 Gateway Timeout
- **认证失败** → 返回 401 Unauthorized
- **内部错误** → 返回 500 Internal Server Error，但 `openclaw_up` 保持为 1

## 降级指标

| 指标名称 | 类型 | 说明 |
|-----------|------|------|
| `openclaw_gateway_degraded` | Gauge | 降级状态（1 = 降级，0 = 正常） |
| `openclaw_gateway_fallback_used` | Counter | 降级触发次数 |

## 监控建议

- 告警：`rate(openclaw_gateway_degraded[5m]) > 0`（检测降级）
- 告警：`openclaw_gateway_fallback_used_total` 上升趋势（频繁降级）
- 仪表板：展示降级状态和 RPC 失败率
