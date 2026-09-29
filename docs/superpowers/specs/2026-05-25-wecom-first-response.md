# 企业微信首响应优化：历史规格（重建）

> 首次提交日期：2026-05-25。根据主线提交恢复目标，不冒充当时存在的原始规格；提交证据：`14bafcd`（2026-05-25）、`1a209cf`（2026-05-25）、`44ccf02`（2026-05-25）。

**规格事实源：** [插件统一契约](../../../spec/PLUGIN_SPEC.md)；具体实现口径以当前源码和适用的原始设计文档为准。

## 目标

缩短 WebSocket 首响应路径并加入队列和超时观测。

## 可观察验收

当前主线保留 WeCom 热路径、队列与监控实现。

## 交付边界

- 本规格只覆盖「企业微信首响应优化」这一目标；同日期其他目标另有独立的一对文档。
- 历史完成只表示提交在 main 且当前落点存在；当前测试、安装态和生产验收需要新证据。

## 当前落点

[`extensions/wecom/src/webhook/monitor.ts`](../../../extensions/wecom/src/webhook/monitor.ts)、[`extensions/wecom/src/channel.ts`](../../../extensions/wecom/src/channel.ts)
