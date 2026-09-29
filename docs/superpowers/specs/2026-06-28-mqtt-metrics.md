# MQTT 指标整理：历史规格（重建）

> 首次提交日期：2026-06-28。根据主线提交恢复目标，不冒充当时存在的原始规格；提交证据：`359422d`（2026-06-28）。

**规格事实源：** [插件统一契约](../../../spec/PLUGIN_SPEC.md)；具体实现口径以当前源码和适用的原始设计文档为准。

## 目标

整理 MQTT 指标收集与构建出口。

## 可观察验收

当前主线保留 MQTT 共享指标实现。

## 交付边界

- 本规格只覆盖「MQTT 指标整理」这一目标；同日期其他目标另有独立的一对文档。
- 历史完成只表示提交在 main 且当前落点存在；当前测试、安装态和生产验收需要新证据。

## 当前落点

[`extensions/mqtt/src/shared/metrics.ts`](../../../extensions/mqtt/src/shared/metrics.ts)、[`extensions/mqtt/tsup.config.ts`](../../../extensions/mqtt/tsup.config.ts)
