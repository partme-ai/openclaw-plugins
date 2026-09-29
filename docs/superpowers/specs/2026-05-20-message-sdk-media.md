# 消息 SDK 多模态辅助：历史规格（重建）

> 首次提交日期：2026-05-20。根据主线提交恢复目标，不冒充当时存在的原始规格；提交证据：`dda6d30`（2026-05-20）、`024b72f`（2026-05-20）、`0765509`（2026-05-20）。

**规格事实源：** [插件统一契约](../../../spec/PLUGIN_SPEC.md)；具体实现口径以当前源码和适用的原始设计文档为准。

## 目标

在共享 SDK 中提供媒体、ASR、OCR、TTS 的可复用模块。

## 可观察验收

当前主线保留对应模块与错误边界；真实 provider 可用性需独立验收。

## 交付边界

- 本规格只覆盖「消息 SDK 多模态辅助」这一目标；同日期其他目标另有独立的一对文档。
- 历史完成只表示提交在 main 且当前落点存在；当前测试、安装态和生产验收需要新证据。

## 当前落点

[`extensions/message-sdk/src/media`](../../../extensions/message-sdk/src/media)、[`extensions/message-sdk/src/asr`](../../../extensions/message-sdk/src/asr)、[`extensions/message-sdk/src/ocr`](../../../extensions/message-sdk/src/ocr)、[`extensions/message-sdk/src/tts`](../../../extensions/message-sdk/src/tts)
