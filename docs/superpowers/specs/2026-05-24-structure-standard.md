# 插件结构标准：历史规格（重建）

> 首次提交日期：2026-05-24。根据主线提交恢复目标，不冒充当时存在的原始规格；提交证据：`38a7a96`（2026-05-24）、`46cf5f8`（2026-05-24）、`84b095b`（2026-05-24）。

**规格事实源：** [插件统一契约](../../../spec/PLUGIN_SPEC.md)；具体实现口径以当前源码和适用的原始设计文档为准。

## 目标

为插件目录建立分层结构和检查器，推动现有扩展迁移。

## 可观察验收

当前主线保留结构规范、检查脚本和 CI 门禁。

## 交付边界

- 本规格只覆盖「插件结构标准」这一目标；同日期其他目标另有独立的一对文档。
- 历史完成只表示提交在 main 且当前落点存在；当前测试、安装态和生产验收需要新证据。

## 当前落点

[`doc/OpenClaw-Plugins-Structure-Standard.md`](../../../doc/OpenClaw-Plugins-Structure-Standard.md)、[`scripts/check-plugin-structure.mjs`](../../../scripts/check-plugin-structure.mjs)
