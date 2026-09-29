# 当前源码安装态 E2E 复验：验收规格

> 建档日期：2026-09-29。当前待办，尚无完成提交。

**规格事实源：** [插件统一契约](../../../spec/PLUGIN_SPEC.md)；具体实现口径以当前源码和适用的原始设计文档为准。

## 目标

重新运行 27 个运行时插件的安装态 E2E，使归档与当前源码和输入指纹一致。

## 可观察验收

`node scripts/check-e2e-evidence.mjs` 报告 27 个运行时插件全部匹配且版本一致。

## 交付边界

- 本规格只覆盖「当前源码安装态 E2E 复验」这一目标；同日期其他目标另有独立的一对文档。
- 通过安装态 E2E 和指纹门禁后才能勾选任务；旧 PASS 归档不能替代。

## 当前落点

[`scripts/check-e2e-evidence.mjs`](../../../scripts/check-e2e-evidence.mjs)、[`scripts/e2e/lib/registry.mjs`](../../../scripts/e2e/lib/registry.mjs)
