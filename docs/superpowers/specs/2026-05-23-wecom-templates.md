# 企业微信可配置回复模板：历史规格（重建）

> 首次提交日期：2026-05-23。根据主线提交恢复目标，不冒充当时存在的原始规格；提交证据：`9ebf798`（2026-05-23）。

**规格事实源：** [插件统一契约](../../../spec/PLUGIN_SPEC.md)；具体实现口径以当前源码和适用的原始设计文档为准。

## 目标

让用户可配置的状态和回复文本进入 WeCom 消息流程。

## 可观察验收

当前主线保留 WeCom 配置与 WebHook 回复实现。

## 交付边界

- 本规格只覆盖「企业微信可配置回复模板」这一目标；同日期其他目标另有独立的一对文档。
- 历史完成只表示提交在 main 且当前落点存在；当前测试、安装态和生产验收需要新证据。

## 当前落点

[`extensions/wecom/src/config.ts`](../../../extensions/wecom/src/config.ts)、[`extensions/wecom/src/webhook`](../../../extensions/wecom/src/webhook)
