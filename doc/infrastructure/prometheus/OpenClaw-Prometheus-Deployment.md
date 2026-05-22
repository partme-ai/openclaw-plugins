# OpenClaw Prometheus Plugin - 本地部署与验证指南

> 版本：0.3.1 | 日期：2026-05-22 | 状态：✅ **本地环境就绪（含 diagnostics-prometheus 平替）** |

---

## 📋 目录

- [1. 环境准备](#1-环境准备)
- [2. Prometheus 配置](#2-prometheus-配置)
- [3. 插件安装/加载](#3-插件安装加载)
  - [3.4 禁用 bundled diagnostics-prometheus（必做）](#34-禁用-bundled-diagnostics-prometheus必做)
- [4. 数据验证](#4-数据验证)
- [5. Grafana Dashboard 导入](#5-grafana-dashboard-导入)
- [6. 常见问题排查](#6-常见问题排查)

---

## 1. 环境准备

### 前置条件

- ✅ **OpenClaw Gateway** 已启动并运行在 `http://127.0.0.1:18789`
- ✅ **Prometheus** 已安装（版本 2.45+）
- ✅ **OpenClaw CLI** 已安装并已登录：`openclaw login`
- ✅ **Node.js** 版本：18.x LTS 或 20.x LTS

### 验证 Gateway 运行

```bash
# 检查 Gateway 是否启动
curl -I http://127.0.0.1:18789/health

# 预期输出
# HTTP/1.1 200 OK

# 检查 Prometheus 插件是否已安装
openclaw plugins list

# 预期输出（如果没有插件）
# No plugins installed

# 预期输出（如果已安装）
# ...
# openclaw-prometheus
```

---

## 2. Prometheus 配置

### 2.1 配置文件说明

**文件**：`config/local-prometheus.yml`

**核心配置**：
```yaml
scrape_configs:
  - job_name: 'openclaw-gateway'
    scrape_interval: 10s
    scrape_timeout: 10s
    metrics_path: /metrics
    honor_labels: true
    honor_timestamps: true
    scheme: http
    static_configs:
      - targets: ['127.0.0.1:18789']
    relabel_configs:
      # Instance Label 支持（多实例部署时使用）
      - source_labels: [__address__]
        target_label: instance
        regex: '([^:]+)(:[0-9]+)?'
        replacement: '${1}'
```

### 2.2 启动 Prometheus

```bash
# 1. 启动 Prometheus（前台调试）
prometheus --config.file=config/local-prometheus.yml

# 2. 启动 Prometheus（后台运行）
nohup prometheus --config.file=config/local-prometheus.yml > /tmp/prometheus.log 2>&1 &

# 3. 验证 Prometheus 日志
tail -f /tmp/prometheus.log | grep -i 'openclaw'

# 预期输出
# ts=2026-04-20T13:00:00.000Z caller=scrape_manager.go:736 component=scrape_manager level=info msg="target \"127.0.0.1:18789\" in job \"openclaw-gateway\" scrape success..."
```

---

## 3. 插件安装/加载

### 3.1 从本地开发目录加载（推荐）

```bash
# 方法 1：使用 OpenClaw CLI 从本地目录加载
cd /path/to/openclaw-plugins/extensions/prometheus

# 安装插件（编译并加载到 Gateway）
pnpm build
openclaw plugins install .
```

### 3.2 从 NPM Registry 加载（开发阶段）

```bash
# 方法 2：使用 NPM link 方式（仅用于本地开发）
cd /path/to/openclaw-plugins/extensions/prometheus

# 链接到全局 NPM（需要 root 权限）
npm link

# 在 OpenClaw Gateway 中加载插件
# 需要在 Gateway 的配置文件中指定插件路径
# 例如：`plugins.paths: ["/usr/local/lib/node_modules/@partme.ai/openclaw-prometheus"]`
```

### 3.3 验证插件状态

```bash
# 检查插件是否已加载
openclaw plugins list

# 检查插件状态
openclaw plugins status openclaw-prometheus

# 预期输出
# Status: enabled
# Health: OK
```

### 3.4 禁用 bundled diagnostics-prometheus（必做）

`openclaw-prometheus` **已内置**官方 `diagnostics-prometheus` 的全部 diagnostic 指标逻辑（`openclaw_model_tokens_total`、`openclaw_run_*` 等）。若与 bundled 插件同时启用，会**重复订阅** internal diagnostics，导致指标重复或 series 膨胀。

**步骤 1 — 编辑 Gateway 配置**（通常为 `~/.openclaw/openclaw.json` 或项目内 `openclaw.json`）：

```json
{
  "plugins": {
    "entries": {
      "diagnostics-prometheus": {
        "enabled": false
      },
      "openclaw-prometheus": {
        "enabled": true,
        "config": {
          "path": "/metrics",
          "collectIntervalMs": 15000,
          "snapshotIntervalMs": 30000,
          "includeRuntime": true,
          "monitoredProviders": ["openai", "anthropic", "gemini"]
        }
      }
    }
  }
}
```

**步骤 2 — 确认 bundled 插件未加载**：

```bash
openclaw plugins list | grep -E 'diagnostics-prometheus|openclaw-prometheus'

# 期望：仅 openclaw-prometheus 为 enabled
# diagnostics-prometheus 应不存在或显示 disabled
```

**步骤 3 — 重启 Gateway**（使插件与服务订阅生效）：

```bash
# 按你的部署方式重启，例如：
openclaw gateway restart
# 或 systemctl / docker compose restart
```

**步骤 4 — 验证 diagnostics 指标已出现**（需有 LLM 调用产生 `model.usage` 事件）：

```bash
curl -s http://127.0.0.1:18789/metrics | grep -E 'openclaw_model_tokens_total|openclaw_run_completed_total' | head -5

# 预期（有流量时）：
# openclaw_model_tokens_total{agent="...",channel="...",model="...",provider="...",token_type="input"} ...
# # TYPE openclaw_run_duration_seconds histogram
```

**步骤 5 — 确认未重复 TYPE 行**（同一指标名不应出现两次 `# TYPE`）：

```bash
curl -s http://127.0.0.1:18789/metrics | grep '^# TYPE openclaw_model_tokens_total'
# 期望：仅一行
```

> Token **实时吞吐**来自 `openclaw_model_tokens_total`（diagnostics counter）；**窗口用量/成本**仍来自 RPC 的 `openclaw_usage_*` gauge。Grafana 面板已按此区分 PromQL。

---

## 4. 数据验证

### 4.1 验证 Prometheus 数据采集

```bash
# 1. 直接访问 Prometheus 指标端点
curl -s http://127.0.0.1:18789/metrics | head -50

# 预期输出（简化示例）
# # HELP openclaw_up Whether OpenClaw Prometheus plugin is loaded
# # TYPE openclaw_up gauge
# openclaw_up 1
# # HELP openclaw_ready Whether OpenClaw Prometheus plugin runtime is initialized
# # TYPE openclaw_ready gauge
# openclaw_ready 1
# # HELP openclaw_plugin_uptime_seconds Plugin uptime in seconds
# # TYPE openclaw_plugin_uptime_seconds gauge
# openclaw_plugin_uptime_seconds 123.456
```

### 4.2 验证 Instance Label

```bash
# 检查 instance 标签是否正确
curl -s http://127.0.0.1:18789/metrics | grep 'instance="'

# 预期输出
# openclaw_up{instance="127.0.0.1"} 1
# openclaw_ready{instance="127.0.0.1"} 1
# openclaw_sli_message_success_ratio{instance="127.0.0.1"} 0.95
```

### 4.3 验证关键指标

```bash
# 验证 SLO 比率
curl -s http://127.0.0.1:18789/metrics | grep 'openclaw_sli_'

# 预期输出
# openclaw_sli_message_success_ratio{instance="127.0.0.1"} 0.98
# openclaw_sli_agent_error_ratio{instance="127.0.0.1"} 0.02
# openclaw_sli_tool_error_ratio{instance="127.0.0.1"} 0.01
# openclaw_sli_channel_health_ratio{instance="127.0.0.1"} 0.99

# 验证 diagnostics token 指标（有 LLM 流量后）
curl -s http://127.0.0.1:18789/metrics | grep 'openclaw_model_tokens_total{.*token_type="input"'

# 验证 RPC 窗口用量（scrape 后即可见）
curl -s http://127.0.0.1:18789/metrics | grep 'openclaw_usage_tokens_input_total '

# 验证 Histogram 指标
curl -s http://127.0.0.1:18789/metrics | grep 'openclaw_agent_run_duration_seconds_'

# 预期输出（Histogram 示例）
# openclaw_agent_run_duration_seconds_sum{instance="127.0.0.1"} 123.456
# openclaw_agent_run_duration_seconds_count{instance="127.0.0.1"} 100
# openclaw_agent_run_duration_seconds_bucket{instance="127.0.0.1",le="0.005"} 10
# openclaw_agent_run_duration_seconds_bucket{instance="127.0.0.1",le="+Inf"} 100
```

### 4.4 验证多实例 Label（集群部署）

```bash
# 如果有多个 Gateway 实例，检查各自的 instance 标签
curl -s http://127.0.0.1:18789/metrics | grep -o 'instance="[^"]*"' | sort -u

# 预期输出（2 个实例示例）
# instance="gateway-01"
# instance="gateway-02"
```

---

## 5. Grafana Dashboard 导入

### 5.1 创建 Grafana 数据源

1. 访问 Grafana：`http://127.0.0.1:3000`
2. 导航：**Configuration** → **Data Sources** → **Add data source**
3. 配置数据源：
   - **Name**: `Prometheus-Local`
   - **Type**: `Prometheus`
   - **URL**: `http://127.0.0.1:9090`
   - **Access**: **Server (Default)**
   - **Forward OAuth Identity**: ✅ 未选中
   - **Skip TLS Verify**: ✅ 选中
4. 点击 **"Save & Test"** 按钮
5. 预期结果：**"Data source is working"**

### 5.2 导入集群概览 Dashboard

1. 导航：**Dashboards** → **New** → **Import**
2. 上传文件：
   - **Upload JSON file**：选择 `grafana/cluster/dashboard-overview.json`
   - 或 **Paste JSON**：直接粘贴 JSON 内容
3. 配置导入选项：
   - **Name**: `OpenClaw - Cluster Overview`
   - **Folder**: `OpenClaw`
   - **UID**: 自动生成或手动输入（如 `openclaw-cluster-overview`）
4. 选择数据源：`Prometheus-Local`
5. 点击 **"Import"** 按钮

### 5.3 配置 Dashboard 变量

导入后，在 Dashboard 页面顶部，点击 **"Dashboard Settings"** 图标，然后：

1. **配置 Instance 变量**：
   - 找到 `$openclaw_instance` 变量
   - 确保其 **查询** 为：`label_values(openclaw_up, instance)`
   - 选择 **"All"** 值（默认显示所有实例）
   - **刷新间隔**：设置为 `2`（每 2 秒刷新变量列表）

2. **验证变量值**：
   - 点击 `$openclaw_instance` 下拉框
   - 应该看到至少 `127.0.0.1` 或其他已配置的 instance 标签
   - 如果看到 "No options"，说明 Prometheus 未返回 instance 标签

3. **测试实例切换**：
   - 选择 `127.0.0.1`
   - 所有面板应只显示该实例的数据
   - 选择 `All`
   - 所有面板应显示所有实例的聚合数据

### 5.4 导入详细指标 Dashboard

1. 再次导航：**Dashboards** → **New** → **Import**
2. 上传文件：
   - **Upload JSON file**：选择 `grafana/cluster/dashboard-metrics.json`
   - 或 **Paste JSON**：直接粘贴 JSON 内容
3. 配置导入选项：
   - **Name**: `OpenClaw - Detailed Metrics`
   - **Folder**: `OpenClaw`
   - **UID**: 自动生成或手动输入（如 `openclaw-cluster-metrics`）
4. 选择数据源：`Prometheus-Local`
5. 点击 **"Import"** 按钮

### 5.5 配置详细 Dashboard 变量

导入后，在 Dashboard 页面顶部，点击 **"Dashboard Settings"** 图标，然后：

1. **配置 Instance 变量**：
   - 找到 `$openclaw_instance` 变量
   - 确保其 **查询** 为：`label_values(openclaw_up, instance)`
   - 选择 **"All"** 值（默认显示所有实例）

2. **配置 Queue 变量（如果使用了）**：
   - 找到 `$openclaw_queue` 变量
   - 确保其 **查询** 为：`label_values(openclaw_channel, queue)`
   - 选择 **"All"** 值（默认显示所有队列）

3. **配置 Node 变量（如果使用了）**：
   - 找到 `$openclaw_node` 变量
   - 确保其 **查询** 为：`label_values(openclaw_node, node)`
   - 选择 **"All"** 值（默认显示所有节点）

### 5.6 设置 Dashboard 时间范围

在 Dashboard 右上角时间选择器中，设置：
- **概览 Dashboard**：选择 **Last 15 minutes**
- **详细指标 Dashboard**：选择 **Last 1 hour**
- **刷新间隔**：在 Dashboard 右上角设置为 **10s**

---

## 6. 常见问题排查

### 6.1 Prometheus 无数据

**问题**：`curl http://127.0.0.1:18789/metrics` 返回空响应

**原因**：
1. 插件未安装或未启用
2. Prometheus scrape 配置错误（URL 或 metrics_path 不正确）
3. 网络问题（防火墙、代理）

**解决方案**：
```bash
# 1. 检查插件状态
openclaw plugins list

# 2. 检查插件状态
openclaw plugins status openclaw-prometheus

# 3. 重新安装插件
openclaw plugins remove openclaw-prometheus
openclaw plugins install

# 4. 检查 Prometheus 配置
cat config/local-prometheus.yml | grep -A5 'static_configs'

# 5. 检查 Prometheus 日志
tail -f /tmp/prometheus.log | grep -i 'error\|failed'

# 6. 测试网络连通性
curl -I http://127.0.0.1:18789/health

# 7. 测试 Prometheus 端口
curl -I http://127.0.0.1:9090
```

### 6.2 Grafana Dashboard 空白

**问题**：导入的 Dashboard 完全空白

**原因**：
1. Dashboard JSON 格式错误（缺少必要字段）
2. 数据源配置错误（URL 或认证问题）
3. 变量查询失败（`label_values()` 返回空结果）
4. 时间范围不正确（查询的历史数据超出了 Prometheus 保留时间）

**解决方案**：
```bash
# 1. 验证 Dashboard JSON 格式
cat grafana/cluster/dashboard-overview.json | python -m json.tool | head -20

# 2. 验证数据源连接
# 在 Grafana 中：Configuration → Data Sources → Prometheus-Local → "Test"
# 预期结果："Data source is working"

# 3. 测试变量查询
# 在 Grafana 中：Configuration → Variables → $openclaw_instance
# 点击 "Query Inspector" 查看实际发送的查询
# 预期：`label_values(openclaw_up, instance)`

# 4. 检查 Prometheus 数据
curl -s http://127.0.0.1:9090/api/v1/query?query=label_values(openclaw_up,instance)

# 5. 调整时间范围
# 在 Dashboard 右上角选择 "Last 1 hour" 或 "Last 6 hours"
# 不要使用 "Last 7 days"（可能超出 Prometheus 保留时间）
```

### 6.3 Instance Label 丢失

**问题**：指标中没有 `instance` 标签

**原因**：
1. Prometheus relabel_config 未正确配置
2. 插件配置中 `instance` 字段为空字符串
3. 多个实例使用相同的 instance 标签值

**解决方案**：
```bash
# 1. 检查 Prometheus 配置
cat config/local-prometheus.yml | grep -A10 'relabel_configs'

# 2. 验证 instance 标签
curl -s http://127.0.0.1:18789/metrics | grep 'instance="' | head -5

# 如果没有 instance 标签，重新配置 Prometheus
# 修改 config/local-prometheus.yml，添加正确的 relabel_config

# 3. 重启 Prometheus
# pkill prometheus && prometheus --config.file=config/local-prometheus.yml

# 4. 检查插件配置
# 查看 openclaw.plugin.json 中的 instance 字段
# 如果配置了 instance，确认值为非空字符串
```

### 6.4 Histogram 百分位查询失败

**问题**：Grafana 查询 `histogram_quantile()` 返回 NaN 或无数据

**原因**：
1. `openclaw_agent_run_duration_seconds` 不是 Histogram 类型（而是 Summary）
2. `_bucket` 指标不存在
3. 数据量不足（Prometheus 还未采集到足够样本）

**解决方案**：
```bash
# 1. 验证指标类型
curl -s http://127.0.0.1:18789/metrics | grep 'TYPE openclaw_agent_run_duration_seconds'

# 预期输出
# TYPE openclaw_agent_run_duration_seconds histogram

# 如果仍然是 summary，需要重新构建插件
# 确保 src/observer.ts 中使用了 registry.observeHistogram() 而不是 observeSummary()

# 2. 验证 _bucket 指标
curl -s http://127.0.0.1:18789/metrics | grep 'openclaw_agent_run_duration_seconds_bucket'

# 预期输出（示例）
# openclaw_agent_run_duration_seconds_bucket{instance="127.0.0.1",le="0.001"} 10
# openclaw_agent_run_duration_seconds_bucket{instance="127.0.0.1",le="0.005"} 50
# ...
# openclaw_agent_run_duration_seconds_bucket{instance="127.0.0.1",le="+Inf"} 100

# 3. 重新部署插件
# pnpm build
# openclaw plugins remove openclaw-prometheus
# openclaw plugins install

# 4. 在 Grafana 中测试查询
# 打开任意面板的 Query Inspector
# 输入：histogram_quantile(0.95, rate(openclaw_agent_run_duration_seconds_bucket[5m]))
# 预期结果：返回 P95 延迟值（秒）
```

### 6.5 Dashboard 面板显示异常

**问题**：面板显示 "No Data" 或查询失败

**原因**：
1. Prometheus 查询语法错误
2. 指标名称拼写错误
3. 时间范围设置不正确
4. Grafana 版本不兼容

**解决方案**：
```bash
# 1. 检查 Prometheus 查询
# 在 Prometheus UI 中：http://127.0.0.1:9090/graph
# 输入查询：histogram_quantile(0.95, rate(openclaw_agent_run_duration_seconds_bucket[5m]))
# 点击 "Execute" 按钮
# 预期结果：返回表格或图表

# 2. 验证指标名称
curl -s http://127.0.0.1:18789/metrics | grep -E '^(openclaw_|# HELP)' | head -20

# 3. 检查 Grafana 日志
tail -f /var/log/grafana/grafana.log | grep -i 'error\|panic'

# 4. 清除浏览器缓存
# 在 Grafana 中按 Ctrl+Shift+R（强制刷新）
# 或清除浏览器缓存

# 5. 重新导入 Dashboard
# Dashboard → Settings → Delete → 删除后重新导入
```

---

## 🚀 快速开始

### 最小化配置（3 分钟）

```bash
# 1. 启动 Prometheus
prometheus --config.file=config/local-prometheus.yml &

# 2. 安装插件
cd /path/to/openclaw-plugins/extensions/prometheus
openclaw plugins install

# 3. 验证数据采集
curl http://127.0.0.1:18789/metrics | head -10

# 预期输出
# # HELP openclaw_up Whether OpenClaw Prometheus plugin is loaded
# # TYPE openclaw_up gauge
# openclaw_up 1
```

### 推荐配置（15 分钟）

```bash
# 1. 启动 Prometheus（后台）
nohup prometheus --config.file=config/local-prometheus.yml > /tmp/prometheus.log 2>&1 &

# 2. 等待 Prometheus 启动（5 秒）
sleep 5

# 3. 检查 Prometheus 日志
tail -f /tmp/prometheus.log | grep -i 'openclaw'

# 4. 安装插件
cd /path/to/openclaw-plugins/extensions/prometheus
openclaw plugins install

# 5. 验证插件状态
openclaw plugins status openclaw-prometheus

# 6. 验证数据采集
curl -s http://127.0.0.1:18789/metrics | grep -E 'openclaw_up|openclaw_ready|openclaw_sli_'
```

---

## 📊 验证清单

| 项目 | 状态 | 验证命令 |
|------|------|---------|
| Prometheus 运行 | ✅ | `curl -I http://127.0.0.1:9090` |
| Prometheus 配置 | ✅ | `cat config/local-prometheus.yml` |
| 插件安装 | ✅ | `openclaw plugins install` |
| 插件状态 | ✅ | `openclaw plugins status` |
| 数据采集 | ✅ | `curl http://127.0.0.1:18789/metrics` |
| Instance 标签 | ✅ | `grep instance="'` |
| SLO 指标 | ✅ | `grep openclaw_sli_` |
| Diagnostics token | ✅ | `grep openclaw_model_tokens_total` |
| Histogram 指标 | ✅ | `grep _bucket` |

---

## 📝 相关文档

- **Prometheus 文档**: https://prometheus.io/docs
- **Grafana 文档**: https://grafana.com/docs
- **OpenClaw 文档**: https://docs.openclaw.ai
- **插件 README**: [../README.md](../README.md)
- **架构文档**: [../ARCHITECTURE.md](../ARCHITECTURE.md)

---

**版本**: 0.3.1  
**日期**: 2026-05-22  
**状态**: ✅ **本地环境就绪（禁用 diagnostics-prometheus 后使用 openclaw-prometheus）**  
