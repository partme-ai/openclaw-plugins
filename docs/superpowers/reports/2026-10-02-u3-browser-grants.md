# Router/Tracing 同插件浏览器授权验收

日期：2026-10-02。对应[稳定版升级规格 U3](../specs/2026-09-29-openclaw-2026-9-6-upgrade.md)。Router 与 Tracing 分别在 full 注册模式中为自身的只读状态路由登记 Control UI tab；路由仍由 Gateway 执行鉴权，Router 重放保持 POST。

在 OpenClaw `2026.9.6` 的独立 Gateway 进程中，测试从 `/control-ui-config.json` 获取服务器签发的原样 Cookie，并完成以下实际 HTTP 请求：Router 和 Tracing 各自同插件状态 GET=200、同 Cookie POST=401；Router Cookie 对 Tracing 状态 GET=401；Router Cookie 对 DLQ 重放 POST=401 且 DLQ/投递状态未变；匿名与跨插件请求被拒绝。等待真实五分钟有效期后，同一 Gateway 进程内两插件 Cookie 的状态 GET 均为 401。脱敏原始记录在 `scripts/fixtures/u3-auth-grant/reports/2026-10-02T04-08-18.732Z-pass.json`。

Router 单测 63/63、Tracing 单测 74/74、两插件类型检查和构建均通过。Router/Gotify 的 tarball 安装态场景 PASS（`scripts/e2e/reports/2026-10-02T04-16-43.758Z-router+gotify-81cf4303-56b2-4314-b4a7-85071fa35561.json`），Tracing/MQTT 的 tarball 安装态场景 PASS（`scripts/e2e/reports/2026-10-02T04-19-17.251Z-tracing+mqtt-691a8eac-03b1-41c5-b757-88ebf4a312f8.json`）。本测试不表示 `auth=none` 部署具备身份认证，也不表示已完成生产网络部署。全量 27 插件证据门禁仍需重新校验。
