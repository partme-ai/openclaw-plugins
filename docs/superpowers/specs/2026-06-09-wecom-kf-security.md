# WeCom KF 回调安全：历史规格（重建）

> 首次提交日期：2026-06-09。根据主线提交恢复目标，不冒充当时存在的原始规格；提交证据：`f5e9bc1`（2026-06-09）、`eed26fa`（2026-06-10）。

**规格事实源：** [插件统一契约](../../../spec/PLUGIN_SPEC.md)；具体实现口径以当前源码和适用的原始设计文档为准。

## 目标

补充客服事件、文本处理、签名和加解密路径。

## 可观察验收

当前主线保留加密实现和针对性测试。

## 交付边界

- 本规格只覆盖「WeCom KF 回调安全」这一目标；同日期其他目标另有独立的一对文档。
- 历史完成只表示提交在 main 且当前落点存在；当前测试、安装态和生产验收需要新证据。

## 当前落点

[`extensions/wecom-kf/src/shared/crypto.ts`](../../../extensions/wecom-kf/src/shared/crypto.ts)、[`extensions/wecom-kf/test/crypto.test.ts`](../../../extensions/wecom-kf/test/crypto.test.ts)
