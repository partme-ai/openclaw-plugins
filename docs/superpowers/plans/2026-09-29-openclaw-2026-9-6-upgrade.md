# OpenClaw 2026.9.6 稳定版升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 27 个运行时插件的 OpenClaw 2026.9.6 兼容升级、安全修复和安装态验收。

**Architecture:** 先更新宿主与 SDK 边界，再集中修复 message-sdk 的入站、子 Agent 结果和结算契约，由通道消费者继承。管理接口鉴权独立验证，最终以真实宿主和产物指纹收口。

**Tech Stack:** TypeScript、Vitest、Node 24.18.0、pnpm 9.0.0、OpenClaw 2026.9.6、Docker Compose、Playwright。

**Spec:** [稳定版升级规格](../specs/2026-09-29-openclaw-2026-9-6-upgrade.md)。状态：实施中；U1、U2、U4、U5、U6、U7、U8 已完成本地候选物验证；U3 已完成当前本地 Gateway 和目标安装态验证，见[U3 记录](../reports/2026-10-02-u3-browser-grants.md)。U9 的本地实现和目标验证见[后续记录](../reports/2026-10-02-openmem-recoverable-commit.md)。全量当前候选物证据门禁 27/27 通过，见[当前复验记录](../reports/2026-10-02-current-candidate-verification.md)；旧候选物证据见[验收记录](../reports/2026-09-29-openclaw-2026-9-6-verification.md)。

## Global Constraints

- 上游固定版本：`v2026.9.6`，提交 `eb377ac59e6c9fd6c7705028034812becf00271b`。
- 宿主 Node 范围：`>=24.16.0 <25 || >=26.1.0`；本轮 CI 和容器默认固定 Node `24.18.0`。
- 保持 pnpm `9.0.0`；OpenClaw 开发依赖固定 `2026.9.6`，宿主兼容下限改为 `2026.9.6`。
- 保留插件 ID、包名、配置键和状态目录；不通过私有导入、any 或关闭测试绕过兼容。
- 勾选项以实际执行证据为准；未勾选项仍是后续步骤。依赖缺失先报告，不能静默安装/升级全局工具。
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

- [x] 添加 fixture 测试：Node 22、旧 minGatewayVersion、旧容器镜像必须报错；插件自身版本与宿主不同但合法时可通过。
- [x] 运行 `node --test scripts/check-openclaw-baseline.test.mjs`，确认新校验行为尚缺失导致 FAIL。
- [x] 实现校验器并按 U1 更新元数据；release-readiness 的宿主范围更新为 >=2026.9.6，插件 TARGET_RELEASE_VERSION 保持与候选发布元数据一致，不因宿主升级而机械改为宿主版本。使用既有 pnpm 更新锁文件，将真实版本冲突记录为阻塞，禁止手工伪造 lockfile。
- [x] 运行 `node --test scripts/check-openclaw-baseline.test.mjs` 和 `node scripts/check-openclaw-baseline.mjs`，期望全部 PASS、退出 0；后续安装执行 `pnpm install --frozen-lockfile`。
- [x] 审查差异并记录检查结果；获授权时提交 `chore: align plugin host baseline with OpenClaw 2026.9.6`。

### Task 2: 迁移公开 SDK 与验证最终包（U2）

**Files:** Modify `extensions/message-sdk/scripts/verify-openclaw-contract.mjs`、`extensions/message-sdk/src/openclaw/loader.ts`、`extensions/wecom-kf/src/index.ts`、`extensions/wechat/src/messaging/process-message.ts`、`extensions/wechat/src/media/path-guard.ts`、`extensions/wechat/src/auth/pairing.ts`、`extensions/wechat/src/util/logger.ts`、`extensions/wechat/src/channel.ts`、`extensions/wecom/src/webhook/{http,reply-pipeline,ws-reply-pipeline}.ts`、`extensions/{mqtt,rabbitmq,web-socket}/src/outbound.ts`、`extensions/{stomp,web-stomp}/src/channel.ts`。

类型导入还覆盖 `extensions/{bridge,douyin,knowledge,memory,mqtt,openmem,rabbitmq,redis-stream,rocketmq,stomp,web-mqtt,web-socket,web-stomp,wechat,wechat-ipad,wecom-kf,_template}/src/`；实施前生成精确文件清单并附入任务证据，不能机械替换第三方名称。Test `extensions/message-sdk/src/openclaw/loader.test.ts`（新增）及现有媒体授权测试；Create `scripts/e2e/lib/sdk-load-probe.mjs`、`scripts/e2e/lib/sdk-load-probe.test.mjs`。

**Interfaces:** 保持 `importOpenClawPluginSdk<T>(subpath): Promise<T|null>` 的可选加载语义；必需能力在消费者入口显式校验并给出符号/路径诊断。新 `probeInstalledPlugin(entryPath): Promise<void>` 在真实已安装宿主解析入口，不调用网络服务。

- [x] 为删除路径和具名导出缺失添加失败探针；媒体测试加入允许根内文件成功、越界/符号链接逃逸拒绝。断言 `await expect(probeInstalledPlugin(brokenEntry)).rejects.toThrow()`。
- [x] 运行 `node --test scripts/e2e/lib/sdk-load-probe.test.mjs`，确认坏入口被识别；在稳定版宿主运行旧包探针保留真实 FAIL。
- [x] 按公开导出迁移：sanitizeForPlainText→channel-outbound；typing/progress→channel-message；timeout→extension-shared；根 SDK 按符号拆分。媒体/文件锁按上游实际授权契约迁移，不能删除防护。
- [x] 运行 `pnpm --dir extensions/message-sdk test`、`pnpm typecheck`、`pnpm build`、`pnpm --dir extensions/message-sdk verify:release`、`node scripts/check-package-archives.mjs`；所有必需检查退出 0。逐个最终包在无 VITEST/NODE_ENV=test 的已安装 2026.9.6 环境执行 probe，含 Nacos CJS 入口。
- [x] 审查类型与运行时影响清单；迁移提交 `8afac18` 已存在，本次告警补充纳入后续交付。验收证据见[U2 报告](../reports/2026-09-29-u2-sdk-compat.md)。

### Task 3: 管理接口鉴权（U3）

**Files:** Modify `extensions/router/src/index.ts`、`extensions/tracing/src/index.ts`、`extensions/router/test/index.test.ts`、`extensions/tracing/src/index.test.ts`、`scripts/e2e/plugins/router.mjs`、`scripts/e2e/plugins/tracing.mjs`；更新两插件中英文 README。

**Interfaces:** 保留 URL 和响应结构；统一 `auth: "gateway"`；重放仍是 POST。权限行为以 Gateway 实际授权为准，不在插件内伪造 operator scope。

- [x] 添加路由元数据断言和真实 Gateway 请求用例：匿名 GET/POST 拒绝；授权 GET 成功；有效授权 POST 恰好重放一次；只读浏览器 grant 和真实过期 Cookie 均无重放副作用。
- [x] 运行 `pnpm --dir extensions/router test`、`pnpm --dir extensions/tracing test`，新注册断言先 FAIL；旧匿名访问基线见[前次验收记录](../reports/2026-09-29-openclaw-2026-9-6-verification.md)。
- [x] 调整管理路由鉴权和 E2E 请求凭据，注册同插件只读状态 tab；文档说明 auth=none 边界，保留 Webhook 签名验证行为。
- [x] 重跑目标测试；执行 `node scripts/e2e/run-e2e.mjs --plugins router,gotify` 和 `--plugins tracing,mqtt`，鉴权负例及合法请求通过，OTLP 数据可观测；真实 Cookie 详见[U3 记录](../reports/2026-10-02-u3-browser-grants.md)。
- [x] 审查敏感响应与重放副作用证据；同插件只读 Cookie 的 GET/POST、跨插件读取及重放副作用、真实过期均由当前 Gateway 记录验证，纳入本轮提交。

### Task 4: 标准入站和 Transcript（U4）

**Files:** Modify `extensions/message-sdk/src/dispatch/transcript-dispatch.ts`、`extensions/message-sdk/src/dispatch/types.ts`、`extensions/message-sdk/src/dispatch/transcript-dispatch.test.ts`、`extensions/{douyin,wecom-kf}/src/dispatch/`、`extensions/gotify/src/channel/channel.ts`。调用方精确文件由 CodeGraph callers 校验。

**Interfaces:** 保持 `dispatchTranscriptTurn(params)` 入口；返回值升级为宿主公开类型允许的派发结果，消费者不得丢弃。以稳定版 `channel.inbound.dispatchReply` 参数类型定义适配，不复制旧 runAssembled 签名。

- [x] 为只提供新 inbound API 的 runtime、原会话/线程保留、入站记录恰好一次、取消后零投递添加测试；公开 SDK 无 `recordUserTurn`，改用可观察的轮次记录和投递次数验证。
- [x] 运行 `pnpm --dir extensions/message-sdk exec vitest run src/dispatch/transcript-dispatch.test.ts`，确认缺失新接口行为导致 FAIL。
- [x] 迁移到新入站 API，移除对 runAssembled 的依赖；避免失败后盲目补写已落盘用户轮次，传播宿主结果和取消信号。
- [x] 重跑目标测试，并执行 douyin、wecom-kf、gotify 的插件单测和各自 `node scripts/e2e/run-e2e.mjs --plugins <id>`；验证 transcript、回复、重试和重启去重。
- [x] 审查会话归属和兼容边界；U4 代码提交至 `57cd4f524329798e56f9149676b9365724fc952c`，独立审查 Critical 0、Important 0，安装态归档见本任务执行报告。

### Task 5: 子 Agent 结果与失败传播（U5）

**Files:** Modify `extensions/message-sdk/src/dispatch/{agent-helpers,subagent-dispatch,types,channel-dispatch}.ts`、`extensions/message-sdk/src/dispatch/subagent-dispatch.test.ts`、`extensions/message-sdk/src/dispatch/channel-dispatch.test.ts`；Create `extensions/message-sdk/src/dispatch/subagent-outcome.test.ts`。

**Interfaces:** 新增 `resolveSubagentOutcome(result: AgentWaitResult): SubagentOutcome`，联合类型为 `{kind:"visible";text:string}`、`{kind:"silent"}`、`{kind:"empty"}`、`{kind:"pending"}`、`{kind:"failed";status:"timeout"|"error"|"invalid"}`。`dispatchSubagentMessage` 返回既有 runId/delivered 加 outcome；runtime 类型采用宿主公开类型，unknown 入口先校验。

- [x] 写表驱动测试：ok+visible→正文；silent/empty→不发送；timeout/error/pending/未知结构→不发送 JSON，且不能报告成功。关键断言覆盖公开宿主终态结构。
- [x] 运行 `pnpm --dir extensions/message-sdk exec vitest run src/dispatch/subagent-outcome.test.ts src/dispatch/subagent-dispatch.test.ts`，记录红灯。
- [x] 实现结构化 outcome，使用 run 返回的 canonical sessionKey；按 outcome 分流，保留公开接口中已有的会话/运行身份，不根据错误字符串重试。
- [x] 重跑目标测试及 channel-dispatch 测试；RabbitMQ 安装态 subagent 场景验证可见回复与精确 timeout、零假正文、单次 NACK。
- [x] 审查 outcome 消费者；U5 代码提交至 `3042f4ad10c28fecfe25dac5a379c8554e54b1f2`，独立审查 Critical 0、Important 0；其他 MQ 通道结算留待 U6。

### Task 6: Wire/MQ 结算、ACK 与去重一致性（U6）

**Files:** Modify `extensions/message-sdk/src/bridge/{inbound-bridge,reply-bridge,types}.ts`、`extensions/message-sdk/src/dispatch/{wire-dispatch,channel-dispatch,types}.ts`、`extensions/message-sdk/src/ingress/deferred-delivery-ack.ts`、对应现有测试、`extensions/{mqtt,rabbitmq,redis-stream,rocketmq,stomp,web-mqtt,web-stomp,web-socket}/src/inbound.ts`；Test `extensions/rabbitmq/test/deferred-ack.test.ts`。Create `extensions/message-sdk/src/dispatch/delivery-outcome.ts` 及 `.test.ts`。

**Interfaces:** `classifyDeliveryOutcome(receipt: ReplyDispatchReceipt, terminal: "visible"|"silent"|"empty"|"pending"|"failed"): DeliveryOutcome`；返回 `{kind:"delivered"|"no-reply"|"retryable"|"ambiguous"|"cancelled"}`。Wire/Channel result 增加该字段；deferred ACK 接收 outcome，而不只检查 replyPublished。pending、failedAfterSend、部分可见投递后的失败均为 ambiguous；全发送前失败为 retryable；silent/empty 且无失败为 no-reply。缺失回执不能推断 delivered。

- [x] 添加结算表和故障注入：block 成功/final 失败、cancel、pending、silent、发送前失败；分别断言 outcome、ACK/NACK、去重 commit/release。补充 NACK 后 commit=0、崩溃恢复不重复可见发送的测试。
- [x] 运行 `pnpm --dir extensions/message-sdk exec vitest run src/bridge src/dispatch src/ingress` 与 `pnpm --dir extensions/rabbitmq test`，确认新语义红灯。
- [x] 保留 dispatch/waitForIdle 回执并集中分类；逐通道映射到协议支持的延迟确认、失败重试或持久待确认/DLQ。ambiguous 禁止立即重跑整个 Agent；没有恢复能力的通道进入显式失败状态，不能冒充成功。
- [x] 重跑单测；分别运行 8 个 MQ/Web 通道 E2E，检验 broker ACK/PEL/RECEIPT、模型调用次数、断线重启和浏览器证据。所有必需断言通过且无跳过。
- [x] 审查协议差异及状态恢复；实现和测试证据见[验收记录](../reports/2026-09-29-openclaw-2026-9-6-verification.md)。2026-10-02 的后续请求已授权提交和推送。

### Task 7: 宿主、源码与产物证据门禁（U7）

**Files:** Modify `scripts/check-e2e-evidence.mjs`、`scripts/e2e/{run-e2e.mjs,README.md}`、`scripts/e2e/lib/{evidence,report,install,gateway}.mjs`、`scripts/e2e/lib/{evidence,report}.test.mjs`；Create `scripts/check-e2e-evidence.test.mjs`、`scripts/e2e/lib/host-baseline.mjs` 及 `.test.mjs`。

**Interfaces:** `readHostBaseline(cliPath): Promise<{version:string;nodeVersion:string;cliPath:string}>` 必须采自实际启动宿主。报告新增 `host`，安装项新增 `artifactSha256`；预期候选清单由打包步骤提供。`validateEvidence(report, expected): string[]` 为纯函数，expected 含宿主版本、候选插件版本/摘要及当前 sourceFingerprints；CLI 仍为 `node scripts/check-e2e-evidence.mjs`。

- [x] 添加篡改测试：只换 host.version、插件 version、tarball hash、sourceFingerprint、浏览器结果、skip count 中任一项都拒绝；同时验证旧报告返回明确 stale 原因，坏 JSON 不触发未初始化变量异常。
- [x] 运行 `node --test scripts/check-e2e-evidence.test.mjs scripts/e2e/lib/evidence.test.mjs scripts/e2e/lib/report.test.mjs scripts/e2e/lib/host-baseline.test.mjs`，记录新增契约红灯。
- [x] 实现宿主采集与候选产物比对，删除“插件版本等于宿主版本”的隐含假设；报告继续脱敏并 gitignore。
- [x] 重跑测试，期望通过；运行 `node scripts/check-e2e-evidence.mjs`，旧证据仍应失败，不能为了让检查绿而重写历史报告。
- [x] 审查候选清单的信任来源，获授权时提交 `test: bind e2e evidence to host and installed artifacts`。

### Task 8: 27 插件最终安装态验收（U8）

**Files:** Modify `scripts/e2e/plugins/*.mjs`、`scripts/e2e/config/plugins/*.mjs` 中因升级必要的断言/配置；如需修复先归入责任任务。新增脱敏验收摘要 `docs/superpowers/reports/2026-09-29-openclaw-2026-9-6-verification.md`；运行归档继续位于 gitignored `scripts/e2e/reports/`。

**Interfaces:** 消费 T7 的证据格式及 `EXTENSION_INVENTORY`；输出每插件版本、源码指纹、artifactSha256、host、用例结果/跳过数、平台边界及归档位置。汇总必须覆盖规格列出的 27 项。

- [x] 执行 `pnpm typecheck`、`pnpm build`、`pnpm test:unit`、`pnpm test:e2e:harness`、`pnpm test:release-scripts`、`pnpm check-release-readiness`、`pnpm check-explanatory-assets` 和包归档校验；结果见[验收记录](../reports/2026-09-29-openclaw-2026-9-6-verification.md)。
- [x] 按注册表运行安装态场景：单插件使用 `node scripts/e2e/run-e2e.mjs --plugins <id>`；bridge/mqtt、router/gotify、tracing/mqtt 使用规定组合。mtls、oauth2、memory、openmem 等隔离配置分别执行；无 skip-install/skip-browser。
- [x] 核对每一插件的实际 Agent/Tool/协议结果及负例；具备 fixture 的场景标记 fixture，真实第三方平台验收单列，缺失未写成通过。
- [x] 运行 `node scripts/check-e2e-evidence.mjs`，27 个当前候选物与 2026.9.6 宿主全部匹配、退出 0；已保存可访问归档，未提交凭据或原始敏感日志。
- [x] 完成全变更审查和兼容说明；逐项证据见验收记录，旧 E2E 计划仍待实网验证。独立复核识别出 OpenMem Sidecar 提交意图已落盘但 POST 未发出时无法自动恢复的生产阻断，已记录人工对账边界。2026-10-02 的后续请求已授权 Git 提交与 GitHub 推送；npm 发布仍未授权。

### Task 9: OpenMem 可恢复提交（U9）

**Files:** OpenMem 仓库的 `packages/core/src/{engine,application/externalization.service,application/session-lifecycle.service,application/snapshot.service,infrastructure/local-bridge-store}.ts` 与 `apps/server/src/routes/sessions.ts`；本仓库的 `extensions/openmem/src/coordinator.ts`、对应测试和 README。OpenMem 仓库没有单独初始化规格体系；本规格是跨仓库协议事实源。

- [x] 故障注入测试先复现重复归档/事实 ID、HTTP 缺少能力端点、插件重启后提交意图阻塞；记录红灯。
- [x] Sidecar 持久提交快照、原子文件发布、产物重放与终态顺序、只读能力端点；完整快照保留提交日志。
- [x] 插件只在 Sidecar 明确声明幂等且可恢复时重试；下一会话开始前处理持久意图；旧 Sidecar 保持人工对账。
- [x] Core 16/16、Server 7/7、插件 47/47、构建和类型检查，以及 OpenClaw 2026.9.6 tarball 安装态 OpenMem 场景通过；Core 包含文件路径边界回归。
- [x] 本地真实 Sidecar 进程在归档写入后注入记忆写入失败，强制结束、重启并重试；归档/事实 ID、Markdown、检索索引与终态保持一致。见[本地复验记录](../reports/2026-10-02-local-gateway-sidecar-callbacks.md)。
- [ ] 多写入者、真实断电/部署恢复和受保护网络验收；[预发环境发现与入口清单](../reports/2026-10-02-preprod-discovery.md)已记录，取得独立环境后执行。完成后才能把该协议视为生产环境已验收。

共享安装门禁的 OpenMem 包摘要更新后，已重新运行 27 个插件的安装态场景；`check-e2e-evidence` 对当前候选物退出 0。旧报告只作为历史证据。

## 自审与执行交接

U1–U9 分别由 T1–T9 覆盖；Review Focus 五项已绑定 T2/T3/T5/T6/T7 的测试。T5 的 outcome 与 T6 的 delivery outcome 分开，避免把 Agent 完成等同投递完成。源码、mock、已安装宿主、真实平台四层证据分别记录。

U8 的 27 项固定宿主安装态场景已对当前候选物重验；U3 的 Router/Tracing 同插件签发 Cookie 已在真实 Gateway HTTP 边界验证。真实厂商联调、浏览器视觉交互、生产部署及 U9 的部署故障恢复仍需验收。npm 包尚未发布。
