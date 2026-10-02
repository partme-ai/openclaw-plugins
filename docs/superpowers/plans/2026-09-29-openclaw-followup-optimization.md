# OpenClaw 稳定版功能优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在稳定版验收基础上，交付可独立验证的记忆、上下文、消息、生命周期和可观测优化，以及存储性能决策依据。

**Architecture:** 复用已有插件能力和 message-sdk 公共边界；协议扩展显式启用、实例资源由注册生命周期拥有。性能迁移先测量，避免在兼容升级中同时改变存储模型。

**Tech Stack:** TypeScript、Vitest、OpenClaw 2026.9.6、Node 24.18.0、pnpm 9.0.0、现有 JSONL/SQLite/OTLP/Prometheus 实现。

**Spec:** [功能优化规格](../specs/2026-09-29-openclaw-followup-optimization.md)。状态：Task 1–5 已完成各自本地候选物验收；Task 2–5 独立审查 Spec PASS / Quality APPROVE，见[O2 记录](../../../.superpowers/sdd/2026-09-29-openclaw-followup-optimization/task-2-report.md)、[O3 记录](../../../.superpowers/sdd/2026-09-29-openclaw-followup-optimization/task-3-report.md)、[O4 记录](../../../.superpowers/sdd/2026-09-29-openclaw-followup-optimization/task-4-report.md)和[O5 记录](../../../.superpowers/sdd/2026-09-29-openclaw-followup-optimization/task-5-report.md)；Task 6–7 待实施。最终全仓证据仍待收口。

## Global Constraints

- 运行基线沿用 OpenClaw `2026.9.6`、Node `>=24.16.0 <25 || >=26.1.0`、pnpm `9.0.0`。
- 不新增跨插件依赖；公共代码仅放 message-sdk。保留现有配置默认行为，新增能力通过显式配置开启。
- 保留会话隔离、媒体访问授权、状态加密、保留策略、容量限制和现有故障回退。
- 稳定版升级 U1–U8 是发布前置条件；2026-09-29 的计划编写阶段不执行实现、安装、提交、推送或发布。后续实施按用户授权逐任务推进。
- 执行前读适用的 CLAUDE.md，查询 CodeGraph 调用方，检查用户改动；每项遵循红→绿→受影响回归，已有绿灯不制造假红灯。
- 提交步骤仅在取得提交授权后执行；未授权保留差异和验证记录，不阻塞已授权实现。生产数据迁移另行确认。

## Review Focus

1. 缺失 session 身份后把用户记忆写入共享桶 → Task 1 负例。
2. 三插件同时注入超出总预算、取消后仍注入 → Task 2 组合与取消测试。
3. 旧消费者收到新信封、媒体 URL 泄密 → Task 3 版本兼容与授权测试。
4. 旧实例 stop 关闭新实例资源 → Task 5 双实例竞态测试。
5. 指标引入无界标签，或 benchmark 使用不同数据得出虚假提升 → Task 6 标签测试和 Task 7 可复现性校验。

## 文件边界与依赖

T1 memory/openmem；T2 knowledge/memory/bridge 的上下文与 message-sdk 预算模块，依赖 T1；T3 message-sdk/router 结构化消息；T4 bridge 能力表；T5 基础服务生命周期；T6 tracing/prometheus，依赖 T3/T5；T7 memory/router 性能测量，依赖 T2/T6。实际实施串行处理共享文件，不让两个任务同时改同一模块。

---

### Task 1: 记忆能力与会话身份（O1）

**Files:** Modify `extensions/memory/src/index.ts`、`extensions/memory/test/index.test.ts`、`extensions/openmem/src/index.ts`、`extensions/openmem/test/index.test.ts`、两插件 README。需要能力辅助时 Create 各插件 `src/memory-capability.ts`，不跨插件引用。

**Interfaces:** 使用上游 `registerMemoryCapability` 的真实公开类型；deterministicRecallToolName 分别为 memory_search/openmem_search，promptBuilder 消费 availableTools；保持现有 manager 接口。

- [x] 测试禁用工具时 prompt 不出现召回指令、工具可用时出现正确名称；无 sessionKey/sessionId 时 append/ingest 为 0；显式共享关闭时跨会话结果为空。
- [x] 运行 `pnpm --dir extensions/memory test` 与 `pnpm --dir extensions/openmem test`，记录新增断言红灯或已有覆盖。
- [x] 补齐真实工具声明和 promptBuilder，拒绝无可靠身份的写入；为 flush/publicArtifacts 建立支持矩阵，只有后端实际支持时才注册并测试，不宣称私有 transcript 能力。
- [x] 重跑目标测试，分别执行 `node scripts/e2e/run-e2e.mjs --plugins memory` 和 `--plugins openmem`，验证检索、隔离、重启与关闭；本地候选物证据见[O1 记录](../reports/2026-10-03-o1-memory-capability.md)。
- [x] 记录能力支持矩阵和证据；已按授权提交 `feat: align memory capabilities and session ownership` 及两次修复/验收提交。

### Task 2: 组合上下文预算、来源与取消（O2）

**Files:** Modify `extensions/knowledge/src/runtime/hooks.ts`、其 `.test.ts`、`extensions/memory/src/index.ts`、`extensions/bridge/src/bridge/context-inject.ts` 及相关测试；Create `extensions/message-sdk/src/text/context-budget.ts`、`.test.ts`、`scripts/check-context-budget.mjs`、`.test.mjs`；将新函数从 `extensions/message-sdk/src/text/index.ts` 导出。

**Interfaces:** `validateContextBudgetProfile(profile, enabledPlugins): string[]` 校验规格中的 totalTokens/allocations；`truncateContextToBudget(text: string, maxTokens: number, countTokens: (text: string)=>number): string` 保证计数不超限。CLI 输出各插件现有配置对应的预算片段，由用户显式应用；运行时不引入全局可变总账。

- [x] 添加总预算 100、三方分配 40/40/20 可通过，40/40/21 必失败；中文/emoji 截断后 token 数不超限；同源片段去重；hookInvocation 已取消时迟到检索不注入。
- [x] 运行 `node --test scripts/check-context-budget.test.mjs` 及 `pnpm --dir extensions/message-sdk exec vitest run src/text/context-budget.test.ts`，确认缺失行为红灯。
- [x] 实现 profile 校验、来源标记与同源去重；各插件按分配预算裁剪，并在 await 后校验 invocation 活性、传播取消信号。缺少精确 tokenizer 使用经测试的保守上界，保留无 profile 时的旧行为。
- [x] 运行三插件目标单测；新增三插件组合 fixture，断言注入总量 ≤100 token、来源可追踪、取消后零注入；在稳定版重跑 knowledge/memory/bridge 受影响安装态场景。
- [x] 保存预算配置示例与实测 token/延迟记录；获授权时提交 `feat: bound and attribute plugin context injection`。

O2 实施、scoped 安装态验收与独立审查完成，Spec PASS / Quality APPROVE；详见 `.superpowers/sdd/2026-09-29-openclaw-followup-optimization/task-2-report.md`。四项当前证据有效，全仓其余 23 项证据需后续刷新。

### Task 3: 结构化 Wire 与 Router 消息（O3）

**Files:** Modify `extensions/message-sdk/src/core/types.ts`、`extensions/message-sdk/src/bridge/{reply-bridge,types}.ts`、Wire 编解码实际文件（先用 CodeGraph 查 serializeForTransport）、`extensions/router/src/{index,types,config}.ts` 及相关测试；Create `extensions/message-sdk/src/dispatch/structured-wire.test.ts`。

**Interfaces:** 新增显式格式 `structured-v1`：`{schemaVersion:1,messageId,deliveryId,parts:Array<{type:"text",text}|{type:"media",mediaType,url}>,replyTo?:string,threadId?:string}`；媒体 URL 必须为经授权的可传输引用。旧 envelope/legacyJsonText 编码保持。Router 含媒体到纯文本目标默认拒绝，显式 text fallback 才降级并审计。

- [x] 写文本/媒体交错顺序、thread/reply/message/delivery 身份往返测试；旧格式 golden fixture 字节不变；拒绝本地绝对路径、敏感 token URL；未声明能力的目标拒绝附件。
- [x] 运行 `pnpm --dir extensions/message-sdk exec vitest run src/dispatch/structured-wire.test.ts`、`pnpm --dir extensions/router test`，记录新格式红灯。
- [x] 实现版本化编解码和 Router payload 转发，连接升级计划已定义的投递回执；保留媒体授权，未知 schemaVersion 显式报错。
- [x] 重跑测试与一个 MQ→Router→支持媒体目标的安装态 fixture；同时验收纯文本老客户端、附件拒绝/显式降级、重试身份保持。
- [x] 更新协议文档与消费者兼容表；已按授权提交 `feat: preserve structured replies through wire routing` 和独立审查修复 `fix: reject empty structured text fallback`。

O3 安装态 mqtt/router/wecom/gotify 四项均 PASS 且零跳过，修复后的证据已按当前源码指纹和精确候选物验证；独立复审 Spec PASS / Quality APPROVE。详见[O3 记录](../../../.superpowers/sdd/2026-09-29-openclaw-followup-optimization/task-3-report.md)。其余 23 项仍待最终全仓重验。

### Task 4: Bridge 渠道能力与运行状态（O4）

**Files:** Modify `extensions/bridge/src/bridge/{channels,capabilities,context-inject}.ts`、`extensions/bridge/test/bridge/{channels,capabilities,context-inject}.test.ts`、两语言 README。

**Interfaces:** 新增 `resolveChannelAvailability(meta, runtimeFacts): {known:boolean;installed:boolean;enabled:boolean;ready:boolean;unavailableFacts?:string[]}`；运行事实只能来自宿主公开能力接口或明确注入的 manifest/status 适配器。不能从静态 ALL_CHANNELS 推导 ready；无法查询的字段保守为 false，并通过 unavailableFacts 区分未知与已知否定。

- [x] 测试静态存在但未安装→known=true/ready=false；已安装但禁用→enabled=false；未知渠道→无特权；运行失败→ready=false。对 2026.9.6 manifest 建立渠道 ID fixture。
- [x] 运行 `pnpm --dir extensions/bridge test`，记录新状态契约红灯。
- [x] 更新来源与能力映射；按公开宿主事实补全可用性，若宿主不能提供某事实则记录 unavailableFacts 并保持未就绪，不猜测。
- [x] 重跑测试及 `node scripts/e2e/run-e2e.mjs --plugins bridge,mqtt`；在隔离 Gateway 停止 MQTT 后状态转为未就绪，恢复后按宿主真实状态更新。
- [x] 更新来源、配置与就绪含义的英中文档；已按授权提交 `feat: distinguish bridge catalog and runtime capabilities` 和复审修复 `fix: veto bridge readiness when ingress is unavailable`。

O4 独立复审 Spec PASS / Quality APPROVE。最终安装态 Bridge/MQTT 各一次 PASS、零跳过，当前指纹及精确包校验为 `[]`；其他 25 项历史报告仍待最终全仓重验。详见[O4 记录](../../../.superpowers/sdd/2026-09-29-openclaw-followup-optimization/task-4-report.md)。

### Task 5: 服务实例生命周期隔离（O5）

**Files:** Modify `extensions/{oauth2,mtls,nacos,tracing,prometheus}/src/index.ts` 及其直接使用的 runtime 状态模块；Test `extensions/{nacos,tracing}/src/index.test.ts`、`extensions/prometheus/src/runtime/store.test.ts`；Create `extensions/{oauth2,mtls}/src/lifecycle.test.ts`。由 CodeGraph 定位使用全局状态的调用者并附精确改动清单。

**Interfaces:** 每次 register 创建独立资源 owner，服务 start/stop 闭包引用同一 owner；必要时局部工厂 `createServiceLifecycle(): {start(context):Promise<void>;stop():Promise<void>}`，不引入跨插件单例管理器。

- [x] 添加 A/B 两实例测试：A.stop 后 B 仍工作；start 失败后连接/定时器归零；重复 stop 安全；停止时并发启动的迟到结果被释放。
- [x] 分别运行五插件测试，记录实际缺口；已满足的 generation 防护保留并记录绿灯，不为重构而重构。
- [x] 将存在交叉所有权的模块状态收敛到实例 owner，保留现有停止超时、generation、清理顺序和授权。
- [x] 重跑目标测试和五插件安装态重启/重载场景，验证无残留监听端口、计时器和后台投递，失败启动可再次恢复。Nacos 自动配置重启未单独探测端口关闭区间，见 O5 报告。
- [x] 保存生命周期资源清单；已按授权提交 `fix: isolate plugin service lifecycle ownership` 及两轮审查修复。

O5 独立最终复审 Spec PASS / Quality APPROVE。五插件最终安装态各一次 PASS、零跳过，当前指纹及精确包校验均为 `[]`；Nacos 端口观测限制和 OAuth2 单元测试一项 Redis 依赖跳过已记录。全仓 27 插件证据检查目前仍有 21 项历史报告失效，待最终收口。详见[O5 记录](../../../.superpowers/sdd/2026-09-29-openclaw-followup-optimization/task-5-report.md)。

### Task 6: 投递与召回的可观测闭环（O6）

**Files:** Modify `extensions/tracing/src/runtime/hooks.ts`、其 `.test.ts`、`extensions/prometheus/src/runtime/observer.ts`、其 `.test.ts`、`extensions/prometheus/src/diagnostics/metric-store.ts`；按需修改 `extensions/message-sdk/src/transport/metrics.ts` 和相关测试。

**Interfaces:** 新指标 `openclaw_delivery_settlements_total{channel,outcome}`、`openclaw_delivery_retries_total{channel}`、`openclaw_router_dlq_entries`、`openclaw_memory_recall_duration_seconds{plugin}`；标签使用受控集合，原有指标保留。runId/messageId/deliveryId 只进入脱敏 trace/log，不做 metrics label。

- [ ] 写单次 delivered/failed/ambiguous 结算恰好计数一次、重试不重复成功计数、调用链共享身份、credential/body 脱敏测试；输入 1万不同 messageId 不增加标签组合数。
- [ ] 运行 `pnpm --dir extensions/tracing test` 与 `pnpm --dir extensions/prometheus test`，记录新增指标缺口。
- [ ] 消费升级计划的结构化结算结果与召回事件，贯通 trace 身份；保持 Collector 容量限制、scrape 鉴权与 shutdown flush。
- [ ] 运行 tracing,mqtt 组合和 prometheus 安装态场景；校验 OTLP 接收、scrape 值、失败计数、脱敏和标签基数，不以 HTTP 200 代替数值断言。
- [ ] 更新指标说明与排障路径；获授权时提交 `feat: correlate delivery and recall telemetry`。

### Task 7: 存储性能基线与迁移决策（O7）

**Files:** Read `extensions/memory/src/store.ts`、`extensions/router/src/durable-store.ts`；Create `scripts/benchmarks/plugin-state.mjs`、`scripts/benchmarks/plugin-state.test.mjs`、`docs/superpowers/reports/2026-09-29-plugin-state-benchmark.md`。该任务不修改生产存储实现。

**Interfaces:** `generateDataset({seed,count}): Dataset` 生成确定性脱敏数据；benchmark CLI 输出 datasetHash、硬件/Node/config、规模、样本次数、P50/P95、吞吐、扫描/写入字节和事件循环延迟。数据和产物放独立临时目录。

- [ ] 测试同 seed/count 的 hash 相同、不同 seed 的 hash 不同、规模/容量拒绝被记录；验证统计函数不能把失败样本当零耗时。
- [ ] 运行 `node --test scripts/benchmarks/plugin-state.test.mjs`，确认新测量契约红灯后实现生成/采样与报告逻辑。
- [ ] 运行新 CLI `node scripts/benchmarks/plugin-state.mjs --seed 20260929 --memory-counts 1000,10000,100000 --router-counts 100,1000,10000 --runs 5`，预热后每组至少 5 次；加密、隔离、检索质量和容量配置随报告保存。期望每组输出测量结果或明确容量拒绝，不能遗漏样本。
- [ ] 重复同种子运行并核对数据 hash；报告瓶颈、代价和保留/迁移建议，没有工作负载 SLO 不写“已达生产目标”。
- [ ] 审查测量可复现性；获授权时提交 `perf: establish memory and router storage baselines`。若建议 SQLite/worker/索引迁移，另行形成增量规格，当前任务不自动执行迁移。

## 收口与自审

O1–O7 分别由 T1–T7 覆盖。五项 Review Focus 均有对应测试。O1 不承诺不存在的后端能力；O2 仅约束插件注入；O3 显式版本化；O7 只交付测量和决策，避免把实验性迁移混入完成声明。

- [ ] 受影响插件全部通过类型检查、单测、最终包检查和稳定版安装态复验，必要浏览器场景无跳过。
- [ ] 使用升级后的 `node scripts/check-e2e-evidence.mjs` 重新确认 27 项候选证据；公共 SDK 变化引起的指纹失效必须重跑。
- [ ] 最终审查说明未提供能力、实网验证边界和存储决策；只有实际实施项才勾选。

当前按用户后续授权逐任务实施与独立审查。Task 1–5 已完成各自本地候选物验收，Task 5 独立复审通过；当前 OAuth2、mTLS、Nacos、Tracing、Prometheus 和 MQTT 六项证据有效，其余 21 项仍不满足全仓门禁，收口前必须按最终输入重验。Task 6–7 仍按本计划依赖顺序推进。
