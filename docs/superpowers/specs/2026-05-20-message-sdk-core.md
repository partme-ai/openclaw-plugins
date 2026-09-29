# 统一消息 SDK：历史规格（重建）

> 首次提交日期：2026-05-20。根据主线提交恢复目标，不冒充当时存在的原始规格；提交证据：`af37304`（2026-05-20）、`230a1f3`（2026-05-20）。

**规格事实源：** [插件统一契约](../../../spec/PLUGIN_SPEC.md)；具体实现口径以当前源码和适用的原始设计文档为准。

## 目标

定义统一消息与解析、序列化入口，供多个渠道共享。

## 可观察验收

当前主线保留 UnifiedMessage、解析与公开导出。

## 交付边界

- 本规格只覆盖「统一消息 SDK」这一目标；同日期其他目标另有独立的一对文档。
- 历史完成只表示提交在 main 且当前落点存在；当前测试、安装态和生产验收需要新证据。

## 当前落点

[`extensions/message-sdk/src/core/types.ts`](../../../extensions/message-sdk/src/core/types.ts)、[`extensions/message-sdk/src/index.ts`](../../../extensions/message-sdk/src/index.ts)
