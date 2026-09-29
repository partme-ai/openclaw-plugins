# 核心插件测试基线：历史规格（重建）

> 首次提交日期：2026-05-21。根据主线提交恢复目标，不冒充当时存在的原始规格；提交证据：`b69d626`（2026-05-21）。

**规格事实源：** [插件统一契约](../../../spec/PLUGIN_SPEC.md)；具体实现口径以当前源码和适用的原始设计文档为准。

## 目标

为 message-sdk、Memory 和 Router 增加可定位的单元测试。

## 可观察验收

当前主线保留这三个包的测试入口；历史测试数不代表当前通过数。

## 交付边界

- 本规格只覆盖「核心插件测试基线」这一目标；同日期其他目标另有独立的一对文档。
- 历史完成只表示提交在 main 且当前落点存在；当前测试、安装态和生产验收需要新证据。

## 当前落点

[`extensions/message-sdk/src/index.test.ts`](../../../extensions/message-sdk/src/index.test.ts)、[`extensions/memory/test/index.test.ts`](../../../extensions/memory/test/index.test.ts)、[`extensions/router/test/plugin.test.ts`](../../../extensions/router/test/plugin.test.ts)
