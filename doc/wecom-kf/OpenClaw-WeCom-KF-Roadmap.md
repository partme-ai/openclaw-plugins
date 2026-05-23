# OpenClaw WeCom KF 可执行路线图

> **文档版本：** 2026-05-24  
> **适用范围：** `openclaw-plugins/extensions/wecom-kf`  
> **关联文档：**  
> - [主架构](./OpenClaw-WeCom-KF-Master-Architecture.md)  
> - [Tools 架构](./OpenClaw-WeCom-KF-Tools-Architecture.md)  
> - [PRD（User Stories / 联调清单）](../../../.omx/plans/prd-wecom-kf-intelligent-cs.md)

**用途：** 一页看清目标形态、目录收敛方向、当前 Phase 任务与验收命令。实现 PR 请按本表拆任务，完成后在 PR 描述中勾选对应行。

---

## 1. 目标形态（KF-only 做什么 / 不做什么）

### 1.1 做什么

| 域 | 能力 | 企微 API / 机制 |
|----|------|-----------------|
| **回调入口** | GET 验签 + POST 解密；`kf_msg_or_event` / `kf_account_auth_change` | 97712 / 94670 |
| **消息拉取** | `sync_msg` + cursor 持久化 + msgid 去重 | 94670 |
| **入站分发** | origin 3/4/5 矩阵；客户消息 → OpenClaw Agent | 94670 |
| **出站回复** | `send_msg`（48h/5 条）+ 分片 / Markdown 降级 | 94677 |
| **事件响应** | `send_msg_on_event`（欢迎 / 排队 / 结束语） | 95122 |
| **Control Tools** | `wecom_kf_*` 旁路；API 原始数据 **不进** LLM session | 94645/61/65/69 |
| **多账号绑定** | 一 `open_kfid` → 一 Agent；`bindings.accountId = open_kfid` | OpenClaw bindings |
| **Onboarding** | KF 分步向导；动态 `webhookPath` 路由 | research 对齐 |
| **智能化（可选）** | 对话状态机、intent、skills 注入 | `src/kf/*` |

**运行时主路径：**

```
企微回调 → callback.ts → sync_msg → dispatch → message-sdk ingress → Agent → outbound → send_msg
系统事件 (origin=4) → system-event.ts → send_msg_on_event
Tool 旁路 → control-tools.ts → admin API（结果 redacted）
```

### 1.2 不做什么

| 排除项 | 处置 |
|--------|------|
| wecom-cs **Bot 模式**（群聊 / @机器人 / WS 流式） | 删除 `monitor.ts`、`ws-adapter.ts`；`legacyWecomCsEnabled` Phase 2 移除 |
| wecom-cs **Agent 模式**（自建应用 XML 回调） | 迁出至 `extensions/wecom`；删除 `handleAgentWebhook` |
| Bot/Agent 双分支 outbound | 薄化为 `outbound/kf-outbound.ts` 仅 KF |
| 客服账号 / 接待人员 **增删改** 管理 API | 不做；仅 list + trans |
| 95159 客户详情 **暴露给 LLM Tool** | 仅 ICS admin 或 dialogue state |
| 知识库 RAG / ICS REST **硬依赖** | 可选子系统；`ics.enabled=false` 可独立启动 |
| `wecom_kf_mcp` 替代 Control Tools | MCP 通用代理；客服 Agent allowlist 优先 `wecom_kf_*` |

### 1.3 Phase 1 已完成（基线）

| 交付 | 状态 | 代码锚点 |
|------|:----:|----------|
| KF-only onboarding 向导 | ✅ | `src/kf-onboarding.ts` → `channel.ts` |
| 动态 KF 路由（全局 + 账号 `webhookPath`） | ✅ | `src/config/kf-routes.ts` → `index.ts` |
| Legacy wecom-cs 默认关闭 | ✅ | `legacyWecomCsEnabled` 默认 `false`；`isLegacyWecomCsEnabled()` |
| KF 回调 + sync_msg + 文本 round-trip | ✅ | `callback.ts`、`agent/handler.ts` |
| 多账号 `open_kfid` 路由 + failClosed | ✅ | `config/accounts.ts`、`config/routing.ts` |
| control-tools 注册（redacted 路径） | ✅ | `kf/control-tools.ts` |

**Phase 1 回归命令：**

```bash
cd openclaw-plugins/extensions/wecom-kf
pnpm test
pnpm typecheck
grep -c 'legacyWecomCsEnabled' src/config/kf-routes.ts   # 期望 ≥1
grep 'collectWecomKfRoutePaths' index.ts                   # 期望命中
```

---

## 2. 目标 `src/` 目录树 vs 当前问题

### 2.1 目标结构（对齐 `wecom` 模块化）

参考 `extensions/wecom` 的 `webhook/`、`outbound/`、`config/` 分层；KF 无 XML/WS，更薄。

```
extensions/wecom-kf/src/
├── channel.ts                 # ChannelPlugin + onboarding 挂载
├── callback.ts                # KF HTTP：verify + kf_msg_or_event（薄层）
├── crypto.ts
├── runtime.ts
├── cursor-store.ts
│
├── config/                    # ✅ 已有；补 schema / event-messages
│   ├── accounts.ts
│   ├── kf-callback.ts
│   ├── kf-routes.ts           # ✅ Phase 1
│   ├── routing.ts             # ✅ Phase 1
│   ├── schema.ts
│   └── event-messages.ts
│
├── api/                       # 🆕 自 agent/api-client.ts 拆分
│   ├── token.ts
│   ├── sync.ts
│   ├── send.ts
│   ├── session.ts
│   └── admin.ts
│
├── dispatch/                  # 🆕 自 callback + agent/handler 拆出
│   ├── process-sync-batch.ts
│   ├── customer-message.ts    # origin=3 → message-sdk bridge
│   └── system-event.ts        # ← agent/system-event.ts 迁入
│
├── outbound/                  # 🆕 自 outbound.ts 薄化
│   ├── kf-outbound.ts
│   ├── chunker.ts
│   └── media.ts
│
├── dedup/kf-inbound-dedup.ts   # ✅
├── kf/                        # ✅ control-tools + 智能化
├── hooks/before-prompt-build.ts
├── onboarding → kf-onboarding.ts  # ✅ 已独立命名
├── probe.ts                   # 🆕 cherry-pick research
├── shared/command-auth.ts     # ✅
└── types/                     # KF-only config；移除 bot/agent 字段
```

### 2.2 当前 `wecom-kf` 主要问题

| 问题 | 现状路径 | 目标处置 | Phase |
|------|----------|----------|:-----:|
| **巨石 monitor** | `monitor.ts`（3000+ 行）、`gateway-monitor.ts` | 删除；KF 不注册 CS 路由 | 2 |
| **职责混杂 handler** | `agent/handler.ts`（客户消息 + Agent Webhook） | 拆至 `dispatch/customer-message.ts` | 2 |
| **API 客户端单体** | `agent/api-client.ts` | 拆至 `api/*.ts` | 2–3 |
| **outbound 双模式** | `outbound.ts` Bot/Agent 分支 | `outbound/kf-outbound.ts` KF-only | 2 |
| **Legacy Tools 泄漏 session** | `kf/tools.ts` 长文本 `content` | 删除或合并进 `control-tools.ts` | 2–3 |
| **ICS 与核心耦合** | `ics-handlers/*` 默认注册 | `ics.enabled` 开关；M3 外迁 | 3 |
| **目录扁平 / 命名漂移** | `agent/*` 承载 KF 逻辑 | 与 `wecom` 的 `webhook/`、`outbound/` 对齐 | 2 |
| **未接 message-sdk bridge** | handler 内联 runtime | `bridge/inbound-bridge` + `reply-bridge` | 2 |
| **research 能力缺失** | 无 `probe.ts`、账号 state 分散 | cherry-pick `probe.ts`、`state.ts` 模式 | 2–4 |

### 2.3 与 `wecom` 模块对照（借鉴边界）

| wecom 模块 | wecom-kf 对应 | 说明 |
|------------|---------------|------|
| `webhook/handler.ts` | `callback.ts` + `dispatch/*` | KF 无 Bot XML |
| `outbound/reply-deliver.ts` | `outbound/kf-outbound.ts` | 仅 `send_msg` |
| `accounts.ts` | `config/accounts.ts` | ✅ 已矩阵化 |
| `onboarding.ts` | `kf-onboarding.ts` | ✅ Phase 1 |
| `probe.ts` | `probe.ts`（待增） | 健康检查 |
| `monitor.ts` / `ws-*` | **无** | KF-only 删除 |

---

## 3. 分 Phase 任务表

> **当前阶段：Phase 3（会话状态与智能化）** — Ralph iteration 1 续跑中；Phase 2 部分交付并行，见各任务 **状态** 列。  
> **OMX 进度：** `.omx/state/wecom-kf/ralph-progress.json` · **上下文：** `.omx/context/wecom-kf-phase34-20260523T172046Z.md`  
> 列：**ID** | **状态** | **负责人模块** | **删除 / 新增** | **验收命令**

### Phase 0 — 边界收敛（已完成）

文档化 + 默认不注册 CS 路由（`legacyWecomCsEnabled=false`）。

### Phase 1 — KF 核心闭环（已完成）

见 §1.3。

---

### Phase 2 — 媒体与策略 + Legacy 移除

| ID | 状态 | 负责人模块 | 删除 / 新增文件 | 验收命令 |
|:--:|:----:|------------|-----------------|----------|
| **P2-01** | 实施中 | `config/` + `index.ts` | **删逻辑：** 移除 `legacyWecomCsEnabled` 分支及 CS 路由注册；**删：** 对 `monitor.js` 的 import（CS 路径） | `grep -r 'legacyWecomCsEnabled' extensions/wecom-kf/src extensions/wecom-kf/index.ts` → 0（或仅 deprecated 注释）；`grep 'handleWecomWebhookRequest' index.ts` → 0 |
| **P2-02** | 实施中 | `monitor/` 清理 | **删：** `src/monitor.ts`、`src/gateway-monitor.ts`、`src/ws-adapter.ts`；**迁：** 测试至 `legacy/` | `test ! -f src/monitor.ts`（当前仍存在）；`pnpm test` ≥120 passed |
| **P2-03** | 部分完成 | `dispatch/` | **增：** `dispatch.ts` + `webhook/callback.ts` 薄层；**待：** `dispatch/customer-message.ts`、`process-sync-batch.ts` | `pnpm test src/dispatch.test.ts src/webhook/callback.test.ts`；origin=3 文本 E2E（联调 Checklist §2） |
| **P2-04** | 实施中 | `bridge` + message-sdk | **改：** `dispatch.ts` 接入 `dispatchInbound`；outbound 接入 `createReplyHandler` | `grep 'dispatchInbound' src/` → 命中；`pnpm test` |
| **P2-05** | 部分完成 | `outbound/` | **增：** `outbound/kf-send.ts`；**待：** `outbound/kf-outbound.ts`、`chunker.ts`；薄化 `outbound.ts` | `pnpm test src/outbound.test.ts` |
| **P2-06** | 部分完成 | `ingress` + dm policy | **改：** `shared/command-auth.ts` + `dm-policy.ts`；账号 `dm.policy` / `allowFrom` | `pnpm test`；非白名单用户被拒（联调 Checklist §4） |
| **P2-07** | 实施中 | `media/` 入站 | **增/改：** 入站 `image`/`file` 经 `media/`；**可选：** `voice-transcode` | 联调 Checklist §3.4 |
| **P2-08** | 部分完成 | `outbound` MEDIA | **改：** `MEDIA:` 经 `media/` + KF 大小限制；`before_prompt_build` 已注入 MEDIA 说明 | 联调 Checklist §3.5 |
| **P2-09** | 部分完成 | `dispatch/system-event` | **已有：** `agent/system-event.ts`（`enter_session` 欢迎语）；**待：** 迁至 `dispatch/`、`msg_send_fail` → `lastError` | `pnpm test src/agent/system-event.test.ts` |
| **P2-10** | 实施中 | `api/` 拆分（第一批） | **待：** `api/sync.ts`、`api/send.ts`；当前仍在 `agent/api-client.ts` | `pnpm test src/agent/api-client*.test.ts`；`pnpm typecheck` |
| **P2-11** | 部分完成 | `types/` KF-only | **改：** `types/config.ts` bot/agent 标 `@deprecated`；KF 核心字段已矩阵化 | `pnpm test src/channel.config.test.ts` |
| **P2-12** | ✅ | `kf/tools.ts` 废弃 | **删注册：** legacy 5 个 Tool；仅 `control-tools.ts` 注册 | `grep 'wecom_kf_servicer_list' index.ts` → 0；`control-tools.test.ts` 绿 |
| **P2-13** | 实施中 | `probe` + 文档 | **增：** `src/probe.ts`；**改：** `kf-onboarding` `getStatus` 展示 cursor/lastError | `openclaw channels status wecom-kf` 可读 |

**Phase 2 出口标准（Exit）：**

```bash
cd openclaw-plugins/extensions/wecom-kf
pnpm test                    # ≥120 passed
pnpm typecheck
# 无 CS 路由
grep -E 'WEBHOOK_PATHS\.(BOT|AGENT)|handleWecomWebhookRequest' index.ts && exit 1 || true
# 核心文件数下降（不含 agents/ 模板）
find src -name '*.ts' ! -path '*/ics-*' | wc -l   # 目标较 Phase 1 减少 monitor 相关
```

---

### Phase 3 — 会话状态与智能化（**Ralph 2026-05-24 收尾**）

| ID | 状态 | 负责人模块 | 删除 / 新增 | 验收命令 |
|:--:|:----:|------------|-------------|----------|
| **P3-01** | ✅ | `kf/control-tools` | **已有：** transfer + `session-side-effect-store` + `transfer-policy` 自动选席 | 联调 Checklist §5；`pnpm test src/kf/control-tools.test.ts` |
| **P3-02** | ✅ | `dispatch/system-event` | **已有：** `session_status_change` → `session-service-state`；state=3/4 停 Agent 自动回复 | `pnpm test src/agent/system-event.test.ts` |
| **P3-03** | ✅ | 事件消息管线 | **已有：** welcome + `msg_code` → `event-message-dispatch` 排队/结束/满意度 | 联调 Checklist §5.4–5.5 |
| **P3-04** | ✅ | `intelligence/*` | **已有：** `before_prompt_build` 注入 `buildStateAwarePrompt`（`intelligence/hooks.ts` + `prompt-builder.ts`） | dialogue 单测绿；日志可见状态标签 |
| **P3-05** | ✅ | `api/admin` + cache | **已有：** `api/admin.ts` servicerCache + TTL；Control Tools 刷新 | `pnpm test src/config/accounts*.test.ts` |
| **P3-06** | ✅ | `ics/` 可选化 | **已有：** `channels.wecom-kf.icsEnabled`（默认 `false`）；`isIcsEnabled()` 控制 `/ics/*` 注册 | 无 ICS 时插件可启动；`pnpm test index.test.ts` |

**Phase 3 出口标准（Exit）：**

```bash
cd openclaw-plugins/extensions/wecom-kf
pnpm test && pnpm typecheck
# 转人工闭环
# 联调 Checklist §5 全部勾选
grep -E 'session_status_change|SideEffectStore|transfer-policy' src/  # 实施后应命中
# ICS 默认关闭仍可收发 KF 消息
grep 'icsEnabled' src/config/kf-routes.ts  # 期望命中
```

---

### Phase 4 — 生产 hardened

| ID | 状态 | 负责人模块 | 删除 / 新增 | 验收命令 |
|:--:|:----:|------------|-------------|----------|
| **P4-01** | ✅ | `dispatch/` | **已有：** origin=5 不 dispatch，仅审计日志 | 文档 + 联调 |
| **P4-02** | ✅ | `probe` + state | **已有：** `probe.ts` + webhook `lastSyncAt`/`lastError` | `openclaw channels status wecom-kf` |
| **P4-03** | Ralph 进行中 | `config/` | **改：** `apiBaseUrl` 私有化部署 | `resolveApiBaseUrl` 单测 |
| **P4-04** | Ralph 进行中 | `dispatch/process-sync-batch` | **改：** 并发 limit（默认 ≤8）+ 压测 | 压测脚本或集成测试 |
| **P4-05** | Ralph 进行中 | 清理 | **删：** 全部 monitor/ws 死代码、duplicate types | 包体积 / 文件数 ≥30%↓ |
| **P4-06** | Ralph 进行中 | `ics-handlers/stats` | **改：** audit 汇总 → US-017 | 可选 Prometheus |

---

## 4. message-sdk 采用清单（薄封装映射）

**原则：** wecom-kf 只做 KF 语义；管道能力 **薄封装** 调用 message-sdk，不复制实现。

### 4.1 已采用（保持）

| message-sdk 模块 | wecom-kf 薄封装位置 | 用途 |
|------------------|----------------------|------|
| `config/merge-account-config` | `config/accounts.ts` | 账号配置合并 |
| `dedup/claimable-dedupe` | `dedup/kf-inbound-dedup.ts` | msgid claim |
| `ingress/command-auth` | `shared/command-auth.ts` | dm 命令授权 |
| `routing/dynamic-peer-agent` | `dynamic-agent.ts` | 动态 Agent（默认关） |
| `text/strip-markdown` | `agent/markdown-strip.ts` | 出站 Markdown 降级 |
| `media/path-guard` | `media-path-guard.ts` | `MEDIA:` 本地路径 |
| `util/async-timeout` | `timeout.ts` | HTTP 超时 |
| `openclaw/state-dir` | `state-dir-resolve.ts` | cursor/dedup 目录 |

### 4.2 Phase 2 目标接入

| message-sdk 模块 | 替换/wecom-kf 挂载点 | 动作 |
|------------------|----------------------|------|
| **`bridge/inbound-bridge`** · `dispatchInbound` | `dispatch/customer-message.ts` | 替代 handler 内联 runtime |
| **`bridge/reply-bridge`** · `createReplyHandler` | `outbound/kf-outbound.ts` | 回复 deliver → `send_msg` |
| **`ingress/wire-ingress`** | `dispatch/customer-message.ts` | 构造 `InboundWireMessage` |
| **`ingress/dm-policy`** | `shared/command-auth.ts` + config | `dm.policy` / `allowFrom` |
| **`media/media-io`** | `dispatch/customer-message.ts` | 入站 image/file 下载 |
| **`media/parse-directives`** | `outbound/kf-outbound.ts` | 解析 `MEDIA:` |
| **`transcript/reply-dispatcher-factory`** | outbound 流式分块 | 与 blockStreaming 对齐 |
| **`http/safe-fetch`** | outbound 媒体 URL | 远程媒体下载 |
| **`dedup/persistent-dedupe`** | `dedup/` + `cursor-store.ts` | 与 msgid dedup 同 backend |

### 4.3 明确不采用

| 模块 | 原因 |
|------|------|
| `dispatch/subagent-dispatch` | KF 无 subagent 特殊路径 |
| `asr/*`、`tts/*`、`ocr/*` | 经 Agent skills 或 Phase 插件；非 SDK 硬依赖 |
| KF 管理 API 封装 | 留在 `wecom-kf/api/admin.ts` + Control Tools |

### 4.4 入站 Wire 字段约定（薄封装契约）

```typescript
// dispatch/customer-message.ts 构造示意
{
  channel: "wecom-kf",
  surface: "wecom-kf",
  accountId: openKfId,           // 或 accountKey — 与 bindings 一致
  peer: { kind: "dm", id: external_userid },
  // metadata: msgid, origin, open_kfid — 供 dedup / 路由
}
```

---

## 5. Research 版 cherry-pick 对照

来源：`research/openclaw-china/extensions/wecom-kf/`（~24 文件 MVP）

| Research 文件 | 职责 | Plugins 目标位置 | 状态 | 备注 |
|---------------|------|------------------|:----:|------|
| `webhook.ts` | 验签、sync 循环、target 注册 | `callback.ts` + `config/kf-routes.ts` | ✅/🔄 | 路由收集已完成；sync 仍在 callback |
| `dispatch.ts` | origin 矩阵、dmPolicy | `dispatch/customer-message.ts` + `dispatch/system-event.ts` | 🔄 P2-03 | 实现改用 message-sdk bridge |
| `api.ts` | token、sync_msg、send、分片 | `api/sync.ts`、`api/send.ts`、`api/token.ts` | 🔄 P2-10 | 从 `agent/api-client.ts` 拆 |
| `send.ts` | 高层 send DM | `outbound/kf-outbound.ts` | 🔄 P2-05 | |
| `state.ts` | cursor、msg 去重、账号 state | `cursor-store.ts` + `dedup/` + **增** `config/account-state.ts` | 🔄 P2-13 | lastError / lastSyncAt |
| `onboarding.ts` | 分步向导 | `kf-onboarding.ts` | ✅ | Phase 1 |
| `probe.ts` | 健康检查 | **增** `probe.ts` | ⏳ P2-13 | |
| `config.ts` | 配置解析、apiBaseUrl | `config/*`、`kf-routes.ts` | ✅/🔄 | apiBaseUrl 已有 `resolveApiBaseUrl` |
| `crypto.ts` | 加解密 | `crypto.ts` | ✅ | |
| `channel.ts` | Channel 定义 | `channel.ts` | ✅ | 文案改 KF-only |
| `runtime.ts` | Runtime 持有 | `runtime.ts` | ✅ | |
| `bot.ts` | 文本提取 | **增** `dispatch/extract-inbound-text.ts` | ⏳ P2 | 仅工具函数 |
| `index.ts` · `collectWecomKfRoutePaths` | 动态路由 | `config/kf-routes.ts` + `index.ts` | ✅ | Phase 1 |

**不 cherry-pick：**

- research 单账号 `DEFAULT_ACCOUNT_ID` 硬编码 → plugins 用 matrix + `resolveKfAccountByOpenKfId`
- research 无 message-sdk → plugins 以 bridge 为准，不照搬 `dispatchKfMessage` 内联 Agent 调用

**Research webhook → 新结构映射（运行时）：**

```
registerWecomKfWebhookTarget (research)
  → collectWecomKfRoutePaths + api.registerHttpRoute (plugins)

primeWecomKfCursor (research webhook)
  → callback.ts 冷启动 / corpSecret 配置时 prime

processSyncBatch (research webhook 内循环)
  → dispatch/process-sync-batch.ts

dispatchKfMessage (research)
  → dispatch/customer-message.ts + message-sdk dispatchInbound
```

---

## 6. M1–M4 与 US-001～017 对照

| 里程碑 | 周期（PRD） | 覆盖 User Stories | 路线图 Phase | 关键 Exit |
|--------|-------------|-------------------|:------------:|-----------|
| **M1** KF 核心 + 剥离 | W1–2 | US-001, 002, 003, 004, 005, 008, 011（部分） | Phase 0–1 ✅ | 真实 KF 收发文字；transcript 无 raw JSON；≥120 tests |
| **M2** 事件 + 转人工 | W3 | US-006, 007, 009, 014, 015, 016 | Phase 2–3 前半 | 30min 联调通过；欢迎语 + 转人工 |
| **M3** 清理 + Legacy | W4 | US-008, 010, 012, 013, 009（cache） | Phase 2 后半–3 | ~40 核心文件；无 duplicate Tool |
| **M4** 观测 + 文档 | W5 | US-017, 008（TOOLS.md） | Phase 4 | 转人工成功率可查询；文档与实现一致 |

### 6.1 User Story → 里程碑 → Phase 任务 速查

| US | 标题 | M | Phase 任务 ID |
|:--:|------|:-:|---------------|
| US-001 | KF 回调验签解密 | M1 | ✅ P1 · `callback.test.ts` |
| US-002 | sync_msg + cursor | M1 | ✅ P1 · `callback.ts` + `cursor-store.ts` |
| US-003 | 客户消息 → Agent 回复 | M1 | ✅ P1 · P2-03/04 深化 bridge |
| US-004 | 多 open_kfid → Agent | M1 | ✅ P1 · `accounts.ts` |
| US-005 | per-account-channel-peer | M1 | ✅ P1 · session / dialogue |
| US-006 | 进入会话欢迎语 | M2 | P2-09 · P3-03 |
| US-007 | 结束语与满意度 | M2 | P3-03 |
| US-008 | Control Tools 不进 session | M1/M3 | ✅ P1 control-tools · P2-12 hook |
| US-009 | 转人工 | M2/M3 | P3-01 |
| US-010 | 会话状态 Tool（可选） | M3 | P3-01 |
| US-011 | 移除 wecom-cs / monitor | M1 | P2-01 · P2-02 |
| US-012 | ICS 外迁/可选 | M3 | P3-06 |
| US-013 | agents 模板清理 | M3 | P3（文档） |
| US-014 | KF-only 配置向导 | M2 | ✅ P1 · `kf-onboarding.ts` |
| US-015 | preflight skill | M2 | P2-13 · `skills/wecom-kf-preflight` |
| US-016 | 联调 Checklist 文档 | M2 | §7 · PRD §8 |
| US-017 | 转人工与消息指标 | M4 | P4-06 |

---

## 7. 联调入口（Integration Checklist）

### 7.1 文档与 Skill 入口

| 资源 | 路径 | 用途 |
|------|------|------|
| **联调 Checklist（权威）** | [Integration-Checklist.md](./Integration-Checklist.md) | 回调、sync、多账号、媒体、Control Tools、icsEnabled 可勾选清单 |
| **PRD 联调附件** | [PRD §8 联调 Checklist](../../../.omx/plans/prd-wecom-kf-intelligent-cs.md#8-联调-checklist验收附件) | 企微后台 + Gateway + 功能 + 多账号 + 回归 |
| **架构验收附件** | [主架构 §5 事件矩阵](./OpenClaw-WeCom-KF-Master-Architecture.md#5-事件类型处理矩阵) | origin / event_type 行为 |
| **Tools 验收** | [Tools 架构 §6](./OpenClaw-WeCom-KF-Tools-Architecture.md#6-实现阶段划分) | transcript 无 PII |
| **Preflight Skill** | `extensions/wecom-kf/skills/wecom-kf-preflight/SKILL.md` | 配置项检查（待与 US-015 对齐 executable checklist） |
| **插件 README** | `extensions/wecom-kf/README.md` / `README.zh-CN.md` | 安装与配置概览 |

### 7.2 联调前一键命令

```bash
# 1. 单元测试回归
cd openclaw-plugins/extensions/wecom-kf && pnpm test

# 2. 类型检查
pnpm typecheck

# 3. 构建（Gateway 加载 dist）
pnpm build

# 4. 渠道状态（需 Gateway 运行 + 配置 openclaw.json）
openclaw channels status wecom-kf

# 5. 确认仅 KF 路由（Phase 2 后）
curl -s -o /dev/null -w "%{http_code}" "https://{host}/wecom-kf?echostr=test"
# 期望：200 或企微验签流程；/wecom-cs 应 404
```

### 7.3 联调 Checklist 摘要（详细见 [Integration-Checklist.md](./Integration-Checklist.md)）

**企微管理后台**

- [ ] 客服账号 → **通过 API 管理**
- [ ] 应用已授权；接待人员在可见范围
- [ ] 回调 URL = Gateway `webhookPath`（默认 `/wecom-kf` 或 `/wecom/kefu`）
- [ ] Token / EncodingAESKey / corpId / open_kfid / corpSecret 与配置一致

**Gateway**

- [ ] `@partme.ai/wecom-kf` 已加载
- [ ] `openclaw channels status wecom-kf` → configured
- [ ] GET URL 验证成功；cursor 已 prime
- [ ] bindings：`accountId` = `open_kfid` → 正确 `agentId`

**功能（Phase 2–3）**

- [ ] 文字 round-trip（§2）
- [ ] sync_msg + cursor 持久化（§2.3）
- [ ] 图片 / 文件入站；`MEDIA:` 出站（§3）
- [ ] 欢迎语（origin=4 · `enter_session`）（§5.4）
- [ ] Control Tools：`wecom_kf_transfer_session` → state=3（§5 · **Phase 3 实施中**）
- [ ] `session_status_change` state=3 后 Agent 停答（§5.3 · **Phase 3 实施中**）
- [ ] 多 `open_kfid` 路由 + bindings（§4）
- [ ] `icsEnabled=false` 时 KF 核心仍可用（§6）
- [ ] Agent transcript **无** servicer JSON / 完整 URL（§5.6）

**回归**

- [ ] `pnpm test` ≥120 passed
- [ ] 无 `/wecom-cs` 有效路由（`legacyWecomCsEnabled` 未启用）

---

## 8. 相关路径索引

| 路径 | 说明 |
|------|------|
| `openclaw-plugins/extensions/wecom-kf/` | 本插件实现 |
| `openclaw-plugins/extensions/wecom/` | 模块化参考（Bot/Agent） |
| `openclaw-plugins/extensions/message-sdk/` | 共用 ingress/reply/dedup |
| `openclaw-plugins/doc/wecom-kf/` | 架构 + 路线图 + [联调 Checklist](./Integration-Checklist.md) |
| `research/openclaw-china/extensions/wecom-kf/` | MVP cherry-pick 源 |
| `.omx/plans/prd-wecom-kf-intelligent-cs.md` | PRD / US / 联调清单 |

---

*路线图结束 — 当前执行 **Phase 3（P3-01～P3-06，Ralph iteration 1）**；P3-04/P3-06 已 ✅；Phase 4 待 Phase 3 Exit。Phase 1 基线勿回退。联调见 [Integration-Checklist.md](./Integration-Checklist.md)。*
