# 插件安装态 E2E 框架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for unfinished tasks。本文件只对应一项任务；历史勾选表示交付证据，不表示本次重新执行了测试。

**Goal:** 构建 Gateway、依赖服务、最终归档和浏览器验证的 E2E 编排器。

**Architecture:** 按提交还原这一目标，保持其与其他目标的文档边界；以主线提交和当前文件作为历史交付证据。

**Tech Stack:** TypeScript、Node.js 22+、pnpm 9、OpenClaw 2026.7.1。

**Spec:** [插件安装态 E2E 框架规格](../specs/2026-05-24-installed-e2e-harness.md)

## Global Constraints

- 正式插件契约遵循 [`spec/PLUGIN_SPEC.md`](../../../spec/PLUGIN_SPEC.md)。
- 不得把历史提交或旧报告写成当前运行验收。

## Review Focus

- 核对提交日期、主线祖先关系与当前落点。
- 核对「插件安装态 E2E 框架」的可观察验收，不借用其他目标的完成状态。
- 运行结果、跳过数与外部平台边界单独记录。

---

### Task 1: 插件安装态 E2E 框架

**Files:** [`scripts/e2e/run-e2e.mjs`](../../../scripts/e2e/run-e2e.mjs)、[`scripts/e2e/lib/registry.mjs`](../../../scripts/e2e/lib/registry.mjs)

**Interfaces:** 沿用这些当前模块的现有公开契约；本任务是历史交付索引，不重写实现。

- [x] 交付并保留「插件安装态 E2E 框架」：当前主线保留 E2E 编排器与适配器注册；当前报告有效性另验。

**历史证据：** 主线提交 `9f2f649`（2026-05-24）、`3bb0855`（2026-05-24）；当前落点见上。未在恢复过程中重跑该目标的单测、构建或真实环境 E2E。
