# 共享传输层：历史规格（重建）

> 首次提交日期：2026-06-01。根据主线提交恢复目标，不冒充当时存在的原始规格；提交证据：`4359489`（2026-06-01）、`0ba5634`（2026-06-01）。

**规格事实源：** [插件统一契约](../../../spec/PLUGIN_SPEC.md)；具体实现口径以当前源码和适用的原始设计文档为准。

## 目标

向 message-sdk 收敛传输 ACL、认证与消息标识能力。

## 可观察验收

当前主线保留传输模块和相关适配入口。

## 交付边界

- 本规格只覆盖「共享传输层」这一目标；同日期其他目标另有独立的一对文档。
- 历史完成只表示提交在 main 且当前落点存在；当前测试、安装态和生产验收需要新证据。

## 当前落点

[`extensions/message-sdk/src/transport/acl-engine.ts`](../../../extensions/message-sdk/src/transport/acl-engine.ts)、[`extensions/message-sdk/src/transport/auth-guard.ts`](../../../extensions/message-sdk/src/transport/auth-guard.ts)
