# 故障排查

## 常见问题

### 1. /metrics 返回 403

**原因**：scrapeAuth enabled 但未提供 token

**解决**：
```bash
export OPENCLAW_PROMETHEUS_BEARER_TOKEN="your-secret-token"
openclaw plugins install
```

或在配置中设置：
```json
{
  "scrapeAuth": {
    "enabled": false
  }
}
```

### 2. SLI 比率指标为空

**原因**：样本量不足（< 1）或 RPC 返回空数据

**解决**：
- 等待更多数据（至少 1-2 个采集周期）
- 检查 RPC 端点是否返回数据
- 查看 `openclaw_metrics_last_scrape_duration_seconds` 是否正常

### 3. Grafana Dashboard 无数据

**原因**：Grafana 数据源配置错误

**解决**：
- 检查 `DS_PROMETHEUS` URL 是否正确（通常是 `http://localhost:9090`）
- 检查 Prometheus 中是否有数据：访问 `http://localhost:9090/metrics`
- 检查 Prometheus scrape interval：建议 15s

### 4. 高 cardinality 警告

**原因**：label 值过多（如 `agent_id`、`channel`、`account`）

**解决**：
- 使用 `drop` relabel_config 过滤高基数标签：
  ```yaml
  scrape_configs:
    - job_name: 'openclaw'
      relabel_configs:
        - source_labels: [__address__]
          target_label: instance
          regex: '([^:]+)(:[0-9]+)?'
          replacement: '${1}'
        - regex: 'agent_id'
          action: drop
  ```
- 降低 label 基数：使用 `channel` 而不是 `account`
- 增加时间序列限制：在 Prometheus 中配置 `--storage.tsdb.retention.time=200d`

### 5. Histogram Quantile 查询返回 NaN

**原因**：数据量不足或 bucket 配置不合理

**解决**：
- 检查 `_bucket` 指标是否有数据
- 调整 bucket 配置（在 `config/prometheus.yaml` 中）
- 增加查询时间窗口：从 `[5m]` 改为 `[10m]`

### 6. /healthz 返回 unhealthy

**原因**：Snapshot age > 60s 或 RPC 失败

**解决**：
- 检查 `openclaw_runtime_snapshot_age_seconds` 指标
- 查看 `/metrics/debug` 中的 collector 状态
- 检查 RPC 端点是否可访问

### 7. 缓存命中率低

**原因**：collectIntervalMs 设置过小或数据变化频繁

**解决**：
- 增加采集间隔：从 15s 改为 30s
- 检查 `openclaw_cache_hits_total` / `cache_misses_total` 比率
- 调整 TTL：在 `collect-cache.ts` 中调整

### 8. 性能：/metrics 耗时过长

**原因**：指标数量过多或 RPC 延迟高

**解决**：
- 检查 `openclaw_metrics_series_total` 指标（建议 < 100K）
- 优化 RPC 调用：使用 TTL 缓存
- 调整 snapshotIntervalMs：从 30s 改为 60s

### 9. 旧版 Summary 类型与 Histogram 不兼容

**原因**：使用旧版本 dashboard 查询 `_sum` 和 `_count`

**解决**：
- 使用新版 `dashboard-advanced.json`（支持 `histogram_quantile()`）
- 更新 Grafana 变量：使用 `openclaw_agent_run_duration_seconds_bucket` 而不是 `_sum`
- 查看 `grafana/README.md` 中的新 dashboard 说明

### 10. 集群场景下 Instance Label 不唯一

**原因**：多个实例使用相同的 `instance` 值

**解决**：
- 在 Kubernetes 中使用 Pod name 作为 instance：
  ```yaml
  env:
    - name: INSTANCE
      valueFrom:
        fieldRef:
          fieldPath: metadata.name
  ```
- 在 Docker 中使用容器 ID：
  ```yaml
  env:
    - name: INSTANCE
      value: $(hostname)
  ```
- 或使用 Pod IP：
  ```bash
  export INSTANCE=$(hostname -i)
  ```

## 高级排查

### 1. 启用调试日志

在配置中添加：
```json
{
  "debug": true
}
```

或在环境变量中：
```bash
export DEBUG=openclaw-prometheus:*
```

### 2. 查看 Prometheus 查询性能

访问 `http://localhost:9090/consoles/focus` 并运行：
```promql
topk(10, rate(openclaw_agent_runs_started_total[5m]))
```

### 3. 检查 Node.js 性能

访问 `/metrics` 并查看：
- `openclaw_nodejs_heap_used_bytes`（内存使用）
- `openclaw_nodejs_event_loop_lag_ms`（事件循环延迟）
- `rate(openclaw_nodejs_process_cpu_user_seconds_total[2m])`（CPU 使用率）

### 4. 分析慢查询

在 Prometheus 中查看 `topk(10, openclaw_metrics_last_scrape_duration_seconds)` 并优化：
- 减少采集的 RPC 数量
- 增加缓存 TTL
- 优化 `snapshotSamples()` 调用

## 支持资源

- **文档**：[OpenClaw 文档](https://docs.openclaw.ai)
- **Prometheus**：[Prometheus 文档](https://prometheus.io/docs)
- **Grafana**：[Grafana 文档](https://grafana.com/docs)
- **GitHub Issues**：[报告问题](https://github.com/partme-ai/openclaw-plugins/issues)
