# OpenClaw 2026.9.6：27 个运行时插件本地安装态证据收口

日期：2026-10-03。固定源码 HEAD：`c4cff662a64563f66c10bcf54fb10c77711a25ce`。宿主：OpenClaw `2026.9.6`、Node `v24.18.0`。本报告对应[后续功能优化规格](../specs/2026-09-29-openclaw-followup-optimization.md)的最终本地证据门禁；O6 的规格缺口见下文。

## 结果

在上述固定代码基线上，逐项重新构建、打包、审核候选归档并安装到专用 `queue-e2e` Gateway。独立复核运行 `node scripts/check-e2e-evidence.mjs`，退出码为 0，输出：

```text
E2E evidence is current for 27 runtime plugins (OpenClaw 2026.9.6).
```

27 个插件各有当前源码及 E2E 输入指纹匹配的选定报告，每个选定报告内该插件恰好一个 adapter `PASS`，安装/浏览器阶段跳过数均为 0。需要浏览器的 Web MQTT、Web STOMP、WebSocket 均通过真实 Chromium 浏览器测试。每项候选归档原始 SHA 与 manifest 一致；归档路径、类型、包和插件身份检查通过；`validateEvidence` 均返回空问题列表。独立复审再次运行总检查器并逐项审核 18 份本轮审计：Spec PASS / Quality APPROVE，必须修复项 0。证据报告和候选归档在本地忽略目录 `scripts/e2e/reports/`，未随 Git 推送；以下保留报告名供当前工作区复核。

| 批次 | 插件 | 本地证据 |
| --- | --- | --- |
| 结构化媒体专项 | mqtt、router、wecom、gotify | `2026-10-03T03-42-14.823Z-mqtt+router+wecom+gotify-536a4546-0388-4ec5-bf81-d3f89339f076.json`；`final-gate-head-c4-o3-audit-20261003.json` |
| 非隔离组合 | bridge、router、mqtt、rabbitmq、rocketmq、redis-stream、gotify、stomp、web-mqtt、web-stomp | `2026-10-03T03-49-30.954Z-bridge+router+mqtt+rabbitmq+rocketmq+redis-stream+gotify+stomp+web-mqtt+web-stomp-e8ee813f-9dca-4118-8569-632853c9c034.json`；`final-gate-head-c4-nonisolated-10-audit-20261003.json` |
| 独立批次一 | web-socket、wecom-kf、wechat、wechat-ipad、douyin | 各插件 `2026-10-03T03-52` 至 `03-58` 的单项报告；`final-gate-head-c4-<id>-audit-20261003.json` |
| 独立批次二 | rednode、amap、meituan、nacos、mtls | 各插件 `2026-10-03T04-01` 至 `04-06` 的单项报告；`final-gate-head-c4-<id>-audit-20261003.json` |
| 独立批次三 | oauth2、tracing、prometheus、knowledge、memory、openmem | 各插件 `2026-10-03T04-08` 至 `04-16` 的报告；`final-gate-head-c4-<id>-audit-20261003.json` |

Tracing 的适配器需要 MQTT 生成真实 Agent Turn，故其正式报告是 `2026-10-03T04-10-50.804Z-tracing+mqtt-14775e15-6bcc-446f-aef1-157f513862fb.json`；该组合报告内 Tracing 和 MQTT 各有一个 `PASS`。OpenMem 最终报告为 `2026-10-03T04-16-43.631Z-openmem-5d0b5b93-f929-4dce-9c41-98b82394f16a.json`，覆盖 Sidecar continuity API、真实 Agent Turn、关闭归档、Gateway 重启、检索回执与持久事实。美团报告 `2026-10-03T04-03-46.335Z-meituan-6017267b-314c-4ae2-a232-d6469e9209d0.json` 覆盖通知/消息回调及持久 inbox。O3 专项继续通过 Router → WeCom 文本→图片→文本与 198113 字节上传回执。

## 测试环境与资源

- 上一固定 HEAD `2d1268a` 的 27 项曾通过，但 O3 普通 JSON 兼容修复和 SDK wire 格式标记改变输入指纹，故本报告只将 `c4cff66` 重跑结果作为当前证据。修复及审查见[O3 兼容报告](2026-10-03-o3-router-json-compat.md)。
- 首次运行 OpenMem 时，外部 Sidecar 仓库缺少 TypeScript 依赖；随后在 `/Users/wandl/workspaces/workspace-agent-fabric/OpenMem` 执行 `pnpm install --offline --frozen-lockfile --filter @openmem/server...`，从本机缓存复用 365 个包、下载 0 个包，锁文件未变；Core 构建及当前 HEAD 的完整安装态 E2E 均通过。该仓库声明 pnpm `10.32.1`，本机使用 `9.0.0`，复现时应统一包管理器版本。
- 测试使用 19789 专用 Gateway；每轮结束后该端口无监听、Compose 无残留容器。用户 18789 Gateway 保持原 PID 15979。三份原有 `.browser-*.log` 均用 `cmp`/SHA 与开跑前基线确认原字节一致。测试结束磁盘可用约 27 GiB。

## 规格状态与边界

O1–O5、O7 的各自实施和本地验证已记录在任务报告；本次 27 项收口补齐最终输入指纹的安装态证据。O6 的指标、投递/召回 Span 和六插件安装态通过，但 OpenClaw 2026.9.6 的 SDK 投递点没有活动 host trace scope，Agent 根 Span 与投递 Span 仍不能共享 trace ID；[Task 6 报告](../../../.superpowers/sdd/2026-09-29-openclaw-followup-optimization/task-6-report.md)保持 **partial**，计划任务不勾选。O7 只交付本机基准和存储决策，没有执行存储迁移；Memory 100k 因默认扫描预算拒绝。

本次是本机模拟厂商与本地依赖的安装态验证。它不证明厂商实网回调、可用预发 Gateway/Sidecar、长时运行或生产 SLO，也不解除 O6 规格缺口。后续若改变公共 SDK、E2E harness、consent pin 或其他指纹输入，须重新运行 `node scripts/check-e2e-evidence.mjs`，并重测失效项。
