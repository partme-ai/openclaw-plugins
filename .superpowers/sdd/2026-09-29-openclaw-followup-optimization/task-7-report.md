# Task 7 / O7 实施记录

状态：实施、本地测量及独立审查已完成，Spec PASS / Quality APPROVE；提交与推送状态见 Git 历史。

规格事实源：`docs/superpowers/specs/2026-09-29-openclaw-followup-optimization.md` 的 O7，执行任务为同目录 plan 的 Task 7。O6 的 Agent↔delivery trace 关联仍为 partial，本任务仅基于当前存储源码测量，不能据此宣称 O6 完成。

## 交付

- `scripts/benchmarks/plugin-state.mjs`：确定性匿名数据、数据 hash、真实 MemoryStore/Router DurableRouteStore 基准、容量与磁盘预留拒绝、独立临时目录清理、样本和环境 JSON 输出。
- `scripts/benchmarks/plugin-state.test.mjs`：同种子确定性、不同种子、容量/非法规模拒绝、失败样本与真实小组集成。
- `docs/superpowers/reports/2026-09-29-plugin-state-benchmark.md` 及两轮脱敏原始 JSON：两轮 6 组数据、容量拒绝、瓶颈和后续决策。根 `package.json` 与 `pnpm-lock.yaml` 仅增加明确的 `tsx 4.22.3` 开发依赖，以便从公开 API 加载当前 TypeScript 源码。

## RED → GREEN 与验证

1. 先编写测试并运行 `node --test scripts/benchmarks/plugin-state.test.mjs`，RED：缺少基准模块（`ERR_MODULE_NOT_FOUND`）。
2. 实现后同命令：5/5 PASS、0 skip。
3. `pnpm add -Dw tsx@4.22.3 --offline --lockfile-only`：只新增根依赖与锁文件对应条目；`pnpm install --offline --frozen-lockfile --filter .` 成功；公开 `tsx/esm/api` 解析通过。
4. 按计划的完整 CLI 连续两轮：每轮 Memory 1k/10k、Router 100/1k/10k 各预热一次并测量五次，正式样本均 5 成功、0 失败；Memory 100k 的 24,052,012 字节预估输入超过默认 16,777,216 字节检索预算，明确 `search-byte-budget` 拒绝且未生成虚假样本。六组对应数据 hash 两轮完全一致。最终调整事件循环采样精度后重做了两轮，报告采用最终结果。
5. `node --test scripts/*.test.mjs`：33/33 PASS、0 skip。`git diff --check`：PASS。运行后磁盘空闲约 15 GiB；每组临时目录已清理。

## 独立复审

审查者对规格与质量分别给出 **Spec PASS / Quality APPROVE**，独立重跑 5/5 定向测试和小规模真实 CLI，核对源码 hash、两轮数据 hash、统计口径、容量门禁与文件清理。两项非阻塞建议均已关闭：报告明确 Router 使用同一初始 task 快照测固定规模状态更新，避免误称连续真实重试；两轮原始 JSON 保留未舍入时延与事件循环样本，仅脱敏系统临时目录路径。审查者复核附件指标与报告一致，未发现凭据或真实消息。

边界：本机无加密、单 Agent/会话、合成词法查询与固定规模状态更新；没有业务 SLO 或真实生产负载。报告的写入字节是主状态文件大小累计，未推断物理 I/O。O7 不改生产存储，也不执行任何存储迁移。
