# OpenMem 可恢复提交本地验收记录

日期：2026-10-02。对应[稳定版升级规格 U9](../specs/2026-09-29-openclaw-2026-9-6-upgrade.md)及[Task 9](../plans/2026-09-29-openclaw-2026-9-6-upgrade.md)。实现横跨当前插件隔离 worktree 与 `/Users/wandl/workspaces/workspace-agent-fabric/OpenMem`，两个仓库分别记录代码版本。

## 已验证

- 测试先复现：Sidecar 重复 POST 生成不同归档 ID，故障后重复产物；HTTP 缺少 `GET /sessions/:id/commit`；插件重启遇到持久意图只报人工对账。
- `pnpm -r run test`：Sidecar Core 16/16、Server 7/7，通过；`pnpm -r run build` 退出 0。测试覆盖归档后记忆写入中断、进程重建后的重复提交、响应丢失、完整快照导入后的同 ID 重放，以及 HTTP 能力/状态查询。新增文件 ID 与归档路径越界回归测试，确认从快照恢复的路径不能逃出数据目录。本机 pnpm 为 9.0.0，仓库声明 10.32.1；根 `pnpm test` 被版本门禁拒绝，未擅自升级。
- OpenMem 插件 47/47、typecheck 和 build 通过；重启后发现持久意图时，只有能力端点明确返回 `idempotent: true, recoverable: true` 才重发 POST，且下一条 ACTIVE session 在旧提交完成后创建。旧 Sidecar 的不确定提交不自动重放。
- OpenClaw `2026.9.6`、Node `v24.18.0` 的最终 tarball 安装态 OpenMem 场景 PASS，未跳过安装或浏览器要求；Sidecar 路径校验更新后复验归档在 `scripts/e2e/reports/2026-10-02T05-26-17.738Z-openmem-9db66d9b-611f-457b-a795-681bdef0299d.json`（gitignored），安装包 SHA-256 为 `1962e95f939a51910fa7b9ef75ca97ff29a37dbf577814c5fc379f3c69544cd6`。场景覆盖真实 Gateway Agent Turn、Sidecar 归档、Gateway 重启及下一轮连续召回。

## 当前证据与未完成的生产验收

- 共享安装脚本变化后，27 个运行时插件均重新完成 OpenClaw 2026.9.6 安装态场景；`node scripts/check-e2e-evidence.mjs` 退出 0，报告位于 gitignored 的 `scripts/e2e/reports/`。门禁已修正浏览器插件清单字段映射，明确要求 Web-MQTT、Web-STOMP、Web-Socket 各有一个 PASS 浏览器结果，新增门禁用例 10/10 通过。三项使用本机 Chrome；Bridge 与 MQTT 组合执行；mTLS 和 Prometheus 使用宿主 Gateway。该门禁证明当前候选物与本地 fixture 契约匹配。
- 本地故障注入不是断电持久性、跨进程多写入者或部署恢复证明；本协议假设每个 Sidecar 数据目录只有一个写入者。既有 `ARCHIVED` 会话若没有提交日志，仍需人工对账。
- `/events/ingest` 与 `/sessions/:id/append` 仍分离，插件只扫描最近 1000 条事件；极长未提交会话的完整恢复、受保护网络部署、真实厂商回调及直接本地 Agent 模式仍待验收。
- U3 Router/Tracing 的同插件签发 Cookie 已在真实 Gateway HTTP 请求中验证；浏览器视觉交互、厂商实网和生产部署仍无证据，因此全套插件尚不能宣称生产环境已验收。
