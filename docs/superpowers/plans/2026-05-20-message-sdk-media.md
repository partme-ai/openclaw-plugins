# 消息 SDK 多模态辅助 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for unfinished tasks。本文件只对应一项任务；历史勾选表示交付证据，不表示本次重新执行了测试。

**Goal:** 在共享 SDK 中提供媒体、ASR、OCR、TTS 的可复用模块。

**Architecture:** 按提交还原这一目标，保持其与其他目标的文档边界；以主线提交和当前文件作为历史交付证据。

**Tech Stack:** TypeScript、Node.js 22+、pnpm 9、OpenClaw 2026.7.1。

**Spec:** [消息 SDK 多模态辅助规格](../specs/2026-05-20-message-sdk-media.md)

## Global Constraints

- 正式插件契约遵循 [`spec/PLUGIN_SPEC.md`](../../../spec/PLUGIN_SPEC.md)。
- 不得把历史提交或旧报告写成当前运行验收。

## Review Focus

- 核对提交日期、主线祖先关系与当前落点。
- 核对「消息 SDK 多模态辅助」的可观察验收，不借用其他目标的完成状态。
- 运行结果、跳过数与外部平台边界单独记录。

---

### Task 1: 消息 SDK 多模态辅助

**Files:** [`extensions/message-sdk/src/media`](../../../extensions/message-sdk/src/media)、[`extensions/message-sdk/src/asr`](../../../extensions/message-sdk/src/asr)、[`extensions/message-sdk/src/ocr`](../../../extensions/message-sdk/src/ocr)、[`extensions/message-sdk/src/tts`](../../../extensions/message-sdk/src/tts)

**Interfaces:** 沿用这些当前模块的现有公开契约；本任务是历史交付索引，不重写实现。

- [x] 交付并保留「消息 SDK 多模态辅助」：当前主线保留对应模块与错误边界；真实 provider 可用性需独立验收。

**历史证据：** 主线提交 `dda6d30`（2026-05-20）、`024b72f`（2026-05-20）、`0765509`（2026-05-20）；当前落点见上。未在恢复过程中重跑该目标的单测、构建或真实环境 E2E。
