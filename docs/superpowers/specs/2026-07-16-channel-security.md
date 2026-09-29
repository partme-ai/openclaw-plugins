# 渠道安全与配置校验：历史规格（重建）

> 首次提交日期：2026-07-16。根据主线提交恢复目标，不冒充当时存在的原始规格；提交证据：`573c6d4`（2026-07-16）、`b397f55`（2026-07-16）、`4022d20`（2026-07-17）。

**规格事实源：** [插件统一契约](../../../spec/PLUGIN_SPEC.md)；具体实现口径以当前源码和适用的原始设计文档为准。

## 目标

收敛 MQTT 身份验证、Bridge 配置和跨插件安全边界。

## 可观察验收

当前主线保留针对性验证与错误处理代码。

## 交付边界

- 本规格只覆盖「渠道安全与配置校验」这一目标；同日期其他目标另有独立的一对文档。
- 历史完成只表示提交在 main 且当前落点存在；当前测试、安装态和生产验收需要新证据。

## 当前落点

[`extensions/mqtt/src/inbound.ts`](../../../extensions/mqtt/src/inbound.ts)、[`extensions/bridge/src/bridge/plugin-entry.ts`](../../../extensions/bridge/src/bridge/plugin-entry.ts)
