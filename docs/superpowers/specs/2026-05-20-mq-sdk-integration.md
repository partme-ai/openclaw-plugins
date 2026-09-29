# MQ 渠道接入共享 SDK：历史规格（重建）

> 首次提交日期：2026-05-20。根据主线提交恢复目标，不冒充当时存在的原始规格；提交证据：`049c87d`（2026-05-20）。

**规格事实源：** [插件统一契约](../../../spec/PLUGIN_SPEC.md)；具体实现口径以当前源码和适用的原始设计文档为准。

## 目标

让 MQ 插件复用统一入站、回复与载荷能力，保留协议侧连接责任。

## 可观察验收

当前主线的 MQ 入站经共享 SDK 派发。

## 交付边界

- 本规格只覆盖「MQ 渠道接入共享 SDK」这一目标；同日期其他目标另有独立的一对文档。
- 历史完成只表示提交在 main 且当前落点存在；当前测试、安装态和生产验收需要新证据。

## 当前落点

[`extensions/message-sdk/src/dispatch/channel-dispatch.ts`](../../../extensions/message-sdk/src/dispatch/channel-dispatch.ts)、[`extensions/mqtt/src/inbound.ts`](../../../extensions/mqtt/src/inbound.ts)、[`extensions/rabbitmq/src/inbound.ts`](../../../extensions/rabbitmq/src/inbound.ts)
