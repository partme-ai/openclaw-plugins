# OpenClaw 2026.9.6 稳定版升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 27 个运行时插件的 OpenClaw 2026.9.6 兼容升级、安全修复和安装态验收。

**Architecture:** 先更新宿主与 SDK 边界，再集中修复 message-sdk 的入站、子 Agent 结果和结算契约，由通道消费者继承。管理接口鉴权独立验证，最终以真实宿主和产物指纹收口。

**Tech Stack:** TypeScript、Vitest、Node 24.18.0、pnpm 9.0.0、OpenClaw 2026.9.6、Docker Compose、Playwright。

**Spec:** [稳定版升级规格](../specs/2026-09-29-openclaw-2026-9-6-upgrade.md)。状态：计划已编写，实施尚未开始。

## Global Constraints

- 上游固定版本：`v2026.9.6`，提交 `eb377ac59e6c9fd6c7705028034812becf00271b`。
- 宿主 Node 范围：`>=24.16.0 <25 || >=26.1.0`；本轮 CI 和容器默认固定 Node `24.18.0`。
- 保持 pnpm `9.0.0`；OpenClaw 开发依赖固定 `2026.9.6`，宿主兼容下限改为 `2026.9.6`。
- 保留插件 ID、包名、配置键和状态目录；不通过私有导入、any 或关闭测试绕过兼容。
- 本文件命令均是未来实施步骤；编写计划不表示已执行。依赖缺失先报告，不能静默安装/升级全局工具。
- 开始实施前检查 Git 状态与 CodeGraph；不自动切分支、不覆盖用户改动。提交步骤仅在取得提交授权后执行；未授权保存差异和验证结果即可，不阻塞后续已授权工作。
- 新回归测试遵循红→绿；已有测试初次即绿时记录该项已受保护，不人为制造失败。不得为凑红灯破坏代码。
- 发布、推送及生产迁移单独授权。每项记录实际命令、退出码、通过/失败/跳过数、提交或工作区状态。

## Review Focus

1. 模板/动态导入未参与普通类型检查，最终包可能仍不可加载 → Task 2 的非 test 环境安装探针。
2. 浏览器只读 grant 被用于死信重放 → Task 3 的真实 Gateway POST 拒绝测试。
3. silent/empty/pending 被当正文或成功 → Task 5 的终态表驱动测试。
4. 第一段回复成功、后续失败，或 ACK 与去重提交之间崩溃 → Task 6 的故障与重启测试。
5. 插件版本正确但宿主/归档不匹配 → Task 7 的证据篡改测试。

## 文件与任务边界

| 任务 | 负责边界 | 依赖 |
| --- | --- | --- |
| T1 | 根依赖、插件版本元数据、CI/容器/文档基线 | 无 |
| T2 | SDK 公共导入、模板、真实包加载 | T1 |
| T3 | Router/Tracing 管理鉴权 | T2 |
| T4 | Transcript 入站适配 | T2 |
| T5 | Subagent 终态适配 | T2 |
| T6 | Wire/MQ 结算、ACK、去重 | T4、T5 |
| T7 | 宿主和产物证据门禁 | T1 |
| T8 | 最终回归与 27 插件安装验收 | T1–T7 |

---

### Task 1: 固定稳定版运行基线（U1）

**Files:** Modify `package.json`、`pnpm-lock.yaml`、`extensions/*/package.json`（27 插件、message-sdk、模板）、`.github/workflows/ci.yml`、`.github/workflows/build-nacos.yml`、`scripts/e2e/docker-compose.yml`、`scripts/e2e/README.md`、`scripts/check-release-readiness.mjs` 及其现有测试、`CLAUDE.md`；Create `scripts/check-openclaw-baseline.mjs`、`scripts/check-openclaw-baseline.test.mjs`。其他 workflow 的 Node 声明先清单化再修改。

**Interfaces:** 新校验器 `checkBaseline(repoRoot): string[]` 返回不一致项；CLI 有错误退出 1。检查 devDependency、engines、peer/compat/build/install 元数据和测试宿主版本；不把插件 version 强制等同宿主。

- [ ] 添加 fixture 测试：Node 22、旧 minGatewayVersion、旧容器镜像必须报错；插件自身版本与宿主不同但合法时可通过。
- [ ] 运行 `node --test scripts/check-openclaw-baseline.test.mjs`，确认新校验行为尚缺失导致 FAIL。
- [ ] 实现校验器并按 U1 更新元数据；release-readiness 的宿主范围更新为 >=2026.9.6，插件 TARGET_RELEASE_VERSION 保持与候选发布元数据一致，不因宿主升级而机械改为宿主版本。使用既有 pnpm 更新锁文件，将真实版本冲突记录为阻塞，禁止手工伪造 lockfile。
- [ ] 运行 `node --test scripts/check-openclaw-baseline.test.mjs` 和 `node scripts/check-openclaw-baseline.mjs`，期望全部 PASS、退出 0；后续安装执行 `pnpm install --frozen-lockfile`。
- [ ] 审查差异并记录检查结果；获授权时提交 `chore: align plugin host baseline with OpenClaw 2026.9.6`。

### Task 2: 迁移公开 SDK 与验证最终包（U2）

**Files:** Modify `extensions/message-sdk/scripts/verify-openclaw-contract.mjs`、`extensions/message-sdk/src/openclaw/loader.ts`、`extensions/wecom-kf/src/index.ts`、`extensions/wechat/src/messaging/process-message.ts`、`extensions/wechat/src/media/path-guard.ts`、`extensions/wechat/src/auth/pairing.ts`、`extensions/wechat/src/util/logger.ts`、`extensions/wechat/src/channel.ts`、`extensions/wecom/src/webhook/{http,reply-pipeline,ws-reply-pipeline}.ts`、`extensions/{mqtt,rabbitmq,web-socket}/src/outbound.ts`、`extensions/{stomp,web-stomp}/src/channel.ts`。

类型导入还覆盖 `extensions/{bridge,douyin,knowledge,memory,mqtt,openmem,rabbitmq,redis-stream,rocketmq,stomp,web-mqtt,web-socket,web-stomp,wechat,wechat-ipad,wecom-kf,_template}/src/`；实施前生成精确文件清单并附入任务证据，不能机械替换第三方名称。Test `extensions/message-sdk/src/openclaw/loader.test.ts`（新增）及现有媒体授权测试；Create `scripts/e2e/lib/sdk-load-probe.mjs`、`scripts/e2e/lib/sdk-load-probe.test.mjs`。

**Interfaces:** 保持 `importOpenClawPluginSdk<T>(subpath): Promise<T|null>` 的可选加载语义；必需能力在消费者入口显式校验并给出符号/路径诊断。新 `probeInstalledPlugin(entryPath): Promise<void>` 在真实已安装宿主解析入口，不调用网络服务。

- [ ] 为删除路径和具名导出缺失添加失败探针；媒体测试加入允许根内文件成功、越界/符号链接逃逸拒绝。断言 `await expect(probeInstalledPlugin(brokenEntry)).rejects.toThrow()`。
- [ ] 运行 `node --test scripts/e2e/lib/sdk-load-probe.test.mjs`，确认坏入口被识别；在稳定版宿主运行旧包探针保留真实 FAIL。
- [ ] 按公开导出迁移：sanitizeForPlainText→channel-outbound；typing/progress→channel-message；timeout→extension-shared；根 SDK 按符号拆分。媒体/文件锁按上游实际授权契约迁移，不能删除防护。
- [ ] 运行 `pnpm --dir extensions/message-sdk test`、`pnpm typecheck`、`pnpm build`、`pnpm --dir extensions/message-sdk verify:release`、`node scripts/check-package-archives.mjs`；所有必需检查退出 0。逐个最终包在无 VITEST/NODE_ENV=test 的已安装 2026.9.6 环境执行 probe，含 Nacos CJS 入口。
- [ ] 审查类型与运行时影响清单，获授权时提交 `fix: migrate plugins to public OpenClaw 2026.9.6 SDK`。

### Task 3: 管理接口鉴权（U3）

**Files:** Modify `extensions/router/src/index.ts`、`extensions/tracing/src/index.ts`、`extensions/router/test/index.test.ts`、`extensions/tracing/src/index.test.ts`、`scripts/e2e/plugins/router.mjs`、`scripts/e2e/plugins/tracing.mjs`；更新两插件中英文 README。

**Interfaces:** 保留 URL 和响应结构；统一 `auth: "gateway"`；重放仍是 POST。权限行为以 Gateway 实际授权为准，不在插件内伪造 operator scope。

- [ ] 添加路由元数据断言和真实 Gateway 请求用例：匿名 GET/POST 拒绝；授权 GET 成功；有效授权 POST 恰好重放一次；只读浏览器 grant、过期 token 的 POST 无副作用。
- [ ] 运行 `pnpm --dir extensions/router test`、`pnpm --dir extensions/tracing test`，新鉴权断言应 FAIL；记录旧宿主路径的匿名访问基线。
- [ ] 调整管理路由鉴权和 E2E 请求凭据；文档说明 auth=none 边界，保留 Webhook 签名验证行为。
- [ ] 重跑目标测试；执行 `node scripts/e2e/run-e2e.mjs --plugins router` 和 `node scripts/e2e/run-e2e.mjs --plugins tracing,mqtt`，期望鉴权负例及合法请求全部通过，OTLP 数据仍可观测。
- [ ] 审查敏感响应与重放副作用证据，获授权时提交 `fix: authenticate router and tracing management routes`。

### Task 4: 标准入站和 Transcript（U4）

**Files:** Modify `extensions/message-sdk/src/dispatch/transcript-dispatch.ts`、`extensions/message-sdk/src/dispatch/types.ts`、`extensions/message-sdk/src/dispatch/transcript-dispatch.test.ts`、`extensions/{douyin,wecom-kf}/src/dispatch/`、`extensions/gotify/src/channel/channel.ts`。调用方精确文件由 CodeGraph callers 校验。

**Interfaces:** 保持 `dispatchTranscriptTurn(params)` 入口；返回值升级为宿主公开类型允许的派发结果，消费者不得丢弃。以稳定版 `channel.inbound.dispatchReply` 参数类型定义适配，不复制旧 runAssembled 签名。

- [ ] 为只提供新 inbound API 的 runtime、原会话/线程保留、入站记录恰好一次、取消后零投递添加测试；断言 `recordUserTurn` 调用次数为 1，取消后的 deliver 为 0。
- [ ] 运行 `pnpm --dir extensions/message-sdk exec vitest run src/dispatch/transcript-dispatch.test.ts`，确认缺失新接口行为导致 FAIL。
- [ ] 迁移到新入站 API，移除对 runAssembled 的依赖；避免失败后盲目补写已落盘用户轮次，传播宿主结果和取消信号。
- [ ] 重跑目标测试，并执行 douyin、wecom-kf、gotify 的插件单测和各自 `node scripts/e2e/run-e2e.mjs --plugins <id>`；期望 transcript、回复、重试和重启去重均通过。
- [ ] 审查会话归属和兼容边界，获授权时提交 `fix: adopt stable channel inbound dispatch`。

### Task 5: 子 Agent 结果与失败传播（U5）

**Files:** Modify `extensions/message-sdk/src/dispatch/{agent-helpers,subagent-dispatch,types,channel-dispatch}.ts`、`extensions/message-sdk/src/dispatch/subagent-dispatch.test.ts`、`extensions/message-sdk/src/dispatch/channel-dispatch.test.ts`；Create `extensions/message-sdk/src/dispatch/subagent-outcome.test.ts`。

**Interfaces:** 新增 `resolveSubagentOutcome(result: AgentWaitResult): SubagentOutcome`，联合类型为 `{kind:"visible";text:string}`、`{kind:"silent"}`、`{kind:"empty"}`、`{kind:"pending"}`、`{kind:"failed";status:"timeout"|"error"|"invalid"}`。`dispatchSubagentMessage` 返回既有 runId/delivered 加 outcome；runtime 类型采用宿主公开类型，unknown 入口先校验。

- [ ] 写表驱动测试：ok+visible→正文；silent/empty→不发送；timeout/error/pending/未知结构→不发送 JSON，且不能报告成功。关键断言：`expect(resolveSubagentOutcome({status:"ok",terminalReply:{disposition:"visible",text:"answer"}})).toEqual({kind:"visible",text:"answer"})`。
- [ ] 运行 `pnpm --dir extensions/message-sdk exec vitest run src/dispatch/subagent-outcome.test.ts src/dispatch/subagent-dispatch.test.ts`，记录红灯。
- [ ] 实现结构化 outcome，使用 run 返回的 canonical sessionKey；按 outcome 分流，保留公开接口中已有的会话/运行身份，不根据错误字符串重试。
- [ ] 重跑目标测试及 channel-dispatch 测试，期望所有终态通过；在一个 MQ 安装场景中选择 subagent 模式验证可见回复和超时无假正文。
- [ ] 审查 outcome 消费者，获授权时提交 `fix: interpret subagent terminal replies explicitly`。

### Task 6: Wire/MQ 结算、ACK 与去重一致性（U6）

**Files:** Modify `extensions/message-sdk/src/bridge/{inbound-bridge,reply-bridge,types}.ts`、`extensions/message-sdk/src/dispatch/{wire-dispatch,channel-dispatch,types}.ts`、`extensions/message-sdk/src/ingress/deferred-delivery-ack.ts`、对应现有测试、`extensions/{mqtt,rabbitmq,redis-stream,rocketmq,stomp,web-mqtt,web-stomp,web-socket}/src/inbound.ts`；Test `extensions/rabbitmq/test/deferred-ack.test.ts`。Create `extensions/message-sdk/src/dispatch/delivery-outcome.ts` 及 `.test.ts`。

**Interfaces:** `classifyDeliveryOutcome(receipt: ReplyDispatchReceipt, terminal: "visible"|"silent"|"empty"|"pending"|"failed"): DeliveryOutcome`；返回 `{kind:"delivered"|"no-reply"|"retryable"|"ambiguous"|"cancelled"}`。Wire/Channel result 增加该字段；deferred ACK 接收 outcome，而不只检查 replyPublished。pending、failedAfterSend、部分可见投递后的失败均为 ambiguous；全发送前失败为 retryable；silent/empty 且无失败为 no-reply。缺失回执不能推断 delivered。

- [ ] 添加结算表和故障注入：block 成功/final 失败、cancel、pending、silent、发送前失败；分别断言 outcome、ACK/NACK、去重 commit/release。补充 NACK 后 commit=0、崩溃恢复不重复可见发送的测试。
- [ ] 运行 `pnpm --dir extensions/message-sdk exec vitest run src/bridge src/dispatch src/ingress` 与 `pnpm --dir extensions/rabbitmq test`，确认新语义红灯。
- [ ] 保留 dispatch/waitForIdle 回执并集中分类；逐通道映射到协议支持的延迟确认、失败重试或持久待确认/DLQ。ambiguous 禁止立即重跑整个 Agent；没有恢复能力的通道进入显式失败状态，不能冒充成功。
- [ ] 重跑单测；分别运行 8 个 MQ/Web 通道 E2E，检验 broker ACK/PEL/RECEIPT、模型调用次数、断线重启和浏览器证据。所有必需断言通过且无跳过。
- [ ] 审查协议差异及状态恢复，获授权时提交 `fix: settle channel delivery before ack and dedupe commit`。

### Task 7: 宿主、源码与产物证据门禁（U7）

**Files:** Modify `scripts/check-e2e-evidence.mjs`、`scripts/e2e/{run-e2e.mjs,README.md}`、`scripts/e2e/lib/{evidence,report,install,gateway}.mjs`、`scripts/e2e/lib/{evidence,report}.test.mjs`；Create `scripts/check-e2e-evidence.test.mjs`、`scripts/e2e/lib/host-baseline.mjs` 及 `.test.mjs`。

**Interfaces:** `readHostBaseline(cliPath): Promise<{version:string;nodeVersion:string;cliPath:string}>` 必须采自实际启动宿主。报告新增 `host`，安装项新增 `artifactSha256`；预期候选清单由打包步骤提供。`validateEvidence(report, expected): string[]` 为纯函数，expected 含宿主版本、候选插件版本/摘要及当前 sourceFingerprints；CLI 仍为 `node scripts/check-e2e-evidence.mjs`。

- [ ] 添加篡改测试：只换 host.version、插件 version、tarball hash、sourceFingerprint、浏览器结果、skip count 中任一项都拒绝；同时验证旧报告返回明确 stale 原因，坏 JSON 不触发未初始化变量异常。
- [ ] 运行 `node --test scripts/check-e2e-evidence.test.mjs scripts/e2e/lib/evidence.test.mjs scripts/e2e/lib/report.test.mjs scripts/e2e/lib/host-baseline.test.mjs`，记录新增契约红灯。
- [ ] 实现宿主采集与候选产物比对，删除“插件版本等于宿主版本”的隐含假设；报告继续脱敏并 gitignore。
- [ ] 重跑测试，期望通过；运行 `node scripts/check-e2e-evidence.mjs`，旧证据仍应失败，不能为了让检查绿而重写历史报告。
- [ ] 审查候选清单的信任来源，获授权时提交 `test: bind e2e evidence to host and installed artifacts`。

### Task 8: 27 插件最终安装态验收（U8）

**Files:** Modify `scripts/e2e/plugins/*.mjs`、`scripts/e2e/config/plugins/*.mjs` 中因升级必要的断言/配置；如需修复先归入责任任务。新增脱敏验收摘要 `docs/superpowers/reports/2026-09-29-openclaw-2026-9-6-verification.md`；运行归档继续位于 gitignored `scripts/e2e/reports/`。

**Interfaces:** 消费 T7 的证据格式及 `EXTENSION_INVENTORY`；输出每插件版本、源码指纹、artifactSha256、host、用例结果/跳过数、平台边界及归档位置。汇总必须覆盖规格列出的 27 项。

- [ ] 执行 `pnpm typecheck`、`pnpm build`、`pnpm test:unit`、`pnpm test:e2e:harness`、`pnpm test:release-scripts`、`pnpm check-release-readiness`、`pnpm check-explanatory-assets` 和包归档校验；任一必需失败先修复对应任务。
- [ ] 按注册表运行安装态场景：单插件使用 `node scripts/e2e/run-e2e.mjs --plugins <id>`；bridge/mqtt 和 tracing/mqtt 使用规定组合。mtls、oauth2、memory、openmem 等隔离配置分别执行；禁止 skip-install/skip-browser 作为最终证据。
- [ ] 核对每一插件的实际 Agent/Tool/协议结果及负例；具备 fixture 的场景标记 fixture，真实第三方平台验收单列，缺失不能写成通过。
- [ ] 运行 `node scripts/check-e2e-evidence.mjs`，期望 27 个当前候选物与 2026.9.6 宿主全部匹配、退出 0；保存可访问归档，不提交凭据或原始敏感日志。
- [ ] 完成全变更审查和兼容说明；仅凭实际证据勾选任务，并记录旧 E2E 计划是否仍待实网验证。获授权时提交 `test: verify 27 plugins on OpenClaw 2026.9.6`；推送/发布仍需对应授权。

## 自审与执行交接

U1–U8 分别由 T1–T8 覆盖；Review Focus 五项已绑定 T2/T3/T5/T6/T7 的测试。T5 的 outcome 与 T6 的 delivery outcome 分开，避免把 Agent 完成等同投递完成。源码、mock、已安装宿主、真实平台四层证据分别记录。

本次仅编写计划。执行方式待用户选择 Native（executing-plans）或逐任务子 Agent（subagent-driven-development）；不因计划头部推荐而自动启动子 Agent。建议先审阅本计划的版本下限、ACK 不确定状态和权限验收要求。
