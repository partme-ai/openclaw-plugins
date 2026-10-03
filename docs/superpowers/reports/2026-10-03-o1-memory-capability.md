# O1 Memory/OpenMem 能力与会话身份本地验收

日期：2026-10-03。规格事实源：[后续功能优化 O1](../specs/2026-09-29-openclaw-followup-optimization.md)，执行任务：[Task 1](../plans/2026-09-29-openclaw-followup-optimization.md)。本记录只确认 O1 的本地候选物，不代表整个优化系列或生产环境验收。

## 实现与能力边界

Memory/OpenMem 保留公开的 `registerMemoryCapability.runtime`，分别声明真实注册的 `memory_search` / `openmem_search`。`promptBuilder` 仅在 `availableTools` 包含对应工具时提示召回。写入与真实搜索工具均从可信宿主上下文取非空 `sessionKey`，否则回退非空 `sessionId`；两者都缺失时跳过写入，不再新增共享的 `unknown` 记录。OpenMem 缺失身份的 session start/end 也不访问 Sidecar。

| 能力 | Memory | OpenMem |
| --- | --- | --- |
| 召回工具 | `memory_search` | `openmem_search` |
| 共享策略 | 默认按 session 隔离；`profileScope: agent` 才共享 L3 | 默认 `allowSharedRecall: false`；显式开启才允许共享 |
| flushPlanResolver / publicArtifacts | 未提供；JSONL 不冒充公开产物 | 未提供；Sidecar archive 不冒充公开产物 |
| supportsPrivateTranscriptRecall | 未声明 | 未声明 |

历史 `unknown` 数据未迁移或删除；现有 manager、加密、保留与容量行为没有改变。

## 实际验证

TDD 的失败与通过输出保存在本计划的本地忽略工作区 `.superpowers/sdd/2026-09-29-openclaw-followup-optimization/task-1-report.md`。目标包单测 Memory **48/48**、OpenMem **54/54**，两插件 typecheck/build 通过；本地 E2E harness 聚焦测试 **14/14**，均无 skip。真实注册工具测试覆盖 key 去空白、`sessionId` 后备、同会话命中、异会话为空、无身份为空和工具参数伪造身份无效。

| 安装态场景 | 当前报告 | 宿主与结果 | 候选 tarball SHA-256 |
| --- | --- | --- | --- |
| Memory | `scripts/e2e/reports/2026-10-02T16-13-41.624Z-memory-689604e5-f6ec-4eb2-94c2-56daa2f7eb15.json` | OpenClaw 2026.9.6 / Node v24.18.0；PASS，skip 0 | `fd8f4c8f5aa7c1db28083bd0ad35e613237fea39c940b4e5df2342e1da7bbe38` |
| OpenMem | `scripts/e2e/reports/2026-10-02T16-21-57.826Z-openmem-4cbea3bd-3ea9-4d29-8029-7a016937a541.json` | OpenClaw 2026.9.6 / Node v24.18.0；PASS，skip 0 | `933f60848a0c5a73ee7a4c05555ba0fc36a4b8d8e7f77e3a9ad09bbba5715f4c` |

两份候选经归档文件、manifest/capability、dist/map、源码映射和内容摘要审查后，精确更新本地 E2E consent pin；正式 `plugins install --link --force --accept-capabilities`、Gateway 启动及真实模型工具调用均已执行。Memory 检查 L0–L3 持久化、重启后 `memory_search` 同会话私有命中、跨会话 L0–L2 空回执及显式共享的 L3。OpenMem 检查 Sidecar 摄取/归档、重启后 `openmem_search` 本轮 UUID 回执、异会话空回执，以及关闭后已结束会话为 `ARCHIVED`、未结束会话保持 `ACTIVE`、已归档事实仍可检索。独立复审对 O1 给出 Spec PASS / Quality Approved；当前候选清单和源码指纹校验均无失败。

一次过强的测试曾要求 Gateway 关闭后所有远端 `ACTIVE` 会话立即归档，实际失败。O1 不改变未收到 `session_end` 的逻辑会话语义；保留该失败记录，最终断言验证明确结束的会话完成提交。若宿主长期不发 `session_end`，远端 `ACTIVE` 可能长期保留，需要单独定义生命周期清理策略。

## 剩余边界

- 本轮是本机真实 Gateway、真实 OpenMem Sidecar 与可控模型 fixture。OpenMem protected HTTPS proxy 模式本轮未重跑，最终保留的 `ACTIVE` 会话在关闭后未再启动 Gateway 验证继续运行；不宣称厂商或生产部署验收。
- Memory 安装态配置显式使用 `profileScope: agent` 验证 L3 共享；默认 session 隔离由真实 store/工具单测证明，不能把该次 E2E 说成默认配置验收。
- `scripts/e2e/lib/install.mjs`、`config.mjs` 等共享输入已变化。当前 `node scripts/check-e2e-evidence.mjs` 报 **25 项旧证据失效**，仅 Memory/OpenMem 为当前候选证据；全量 27 项必须在后续优化任务落定后统一重验，当前不能宣称全量发布就绪。
