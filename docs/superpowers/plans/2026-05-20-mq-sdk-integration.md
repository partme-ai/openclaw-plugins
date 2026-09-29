# MQ 渠道接入共享 SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for unfinished tasks。本文件只对应一项任务；历史勾选表示交付证据，不表示本次重新执行了测试。

**Goal:** 让 MQ 插件复用统一入站、回复与载荷能力，保留协议侧连接责任。

**Architecture:** 按提交还原这一目标，保持其与其他目标的文档边界；以主线提交和当前文件作为历史交付证据。

**Tech Stack:** TypeScript、Node.js 22+、pnpm 9、OpenClaw 2026.7.1。

**Spec:** [MQ 渠道接入共享 SDK规格](../specs/2026-05-20-mq-sdk-integration.md)

## Global Constraints

- 正式插件契约遵循 [`spec/PLUGIN_SPEC.md`](../../../spec/PLUGIN_SPEC.md)。
- 不得把历史提交或旧报告写成当前运行验收。

## Review Focus

- 核对提交日期、主线祖先关系与当前落点。
- 核对「MQ 渠道接入共享 SDK」的可观察验收，不借用其他目标的完成状态。
- 运行结果、跳过数与外部平台边界单独记录。

---

### Task 1: MQ 渠道接入共享 SDK

**Files:** [`extensions/message-sdk/src/dispatch/channel-dispatch.ts`](../../../extensions/message-sdk/src/dispatch/channel-dispatch.ts)、[`extensions/mqtt/src/inbound.ts`](../../../extensions/mqtt/src/inbound.ts)、[`extensions/rabbitmq/src/inbound.ts`](../../../extensions/rabbitmq/src/inbound.ts)

**Interfaces:** 沿用这些当前模块的现有公开契约；本任务是历史交付索引，不重写实现。

- [x] 交付并保留「MQ 渠道接入共享 SDK」：当前主线的 MQ 入站经共享 SDK 派发。

**历史证据：** 主线提交 `049c87d`（2026-05-20）；当前落点见上。未在恢复过程中重跑该目标的单测、构建或真实环境 E2E。
