# MQ 可靠投递：历史规格（重建）

> 首次提交日期：2026-05-25。根据主线提交恢复目标，不冒充当时存在的原始规格；提交证据：`4e8df92`（2026-05-25）、`74fdab3`（2026-05-25）、`95f06b5`（2026-05-25）。

**规格事实源：** [插件统一契约](../../../spec/PLUGIN_SPEC.md)；具体实现口径以当前源码和适用的原始设计文档为准。

## 目标

让消费确认等待回复投递结果，并为失败提供重试和恢复边界。

## 可观察验收

当前主线保留 deferred ACK 和 MQ 可靠性实现。

## 交付边界

- 本规格只覆盖「MQ 可靠投递」这一目标；同日期其他目标另有独立的一对文档。
- 历史完成只表示提交在 main 且当前落点存在；当前测试、安装态和生产验收需要新证据。

## 当前落点

[`extensions/message-sdk/src/ingress/deferred-delivery-ack.ts`](../../../extensions/message-sdk/src/ingress/deferred-delivery-ack.ts)、[`extensions/rabbitmq/src/inbound.ts`](../../../extensions/rabbitmq/src/inbound.ts)
