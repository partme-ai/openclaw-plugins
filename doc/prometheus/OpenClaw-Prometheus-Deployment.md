# OpenClaw Prometheus 部署与验证

> 适用版本：OpenClaw / 插件 2026.7.1，Node.js 22+

## 安装

```bash
openclaw plugins install @partme.ai/openclaw-prometheus
openclaw plugins inspect prometheus
```

本地制品验证：

```bash
cd extensions/prometheus
pnpm typecheck
pnpm build
pnpm test
pnpm pack
openclaw plugins install ./partme.ai-openclaw-prometheus-2026.7.1.tgz
```

## Gateway 配置

```json
{
  "plugins": {
    "allow": ["prometheus"],
    "entries": {
      "diagnostics-prometheus": { "enabled": false },
      "prometheus": {
        "enabled": true,
        "config": {
          "path": "/metrics",
          "collectIntervalMs": 15000,
          "snapshotIntervalMs": 30000,
          "workloadWindowMs": 300000,
          "includeRuntime": true,
          "monitoredProviders": [],
          "instance": "openclaw-01",
          "scrapeAuth": { "enabled": true }
        }
      }
    }
  }
}
```

生产环境设置：

```bash
export OPENCLAW_PROMETHEUS_BEARER_TOKEN='replace-with-secret'
```

不要同时启用 bundled `diagnostics-prometheus`。两者会订阅同一 internal diagnostics 事件并造成重复指标。

## Prometheus scrape

```yaml
scrape_configs:
  - job_name: openclaw
    scrape_interval: 15s
    metrics_path: /metrics
    bearer_token_file: /etc/prometheus/openclaw-metrics.token
    static_configs:
      - targets: ["127.0.0.1:18789"]
```

插件使用 Gateway 的监听地址与 TLS 配置，不监听 9090。Prometheus 自己的 UI/服务端口不属于插件配置。

## 上线验证

```bash
openclaw plugins inspect prometheus
curl -fsS -H "Authorization: Bearer $OPENCLAW_PROMETHEUS_BEARER_TOKEN" \
  http://127.0.0.1:18789/metrics | head
curl -fsS -H "Authorization: Bearer $OPENCLAW_PROMETHEUS_BEARER_TOKEN" \
  http://127.0.0.1:18789/metrics/health
```

验收标准：

- inspect 显示 `Status: loaded`、`Version: 2026.7.1`；
- `/metrics` 为 200，包含 `openclaw_exporter_build_info`；
- `/metrics/health` 为 200 且 `ok/healthy` 均为 true；
- 未带正确 Bearer 返回 401；
- 非 GET 返回 405；
- `openclaw_metrics_collector_success{collector=...}` 的当前值均为 1；
- `openclaw_metrics_collect_errors_total` 仅作为累计计数，不直接决定当前健康状态。

## 降级与排障

- health 503：查看 payload 中 `rpc.lastError`、`collectors.failed` 与 `snapshot.ageMs`。
- RPC collector 失败：确认 Gateway token/password、operator read scope 与本地 WebSocket 地址。
- metrics 为空：先产生一次模型或工具流量；diagnostics 指标是事件驱动的。
- 重复 TYPE/series：禁用 bundled `diagnostics-prometheus`。
- 401：核对 Prometheus `bearer_token_file` 与 Gateway 的 `OPENCLAW_PROMETHEUS_BEARER_TOKEN`。
- 配置被拒绝：manifest 和运行时都执行严格范围校验，不再静默回退非法值。
