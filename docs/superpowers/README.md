# Superpowers 规格与任务索引

## 当前目标

以下目标来自 2026-09-29 CodeGraph 稳定版审计。每个目标一份规格、一份计划；勾选状态以当前验收证据为准。

| 目标 | 状态 | 规格 | 任务 | 顺序 |
| --- | --- | --- | --- | --- |
| OpenClaw 2026.9.6 稳定版升级 | 本地安装态 27/27 通过；U3 与 U9 本地验证通过，实网和生产待验 | [规格](specs/2026-09-29-openclaw-2026-9-6-upgrade.md) | [8 项任务](plans/2026-09-29-openclaw-2026-9-6-upgrade.md) | [本地验收记录](reports/2026-10-03-final-27-local-e2e-gate.md) |
| 稳定版后续功能优化 | T1–T7 本地范围完成；实网和生产待验 | [规格](specs/2026-09-29-openclaw-followup-optimization.md) | [7 项任务](plans/2026-09-29-openclaw-followup-optimization.md) | [本地验收记录](reports/2026-10-03-final-27-local-e2e-gate.md) |

原「当前源码安装态 E2E 复验」保留 2026.7.1 上下文和未完成状态。2026.9.6 的验收统一由升级计划 Task 8 执行，不重复创建另一套同版本任务，也不自动勾选旧任务。

## 历史交付与原有待办

本目录按同一目标的一组连续提交建立**一份规格 + 一份单任务计划**。历史文档是 2026-09-29 的重建，不冒充原始提交中的 Superpowers 文件。现有 [插件规范](../../spec/PLUGIN_SPEC.md)、[message-sdk PRD/Tasks](../../extensions/message-sdk/docs/tasks-message-sdk-consolidation.md) 与 [生产优化计划](../../doc/OpenClaw-Plugins-Production-Optimization-Plan.md) 保持原位。

[x] 表示提交属于当前 `main` 且文件仍存在；不代表当前安装态或生产验收。2026.9.6 的 27 插件 E2E 指纹门禁已通过，具体范围见当前验收记录。

| 日期 | 交付目标 | 状态 | 规格 | 任务 |
| --- | --- | --- | --- | --- |
| 2026-05-19 | 插件仓库与统一契约 | [x] | [规格](specs/2026-05-19-workspace-foundation.md) | [任务](plans/2026-05-19-workspace-foundation.md) |
| 2026-05-19 | 跨渠道 Router | [x] | [规格](specs/2026-05-19-router.md) | [任务](plans/2026-05-19-router.md) |
| 2026-05-19 | 本地长期记忆 | [x] | [规格](specs/2026-05-19-memory.md) | [任务](plans/2026-05-19-memory.md) |
| 2026-05-19 | 独立 Knowledge 插件 | [x] | [规格](specs/2026-05-19-knowledge.md) | [任务](plans/2026-05-19-knowledge.md) |
| 2026-05-20 | 统一消息 SDK | [x] | [规格](specs/2026-05-20-message-sdk-core.md) | [任务](plans/2026-05-20-message-sdk-core.md) |
| 2026-05-20 | 消息 SDK 多模态辅助 | [x] | [规格](specs/2026-05-20-message-sdk-media.md) | [任务](plans/2026-05-20-message-sdk-media.md) |
| 2026-05-20 | MQ 渠道接入共享 SDK | [x] | [规格](specs/2026-05-20-mq-sdk-integration.md) | [任务](plans/2026-05-20-mq-sdk-integration.md) |
| 2026-05-20 | 企业微信渠道整合 | [x] | [规格](specs/2026-05-20-wecom-integration.md) | [任务](plans/2026-05-20-wecom-integration.md) |
| 2026-05-20 | 插件 CI 与 Nacos 构建 | [x] | [规格](specs/2026-05-20-plugin-ci.md) | [任务](plans/2026-05-20-plugin-ci.md) |
| 2026-05-21 | 上游渠道 Bridge | [x] | [规格](specs/2026-05-21-bridge.md) | [任务](plans/2026-05-21-bridge.md) |
| 2026-05-21 | OpenMem 外部记忆桥 | [x] | [规格](specs/2026-05-21-openmem.md) | [任务](plans/2026-05-21-openmem.md) |
| 2026-05-21 | 核心插件测试基线 | [x] | [规格](specs/2026-05-21-core-test-baseline.md) | [任务](plans/2026-05-21-core-test-baseline.md) |
| 2026-05-22 | 消息 SDK 整合规格与任务 | [x] | [规格](specs/2026-05-22-message-sdk-consolidation.md) | [任务](plans/2026-05-22-message-sdk-consolidation.md) |
| 2026-05-22 | 双语 README 约定 | [x] | [规格](specs/2026-05-22-bilingual-readmes.md) | [任务](plans/2026-05-22-bilingual-readmes.md) |
| 2026-05-23 | Gotify 历史消息恢复 | [x] | [规格](specs/2026-05-23-gotify-recovery.md) | [任务](plans/2026-05-23-gotify-recovery.md) |
| 2026-05-23 | 企业微信可配置回复模板 | [x] | [规格](specs/2026-05-23-wecom-templates.md) | [任务](plans/2026-05-23-wecom-templates.md) |
| 2026-05-24 | 插件结构标准 | [x] | [规格](specs/2026-05-24-structure-standard.md) | [任务](plans/2026-05-24-structure-standard.md) |
| 2026-05-24 | WeCom KF 会话收敛 | [x] | [规格](specs/2026-05-24-wecom-kf-convergence.md) | [任务](plans/2026-05-24-wecom-kf-convergence.md) |
| 2026-05-24 | 插件安装态 E2E 框架 | [x] | [规格](specs/2026-05-24-installed-e2e-harness.md) | [任务](plans/2026-05-24-installed-e2e-harness.md) |
| 2026-05-25 | MQ 可靠投递 | [x] | [规格](specs/2026-05-25-mq-delivery-reliability.md) | [任务](plans/2026-05-25-mq-delivery-reliability.md) |
| 2026-05-25 | 多语言消息 SDK | [x] | [规格](specs/2026-05-25-multi-language-sdk.md) | [任务](plans/2026-05-25-multi-language-sdk.md) |
| 2026-05-25 | 企业微信首响应优化 | [x] | [规格](specs/2026-05-25-wecom-first-response.md) | [任务](plans/2026-05-25-wecom-first-response.md) |
| 2026-05-26 | WebSocket 渠道 | [x] | [规格](specs/2026-05-26-web-socket-channel.md) | [任务](plans/2026-05-26-web-socket-channel.md) |
| 2026-06-01 | 共享传输层 | [x] | [规格](specs/2026-06-01-message-sdk-transport.md) | [任务](plans/2026-06-01-message-sdk-transport.md) |
| 2026-06-01 | Memory Graph 设计稿 | [x] | [规格](specs/2026-06-01-memory-graph-design.md) | [任务](plans/2026-06-01-memory-graph-design.md) |
| 2026-06-09 | WeCom KF 回调安全 | [x] | [规格](specs/2026-06-09-wecom-kf-security.md) | [任务](plans/2026-06-09-wecom-kf-security.md) |
| 2026-06-28 | MQTT 指标整理 | [x] | [规格](specs/2026-06-28-mqtt-metrics.md) | [任务](plans/2026-06-28-mqtt-metrics.md) |
| 2026-07-16 | 渠道安全与配置校验 | [x] | [规格](specs/2026-07-16-channel-security.md) | [任务](plans/2026-07-16-channel-security.md) |
| 2026-07-17 | Router 状态加密 | [x] | [规格](specs/2026-07-17-router-state-encryption.md) | [任务](plans/2026-07-17-router-state-encryption.md) |
| 2026-07-17 | E2E 源码指纹门禁 | [x] | [规格](specs/2026-07-17-e2e-source-evidence.md) | [任务](plans/2026-07-17-e2e-source-evidence.md) |
| 2026-07-17 | 业务能力插件协议强化 | [x] | [规格](specs/2026-07-17-business-capabilities.md) | [任务](plans/2026-07-17-business-capabilities.md) |
| 2026-07-17 | 微信渠道可靠性 | [x] | [规格](specs/2026-07-17-wechat-reliability.md) | [任务](plans/2026-07-17-wechat-reliability.md) |
| 2026-07-17 | README 架构说明 | [x] | [规格](specs/2026-07-17-readme-architecture.md) | [任务](plans/2026-07-17-readme-architecture.md) |
| 2026-07-18 | 发布拓扑与命名 | [x] | [规格](specs/2026-07-18-release-topology.md) | [任务](plans/2026-07-18-release-topology.md) |
| 2026-09-29 | 当前源码安装态 E2E 复验 | [ ] | [规格](specs/2026-09-29-current-e2e-revalidation.md) | [任务](plans/2026-09-29-current-e2e-revalidation.md) |
