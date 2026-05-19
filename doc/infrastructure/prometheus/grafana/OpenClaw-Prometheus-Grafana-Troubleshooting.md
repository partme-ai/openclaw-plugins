# OpenClaw Grafana Dashboards - Troubleshooting v0.3.0

## Dashboard 空白

1. 验证 Prometheus 数据源: `curl http://<gateway>:18789/metrics | grep openclaw_up`
2. 验证 Grafana 数据源: Configuration → Data Sources → Test
3. 导入 `grafana/simple-test.json` 快速验证
4. 检查 `$instance` 变量是否返回选项

## Instance 变量无选项

1. 确认指标包含 instance 标签: `grep 'instance='`
2. 检查 Prometheus relabel_config
3. 等待 30s（变量每 2 scrape_interval 刷新）

## 面板 "No Data"

1. 检查时间范围（概览建议 Last 15m，详细建议 Last 1h）
2. 确认 `$instance` 已选择
3. 在 Prometheus UI 中验证查询表达式

## Histogram 查询返回 NaN

确认指标类型: `TYPE openclaw_agent_run_duration_seconds histogram`  
确认包含 `_bucket` 行  
等待至少 2 个 scrape interval 积累数据

## 高基数 / 加载慢

减少时间范围、使用 `$instance` 过滤、检查 `agent_id`/`channel` 标签基数
