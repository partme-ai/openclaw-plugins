# E2E 源码指纹门禁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for unfinished tasks。本文件只对应一项任务；历史勾选表示交付证据，不表示本次重新执行了测试。

**Goal:** 要求 E2E PASS 归档与当前源码、输入和安装版本一致。

**Architecture:** 按提交还原这一目标，保持其与其他目标的文档边界；以主线提交和当前文件作为历史交付证据。

**Tech Stack:** TypeScript、Node.js 22+、pnpm 9、OpenClaw 2026.7.1。

**Spec:** [E2E 源码指纹门禁规格](../specs/2026-07-17-e2e-source-evidence.md)

## Global Constraints

- 正式插件契约遵循 [`spec/PLUGIN_SPEC.md`](../../../spec/PLUGIN_SPEC.md)。
- 不得把历史提交或旧报告写成当前运行验收。

## Review Focus

- 核对提交日期、主线祖先关系与当前落点。
- 核对「E2E 源码指纹门禁」的可观察验收，不借用其他目标的完成状态。
- 运行结果、跳过数与外部平台边界单独记录。

---

### Task 1: E2E 源码指纹门禁

**Files:** [`scripts/check-e2e-evidence.mjs`](../../../scripts/check-e2e-evidence.mjs)、[`scripts/e2e/lib/evidence.mjs`](../../../scripts/e2e/lib/evidence.mjs)

**Interfaces:** 沿用这些当前模块的现有公开契约；本任务是历史交付索引，不重写实现。

- [x] 交付并保留「E2E 源码指纹门禁」：当前主线保留指纹与检查器；旧 PASS 不能自动证明当前状态。

**历史证据：** 主线提交 `48d2a11`（2026-07-17）；当前落点见上。未在恢复过程中重跑该目标的单测、构建或真实环境 E2E。
