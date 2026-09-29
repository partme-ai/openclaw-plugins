# Gotify 历史消息恢复：历史规格（重建）

> 首次提交日期：2026-05-23。根据主线提交恢复目标，不冒充当时存在的原始规格；提交证据：`02c057d`（2026-05-23）、`134550b`（2026-05-23）。

**规格事实源：** [插件统一契约](../../../spec/PLUGIN_SPEC.md)；具体实现口径以当前源码和适用的原始设计文档为准。

## 目标

支持 Gotify 入站历史补拉、过滤和重放队列。

## 可观察验收

当前主线保留 Gotify 运行实现与相关测试目录。

## 交付边界

- 本规格只覆盖「Gotify 历史消息恢复」这一目标；同日期其他目标另有独立的一对文档。
- 历史完成只表示提交在 main 且当前落点存在；当前测试、安装态和生产验收需要新证据。

## 当前落点

[`extensions/gotify/src/channel/channel.ts`](../../../extensions/gotify/src/channel/channel.ts)、[`extensions/gotify/test`](../../../extensions/gotify/test)
