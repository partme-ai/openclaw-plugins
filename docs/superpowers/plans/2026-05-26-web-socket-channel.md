# WebSocket 渠道 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for unfinished tasks。本文件只对应一项任务；历史勾选表示交付证据，不表示本次重新执行了测试。

**Goal:** 增加支持客户端和服务端模式的 WebSocket 渠道插件。

**Architecture:** 按提交还原这一目标，保持其与其他目标的文档边界；以主线提交和当前文件作为历史交付证据。

**Tech Stack:** TypeScript、Node.js 22+、pnpm 9、OpenClaw 2026.7.1。

**Spec:** [WebSocket 渠道规格](../specs/2026-05-26-web-socket-channel.md)

## Global Constraints

- 正式插件契约遵循 [`spec/PLUGIN_SPEC.md`](../../../spec/PLUGIN_SPEC.md)。
- 不得把历史提交或旧报告写成当前运行验收。

## Review Focus

- 核对提交日期、主线祖先关系与当前落点。
- 核对「WebSocket 渠道」的可观察验收，不借用其他目标的完成状态。
- 运行结果、跳过数与外部平台边界单独记录。

---

### Task 1: WebSocket 渠道

**Files:** [`extensions/web-socket/package.json`](../../../extensions/web-socket/package.json)、[`extensions/web-socket/src/channel.ts`](../../../extensions/web-socket/src/channel.ts)

**Interfaces:** 沿用这些当前模块的现有公开契约；本任务是历史交付索引，不重写实现。

- [x] 交付并保留「WebSocket 渠道」：当前主线保留独立包、manifest 和渠道实现。

**历史证据：** 主线提交 `f56fdf2`（2026-05-26）；当前落点见上。未在恢复过程中重跑该目标的单测、构建或真实环境 E2E。
