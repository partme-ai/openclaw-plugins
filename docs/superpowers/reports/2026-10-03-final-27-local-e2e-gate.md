# OpenClaw 2026.9.6：27 个运行时插件本地安装态证据收口

日期：2026-10-03。宿主：OpenClaw `2026.9.6`、Node `v24.18.0`。本报告按当前源码与 E2E 输入指纹选取证据，不借用旧 Git HEAD 的 PASS；对应[后续功能优化规格](../specs/2026-09-29-openclaw-followup-optimization.md)。

## 当前结果

在专用 `queue-e2e` Gateway 逐项构建、打包、审核候选归档并安装测试。`node scripts/check-e2e-evidence.mjs` 退出码 0，输出：

```text
E2E evidence is current for 27 runtime plugins (OpenClaw 2026.9.6).
```

检查器选中 **17 份**当前报告覆盖 27 个运行时插件：每项源码与 E2E 输入指纹匹配，候选 tarball 的 SHA-256、版本及包身份匹配，插件适配器在选中报告内恰有一个 `PASS`，安装和浏览器跳过数均为 0。Web MQTT、Web STOMP、WebSocket 各有一个真实 Chrome 浏览器 `PASS`。独立复核者重新运行总检查器并逐项核对报告、候选物和浏览器证明，未发现必须修复项。

| 证据组 | 当前报告（位于本地忽略目录 `scripts/e2e/reports/`） | 覆盖 |
| --- | --- | --- |
| O3 结构化媒体 | `2026-10-03T07-50-40.782Z-mqtt+router+wecom+gotify-586dc64e-d4a7-4b12-a481-6a072d8dd995.json` | MQTT、Router、WeCom、Gotify；四项均 PASS，零安装态跳过 |
| O6 六插件 | `2026-10-03T07-14-08.442Z-mqtt+router+gotify+tracing+prometheus+memory-c2860719-bb9c-43b4-a4bc-75f2cf6ac6e0.json` | Tracing、Prometheus、Memory；同份报告中的 MQTT、Router、Gotify 也通过 |
| 协议与浏览器 | `2026-10-03T07-33-51.853Z-stomp+web-mqtt+web-stomp+rabbitmq+rocketmq+redis-stream-832fb67a-5013-459e-a6d7-e0d18ed74cbe.json` | STOMP、Web MQTT、Web STOMP、RabbitMQ、RocketMQ、Redis Stream |
| WebSocket 浏览器 | `2026-10-03T07-35-18.776Z-web-socket-c9fd65f3-a953-4de5-98f9-7e7e26d0be97.json` | WebSocket |
| Bridge 能力 | `2026-10-03T07-25-09.718Z-bridge+mqtt-42286a5c-ddd9-4c75-b510-62c7e50506ac.json` | Bridge 与 MQTT 停止、恢复 |
| 12 个隔离插件 | `2026-10-03T06-53` 至 `07-08` 的各插件单项报告 | WeCom KF、WeChat、WeChat iPad、Douyin、RedNode、Amap、Meituan、Nacos、mTLS、OAuth2、Knowledge、OpenMem |

O6 正式报告中，真实 MQTT Agent 根与 `delivery.started`、`delivery.settlement` 共享 trace ID `9bc90f3cfa6eecfa034c823aaccad0fb`；开始和结算各 1 次，原始投递 ID 未进入 Collector，回合结束后活动 Span/Trace 均为 0。Prometheus 实际样本包括 MQTT delivered=1、Router failed=1/retries=1/DLQ depth=2、Memory recall count=1、diagnostic queue drops=0。详情见[Task 6 报告](../../../.superpowers/sdd/2026-09-29-openclaw-followup-optimization/task-6-report.md)。

O3 的首次附加重跑遗漏已有的 `OPENCLAW_E2E_STRUCTURED_DNS_PIN=1`，本机代理将公开图片域名解析为特殊用途地址 `198.18.1.20`，宿主 SSRF 检查拒绝媒体下载，Router 进入死信；该失败报告为 `2026-10-03T07-41-21.796Z-mqtt+router+wecom+gotify-70fc80eb-c2ba-4599-8131-07e0cf5741d0.json`，不算通过证据。按 O3 原验收配置同时设置 `OPENCLAW_E2E_STRUCTURED_WIRE=1` 和 `OPENCLAW_E2E_STRUCTURED_DNS_PIN=1` 后，四插件重跑 4/4 PASS、`skipCount=0`。当前 Router E2E 适配器的 PASS 条件包含 WeCom 文本→图片→文本顺序与实际上传字节的 SHA-256 `2e482e7c603d87edd0411414466f0f84d02c5055741a5a507b54f54a9c026851`；本轮终端输出还显示上传 198113 字节，但归档 JSON 没有单独保存该字节数字段。该 DNS 固定只装载到本地专用 Gateway 子进程，仍使用公开地址、HTTPS/TLS 与宿主 SSRF 检查；未改生产代码或系统 DNS。通过报告的候选清单为 `candidates/0c4681ea-5a86-4711-9318-110f9023a013.json`；总证据检查器随后再次退出 0，并选中这份 O3 报告的四项结果。

## 浏览器原始证明与环境

Playwright 默认 Chromium 缓存缺失；本轮使用现有 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。测试报告以外，本轮原始浏览器日志复制到忽略目录 `scripts/e2e/reports/browser-proof/2026-10-03-final/`：MQTT 请求 ID `browser-1791012831204`、回复时间 `1791012831428`，STOMP 回复时间 `1791012831120`，均落在 07:33:51 UTC 报告窗口；WebSocket 请求 ID `web-socket-browser-1791012918271`、回复时间 `1791012918411`，落在 07:35:18 UTC 报告窗口。独立复核者核对这些 ID、时间及浏览器报告。三份用户原有 `.browser-*.log` 在复制证明后逐字节恢复，`cmp` 均通过；它们记录的是更早的一轮合成浏览器交互，不是上述 07:33/07:35 UTC 的原始证明。原任务提交 `7cc4e67` 未纳入这些日志；后续用户要求“全部提交”后，三份原有日志作为单独的历史记录提交。

OpenMem Sidecar 源码在 `/Users/wandl/workspaces/workspace-agent-fabric/OpenMem`。首次重跑时根 `node_modules` 缺失；执行 `pnpm install --offline --frozen-lockfile` 从本机缓存恢复 366 个包、下载 0 个包，随后真实 Sidecar、Agent 回合、检索及关闭归档通过。该仓库声明 pnpm `10.32.1`，本机运行 `9.0.0`；Sidecar 锁文件和源码没有修改。

测试结束后，专用 Gateway 19789 和浏览器测试端口 8765 无监听，`docker ps` 无 `openclaw-e2e-*` 容器；用户原有 18789 Gateway 保持 PID 15979。磁盘剩余约 16 GiB。

## 规格与边界

O1–O7 的本地范围已按各自任务报告完成。O6 的精确 Agent↔delivery trace 身份已在当前源码与本地安装态证明；O7 只交付本机存储基准和决策，没有执行迁移，Memory 100k 规模因默认检索预算明确拒绝。宿主公共 `log.record` 总线无法认证事件发出者，OTLP/Prometheus 是尽力观测，不是投递 ACK 或审计权威。

本轮使用本地模型 fixture、模拟厂商回调和本地依赖；**不证明厂商实网回调、可用预发 Gateway/Sidecar、长时运行或生产 SLO**。忽略目录中的报告、候选归档和浏览器证明未随 Git 推送；换机器复核需重新运行安装态测试。后续若改变公共 SDK、E2E harness、授权摘要或其他指纹输入，须重跑总检查器并复测失效项。
