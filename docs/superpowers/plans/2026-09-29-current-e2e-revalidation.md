# 当前源码安装态 E2E 复验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for unfinished tasks。本文件只对应一项任务；历史勾选表示交付证据，不表示本次重新执行了测试。

**Goal:** 重新运行 27 个运行时插件的安装态 E2E，使归档与当前源码和输入指纹一致。

**Architecture:** 逐插件安装最终归档，在真实 Gateway 与适用依赖下执行 E2E，再由源码指纹门禁汇总。

**Tech Stack:** TypeScript、Node.js 22+、pnpm 9、OpenClaw 2026.7.1。

**Spec:** [当前源码安装态 E2E 复验规格](../specs/2026-09-29-current-e2e-revalidation.md)

## Global Constraints

- 正式插件契约遵循 [`spec/PLUGIN_SPEC.md`](../../../spec/PLUGIN_SPEC.md)。
- 不得用旧归档或单独的 HTTP 200 代替当前安装态结果。

## Review Focus

- 核对提交日期、主线祖先关系与当前落点。
- 核对「当前源码安装态 E2E 复验」的可观察验收，不借用其他目标的完成状态。
- 运行结果、跳过数与外部平台边界单独记录。

---

### Task 1: 当前源码安装态 E2E 复验

**Files:** [`scripts/check-e2e-evidence.mjs`](../../../scripts/check-e2e-evidence.mjs)、[`scripts/e2e/lib/registry.mjs`](../../../scripts/e2e/lib/registry.mjs)

**Interfaces:** 沿用现有 E2E 注册表与指纹检查器，产出每个运行时插件的当前 PASS 归档。

- [ ] 完成「当前源码安装态 E2E 复验」：`node scripts/check-e2e-evidence.mjs` 报告 27 个运行时插件全部匹配且版本一致。

**完成门禁：** 运行 `node scripts/check-e2e-evidence.mjs`，期望 27 个运行时插件的当前源码、E2E 输入和安装版本均匹配；2026-09-29 当前结果为 27 个不匹配。
