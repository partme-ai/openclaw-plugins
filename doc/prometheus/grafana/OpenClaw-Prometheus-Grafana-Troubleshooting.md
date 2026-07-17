# OpenClaw Grafana 排障（2026.7.1）

1. 在 Prometheus UI 查询 `openclaw_exporter_build_info`，确认数据源本身可用。
2. 查询 `label_values(openclaw_exporter_build_info, instance)`，确认 dashboard 的 `$instance` 变量能取值。
3. 对无数据 panel 复制 PromQL 到 Explore，并与 Gateway `/metrics` 的实际指标名比对。
4. Run 延迟使用 trusted diagnostics 的 `openclaw_run_duration_seconds_bucket`，不再使用旧的 `openclaw_agent_run_duration_seconds_bucket`。
5. 事件驱动指标在没有对应业务流量时不存在；这不等同于 exporter 故障。
6. 多实例 dashboard 只按 `instance` 聚合多个 Gateway，与已删除的 OpenClaw `cluster` 插件无关。

完整排障见 [OpenClaw-Prometheus-Troubleshooting.md](../OpenClaw-Prometheus-Troubleshooting.md)。
