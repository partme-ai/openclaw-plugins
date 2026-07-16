# OpenClaw Prometheus 中文指南

> 版本：2026.7.1｜Node.js 22+｜插件配置键：`prometheus`

## 最小配置

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
          "includeRuntime": true,
          "scrapeAuth": { "enabled": true }
        }
      }
    }
  }
}
```

```bash
export OPENCLAW_PROMETHEUS_BEARER_TOKEN='replace-with-secret'
openclaw plugins install @partme.ai/openclaw-prometheus
openclaw plugins inspect prometheus
```

插件不监听独立 9090 端口；`/metrics` 挂载在 Gateway。插件不读取对话内容，也不需要 `hooks.allowConversationAccess`。

## 验证

```bash
curl -fsS -H "Authorization: Bearer $OPENCLAW_PROMETHEUS_BEARER_TOKEN" \
  http://127.0.0.1:18789/metrics | head
curl -fsS -H "Authorization: Bearer $OPENCLAW_PROMETHEUS_BEARER_TOKEN" \
  http://127.0.0.1:18789/metrics/health
```

成功标准：metrics 200、health 200 且 `healthy=true`、错误 Bearer 401、POST 405。

## 文档入口

- [架构](../OpenClaw-Prometheus-Architecture.md)
- [部署与验证](../OpenClaw-Prometheus-Deployment.md)
- [指标目录](../OpenClaw-Prometheus-Metrics.md)
- [生产就绪说明](../OpenClaw-Prometheus-Enterprise.md)
- [Grafana](../grafana/OpenClaw-Prometheus-Grafana-README.md)
