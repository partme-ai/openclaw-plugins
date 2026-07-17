# OpenClaw Prometheus 生产就绪说明

> 版本：2026.7.1｜结论：插件核心路径已通过本地生产门禁；外部 Prometheus/Grafana 长周期压测仍需在目标环境执行。

## 已完成

- 使用 OpenClaw 2026.7.1 官方 plugin SDK、启动激活与精确 Gateway 路由；
- trusted diagnostics、Gateway RPC、公共 hooks/events 三层指标汇聚；
- 2048 + 4096 两级 series 上限及 dropped-series 自监控；
- scrape Bearer 常量时间比较、GET-only、no-store、严格查询参数；
- 最近一次 collector 状态与累计错误计数分离；
- Gateway RPC 超时/有限重试/连接清理，订阅和定时器可释放；
- 严格 manifest/runtime 配置校验，Node 22 与 OpenClaw 2026.7.1 版本约束；
- 33 项自动化测试及真实 tarball/Gateway HTTP 验证。

## 生产部署仍需完成

- 在目标网络和真实鉴权配置上做 24 小时以上 soak test；
- 用真实业务 label 分布验证 series 上限、Prometheus 内存与 scrape latency；
- 将 `alerts/prometheus.yml` 按业务 SLO 校准后再启用，不能把示例阈值视为通用生产阈值；
- 验证 Grafana dashboard 与当前 metric names，删除无数据或过期 panel；
- 配置 TLS、反向代理访问控制、Bearer 密钥轮换和 Prometheus retention；
- 接入发布流水线的 tarball install、Gateway smoke test 与回滚演练。

因此，本插件可以进入目标环境验收，但不能仅凭仓库内测试宣称所有部署场景“100% 企业级”。
