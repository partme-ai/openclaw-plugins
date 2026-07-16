# OpenClaw Prometheus 故障排查

> 适用版本：2026.7.1

## 插件未加载

```bash
openclaw plugins inspect prometheus
openclaw doctor
```

确认 `plugins.allow` 包含 `prometheus`，`plugins.entries.prometheus.enabled=true`，安装记录版本为 2026.7.1。manifest 的 `activation.onStartup` 会在 Gateway 启动时激活插件。

## `/metrics` 返回 401 或 503

- 401：请求 Bearer 与 `OPENCLAW_PROMETHEUS_BEARER_TOKEN` 不一致；
- 503 且提示缺少 token：已启用 `scrapeAuth`，但 Gateway 进程没有收到环境变量；
- health 503：查看 JSON 中 `rpc.lastError`、`collectors.failed`、`snapshot.ageMs`。

## collector 失败

```promql
openclaw_metrics_collector_success == 0
increase(openclaw_metrics_collect_errors_total[15m])
```

RPC collector 需要连接当前 Gateway，并使用 operator read scope。检查 Gateway URL、token/password、防火墙和 WebSocket 代理配置。累计错误只用于趋势，恢复后 `collector_success` 会重新变成 1。

## diagnostics 指标没有出现

diagnostics 指标按事件创建。先产生一次模型、工具或消息流量。确认 bundled `diagnostics-prometheus` 已禁用，避免重复订阅。插件不需要 `hooks.allowConversationAccess`。

## series 被丢弃

观察：

```promql
increase(openclaw_prometheus_series_dropped_total[15m])
increase(openclaw_runtime_metric_series_dropped_total[15m])
```

持续增长说明业务 label 基数过高。优先减少 tool/channel/provider 等动态值的种类，而不是盲目提高内存上限。

## CLI 安装或检查不退出

2026.7.1 已让 RuntimeCollector 定时器 `unref()`，并在停止时清理 RPC、重连和订阅。若仍发生，确认实际安装版本，并采集 `openclaw plugins inspect prometheus` 与进程堆栈。

## Grafana 无数据

先在 Prometheus UI 直接查询真实 metric name，再核对 dashboard 变量与 instance label。Dashboard 是模板；以 `/metrics` 输出和 [指标目录](./OpenClaw-Prometheus-Metrics.md) 为准。
