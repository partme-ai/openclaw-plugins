# OpenClaw 渠道插件标准测试套件

> **版本** 1.0.0 · **状态** 规范草案 · **适用范围** `openclaw-plugins/extensions/*` 全部 Channel Plugin

本目录提供 **渠道无关（channel-agnostic）** 的标准测试数据集与测试计划，供 Gotify、Feishu、MQTT、WeCom、Redis Stream 等插件在开发、CI 与发布前复用。  
**不包含** 跨插件 `_shared/` 运行时代码；各插件通过 **ChannelAdapter** 注入发送/接收逻辑，引用同一份 `test-dataset.yaml`。

---

## English Summary

This directory is the **canonical reference** for OpenClaw channel plugin testing:

| Artifact | Purpose |
|----------|---------|
| `STANDARD-TEST-SUITE.md` | Master test plan (this file) — tiers, procedures, pass/fail criteria |
| `test-dataset.yaml` | **37** structured test cases (L0–L20 + L1-RT + extensions) with placeholders |
| `README.md` | Adoption guide for plugin authors |
| `scripts/run-standard-tests.ts` | Optional runner skeleton — implement `ChannelAdapter` per channel |
| `fixtures/` | Multimodal sample assets (placeholders; add real files locally) |

**Design principles:** progressive complexity (connectivity → text → markdown → code → skills → multimodal → routing/security/reliability/SLA), explicit skip conditions per channel capabilities, automation level tagged per case.

**Gotify first adoption:** wrap existing `functional-test.ts` (L0 API) + `e2e-agent-test.ts` (L1) with the standard runner; map Gotify REST send + message poll to `ChannelAdapter.send` / `waitForReply`.

---

## 1. 目标与范围

### 1.1 为什么需要标准套件

当前各插件测试风格分散：

| 插件 | 现有模式 | 缺口 |
|------|----------|------|
| **gotify** | `functional-test.ts`（API CRUD）、`e2e-agent-test.ts`（单条 Agent 往返） | 无统一 tier、无能力矩阵 skip |
| **mqtt** | Vitest E2E（broker + ACL + topic 路由） | Agent 层用例少 |
| **redis-stream** | `integration-test.ts` + mock runtime | 未覆盖多模态/安全 |
| **feishu**（research） | 大量单元/生命周期测试、`probe.test.ts` | 缺跨插件可比对 E2E 数据集 |

本套件 **不替代** 插件专属单元测试（mapper、config、ACL），而是补齐 **「用户消息 → 渠道 → OpenClaw Agent → 渠道回复」** 的可重复验收标准。

### 1.2 适用 / 不适用

**适用：**

- `@partme.ai/openclaw-*` Channel Plugin（`defineChannelPluginEntry` + `ChannelPlugin`）
- 本地开发冒烟、发布前回归、文档化 SLA

**不适用：**

- 纯基础设施插件（router、memory、tracing）
- 不经过 Agent 的纯 API 封装（可只跑 L0）

### 1.3 与 OpenClaw 运行时的关系

```
用户/测试脚本
    │  send({CHANNEL})
    ▼
渠道插件 inbound（WS/Webhook/Poll/Subscribe）
    │  dedup · dmPolicy · route · sessionKey
    ▼
OpenClaw Agent（main / 绑定 agent）
    │  model · skills · tools · multimodal
    ▼
渠道插件 outbound
    │  ChannelAdapter.waitForReply()
    ▼
测试断言（test-dataset expected）
```

### 1.4 发送-等待-回复（L1-RT）

L1-01 等用例已隐含「发消息后等回复」；**L1-RT** 层将流程显式化，便于各渠道 adapter 对齐指标：

| 阶段 | Runner 日志 | 输出字段 |
|------|-------------|----------|
| send | `[send] messageId=… sent_at=…` | `sent_at` |
| wait | `[wait] timeout=… polls=…` | `wait_duration_ms`, `poll_count` |
| assert | `[assert] reply ok` / 超时 | `reply_at`, `latency_ms` |

数据集字段：`wait_for_reply`、`reply_timeout_ms`、`reply_assertions`、`expect_wait_timeout`（L1-RT-03）、`wait_metrics`。

---

## 2. 目录结构

```
openclaw-plugins/testing/
├── README.md                 # 插件接入指南
├── STANDARD-TEST-SUITE.md    # 本文件 — 主测试计划
├── test-dataset.yaml         # 37 条标准用例（含 L1-RT）
├── fixtures/                 # 多模态样例（见 fixtures/README.md）
│   └── README.md
└── scripts/
    └── run-standard-tests.ts # 可选 runner 骨架
```

---

## 3. 测试分层（Tier）

| Tier | 名称 | 用例 ID | 自动化建议 | 说明 |
|------|------|---------|------------|------|
| **L0** | 连通性 | L0-01 ~ L0-03 | auto | health、doctor、WS/push 状态 |
| **L1** | 纯文本 | L1-01 ~ L1-02 | auto | ping-pong、通道确认 |
| **L1-RT** | 发送-等待-回复 | L1-RT-01 ~ L1-RT-03 | auto | 显式 wait/poll、SLA、超时负向 |
| **L2** | 文本边界 | L2-01 ~ L2-04 | auto | Unicode、长文本、空白 |
| **L3** | Markdown | L3-01 ~ L3-02, X-02 | semi | 富文本、流式（可选） |
| **L4** | 编程 | L4-01 ~ L4-02 | semi | 代码块、解释型问答 |
| **L5** | 控制命令 | L5-01 ~ L5-02 | semi/auto | 斜杠命令、JSON 指令 |
| **L6** | Skill/Tool | L6-01 ~ L6-02 | semi/manual | 需配置 Agent tools |
| **L7** | 图片/文件 | L7-01 ~ L7-02, X-01 | semi | URL / fixture 附件 |
| **L8** | 音频 | L8-01 ~ L8-02 | semi/manual | ASR / TTS |
| **L9** | 视频 | L9-01 | manual | 大 payload、可选 |
| **L10** | 多轮上下文 | L10-01 ~ L10-02 | auto/semi | session 记忆 |
| **L11** | 会话路由 | L11-01 ~ L11-02 | semi/manual | peer / 多账号 agent |
| **L12** | DM 策略 | L12-01 ~ L12-02 | semi | allowFrom / allowlist |
| **L13** | 回环预防 | L13-01 | auto | 出站 echo 过滤 |
| **L14** | 幂等去重 | L14-01 | semi | 同 messageId |
| **L15** | 限流 | L15-01 | semi | burst 不崩溃 |
| **L16** | 重连 | L16-01 | manual | 断网恢复 |
| **L17** | 并发 | L17-01 | semi | 并行入站 |
| **L18** | 消费删除 | L18-01 | semi | deleteAfterConsume |
| **L19** | 会话标签 | L19-01 | manual | display name |
| **L20** | SLA | L20-01 | auto | p95 延迟采样（与 L1-RT `wait_metrics` 对齐） |

**优先级：** P0 发布阻断 · P1 强烈建议 · P2 推荐 · P3 可选

---

## 4. 能力矩阵（Capability Matrix）

每个插件在 `testing/capabilities.{CHANNEL}.yaml`（可选）或 README 中声明支持的 `capability_flags`（见 `test-dataset.yaml`）。

Runner 规则：

1. 用例含 `required_capabilities` → **全部满足** 才执行  
2. 含 `skip_if_missing_capabilities` → 缺一则 **skip**（记为 SKIPPED，不算 FAIL）  
3. `optional_capabilities` 不满足时仍执行，但 `expected` 中带 `optional: true` 的断言可忽略

### 4.1 参考：Gotify 能力声明示例

```yaml
channel: gotify
capabilities:
  supports_text: true
  supports_markdown: true          # extras client::display contentType
  supports_code_blocks: true
  supports_image_inbound: false    # media: false
  supports_image_outbound: false
  supports_audio_inbound: false
  supports_video_inbound: false
  supports_ws_or_push: true
  supports_health_endpoint: true
  supports_dm_policy: true
  supports_multi_account: true
  supports_delete_after_consume: false
  supports_skill_tools: true       # 取决于 Agent 配置
  supports_streaming: false        # blockStreaming: true
```

### 4.2 参考：Feishu / MQTT 差异（示意）

| 能力 | Gotify | Feishu | MQTT |
|------|--------|--------|------|
| 图片入站 | ✗ | ✓ | △（看 payload） |
| 原生命令 | ✗ | △ | ✗ |
| WS/推送 | ✓ stream | ✓ webhook/ws | ✓ broker |
| 多 peer | appid/title | open_id/chat_id | topic |

---

## 5. 占位符与环境变量

| 占位符 | 含义 | 示例 |
|--------|------|------|
| `{CHANNEL}` | 渠道 ID | `gotify` |
| `{ACCOUNT_ID}` | 账号 | `default` / `ops` |
| `{PEER_ID}` | 对端 | `42` / `ou_xxx` / `main:in` |
| `{AGENT_ID}` | 期望 Agent | `main` |
| `{CORRELATION_ID}` | 运行 UUID | `a1b2c3d4` |
| `{SENDER_ID}` | 发送方 | appid / user id |

**推荐环境变量（runner 级）：**

```bash
OPENCLAW_TEST_CHANNEL=gotify
OPENCLAW_TEST_ACCOUNT_ID=default
OPENCLAW_TEST_PEER_ID=gotify
OPENCLAW_TEST_AGENT_ID=main
OPENCLAW_TEST_DATASET=../../testing/test-dataset.yaml
OPENCLAW_TEST_TIERS=L0,L1,L2          # 可选过滤
OPENCLAW_TEST_IDS=L1-01,L13-01        # 可选指定用例
```

---

## 6. 用例规范（每条必须包含）

数据集已编码；人工执行时按下列模板核对：

| 字段 | 说明 |
|------|------|
| **objective** | 验证什么行为 |
| **preconditions** | 配置、服务、Agent 前置 |
| **steps** | 可复现操作步骤 |
| **input** | 消息/附件/多轮结构 |
| **expected** | 机器可读断言 + 人工核对点 |
| **failure_signals** | 常见失败征象 |
| **automation** | `auto` / `semi` / `manual` |
| **timeout_ms** | 单用例超时 |

### 6.1 断言类型（expected 字段）

| 键 | 类型 | 说明 |
|----|------|------|
| `reply_received` | boolean | 是否收到出站回复 |
| `reply_text.min_length` | number | 最短字符 |
| `reply_text.contains_any` | string[] | 任一子串 |
| `reply_text.contains_all` | string[] | 全部子串 |
| `reply_text.matches_regex` | string | 正则 |
| `reply_latency_ms_max` | number | SLA |
| `agent_invoked` | boolean | 是否调用 Agent |
| `tool_invoked` | boolean | trace 中是否有 tool |
| `inbound_blocked` | boolean | dmPolicy 拒绝 |
| `echo_loop_count` | number | 回环次数 |
| `latency_p95_ms_max` | number | 基准测试 |

---

## 7. 详细测试计划（按 Tier）

### L0 — 连通性与探活

#### L0-01 健康检查

- **目的：** 确认上游与凭证有效。  
- **前置：** 渠道 enabled；Gotify/MQTT 等服务可达。  
- **步骤：** 调用 `healthCheck` / `GET /{channel}/health`。  
- **输入：** 无。  
- **通过：** `ok=true`，`latencyMs ≤ 3000`（可调）。  
- **失败：** 401、连接拒绝、超时。  
- **自动化：** auto  

#### L0-02 Doctor 诊断

- **目的：** 配置完整性一次看清。  
- **通过：** `errors.length === 0`。  
- **失败：** 缺 clientToken、serverUrl 等。  
- **自动化：** auto  

#### L0-03 实时入站连接

- **目的：** `startAccount` 后 listener running。  
- **通过：** snapshot `running=true`，`lastError=null`。  
- **失败：** WS 401、stream 路径错误。  
- **自动化：** semi（需 Gateway 进程）  

---

### L1 — 纯文本往返

#### L1-01 Ping-Pong

- **输入：** `请只回复一个字：好` + correlation_id。  
- **通过：** 30s 内收到回复，长度 1–500，含「好」或同义。  
- **失败：** 超时、空回复、重复回复。  
- **自动化：** auto（参考 gotify `e2e-agent-test.ts`）  

#### L1-02 通道确认

- **输入：** 含 `{CHANNEL}` 的确认句。  
- **通过：** 回复体现收到测试消息。  
- **自动化：** auto  

---

### L2 — 文本边界

| ID | 要点 | 通过标准 |
|----|------|----------|
| L2-01 | Emoji + CJK | 不乱码 |
| L2-02 | ~2KB 重复文本 | 有总结性回复 |
| L2-03 | 纯空白 | 不调用 Agent |
| L2-04 | 空字符串 | 插件层过滤 |

---

### L3 — Markdown

- **L3-01：** 要求 `##`、`**`、列表；Gotify 可断言 `client::display.contentType`。  
- **L3-02：** 表格 + 链接。  
- **X-02：** 流式分块（`supports_streaming`）。  

---

### L4 — 编程

- **L4-01：** fenced code block 完整闭合。  
- **L4-02：** 纯解释，无代码块。  

---

### L5 — 结构化命令

- **L5-01：** 仅当 `nativeCommands: true`。  
- **L5-02：** JSON 字段提取。  

---

### L6 — Skill / Tool

- **L6-01：** 必须 `tool_invoked`（查 Langfuse/trace/log）。  
- **前置：** Agent 配置 datetime 或 search 类 skill。  
- **L6-02：** 列 MCP 工具（manual）。  

---

### L7–L9 — 多模态

- 图片 URL（L7-01）不依赖本地 fixture，适合 Feishu/WeCom。  
- fixture 路径见 `fixtures/README.md`。  
- 渠道 `capabilities.media=false` 时 **skip** L7–L9。  

---

### L10 — 多轮上下文

- **L10-01：** 暗号记忆 — **P0**。  
- **配置：** 确认 `session.dmScope` 与测试预期一致。  

---

### L11 — 会话路由

- **L11-01：** 两 peer 暗号不可串。  
- **L11-02：** `agents.{id}.channels.{CHANNEL}.accounts` 绑定。  

---

### L12 — DM 策略

对齐 `resolveChannelMessageIngress` / `checkInboundAccess`：

- **allowlist + 不在列表 →** block（L12-01）  
- **allowlist + 在列表 →** 正常回复（L12-02）  

Gotify 参考：`inbound-access.test.ts`（open 策略需 `allowFrom: ['*']`）。

---

### L13 — 出站回环预防

- Gotify：`isOpenClawOutboundStreamMessage` + 自有 appId 过滤。  
- MQTT/Redis：订阅 exclude outbound topic。  
- **通过：** 单次用户消息仅 1 次 Agent invocation。  

---

### L14 — 幂等去重

- Gotify：`DEDUP_WINDOW_MS = 60_000`。  
- **通过：** 重复 3 次同 ID 仅 1 次 dispatch。  

---

### L15–L17 — 可靠性

- burst / 重连 / 并发 — 见 dataset，偏 semi-manual。  

---

### L18–L19 — 可选特性

- 消费后删除、session label — 按插件文档声明 skip 或执行。  

---

### L1-RT — 发送-等待-回复

| ID | 行为 | 通过标准 |
|----|------|----------|
| L1-RT-01 | send → wait → assert 内容 | `reply_assertions.contains_any` 命中 |
| L1-RT-02 | 30s 内收到回复 | `latency_ms ≤ reply_latency_ms_max` |
| L1-RT-03 | 800ms 故意超时 | FAIL 且 message 含「等待回复超时」 |

Runner：`executeSendWaitReply()` 三阶段；超时文案 `等待回复超时 (waited Xms, polls=N)`。

Gotify 薄 E2E：`extensions/gotify/scripts/wait-reply-test.ts`。

---

### L20 — E2E SLA

- 5 次采样 ping（每轮 send→wait→reply），`success_rate ≥ 80%`，`p95 ≤ 45s`；与 L1-RT `wait_metrics` 一致记录 `latency_ms`。  

---

## 7.1 Control UI 可见性（Gotify / 渠道隔离会话）

标准 E2E **会写入 OpenClaw 会话存储**，但 **不会** 出现在 Control UI 默认的 `main` 聊天：

| 现象 | 原因 |
|------|------|
| UI 默认 `main` 无新消息 | 测试路由到 `agent:<agentId>:<channel>:direct:<peerId>`（Gotify 常为 `agent:main:gotify:direct:4`） |
| Gotify App 也看不到 | 入站默认 **消费即删**（`deleteAfterConsume: true`） |

**查看测试对话：** Control UI → **Sessions** → 选 `gotify: e2e-user` 或对应 sessionKey。  
**保留 Gotify 消息：** `OPENCLAW_TEST_VISIBLE=1` 或 `channels.gotify.inbound.deleteAfterConsume: false`。  
详见 [testing/README.md](./README.md)「为什么在 Control UI 里看不到测试对话？」

---

## 8. 执行策略

### 8.1 冒烟（每次 PR）

```
L0-01, L0-02, L1-01, L1-RT-01, L13-01
```

### 8.2 发布前（文本渠道如 Gotify）

```
L0–L5, L10-01, L12-02, L13-01, L14-01, L20-01
```

### 8.3 全量多模态渠道（Feishu / WeCom）

```
L0–L20 + X-01（跳过仍缺失能力的用例）
```

### 8.4 自动化级别

| 级别 | 含义 | CI 建议 |
|------|------|---------|
| **auto** | 无需人工 | 必须进 CI |
| **semi** | 需真实服务/Gateway | nightly 或 merge 前 manual |
| **manual** | 断网、视频、MCP 列工具 | 发布 checklist |

---

## 9. ChannelAdapter 接口（runner 约定）

插件实现以下适配器（见 `scripts/run-standard-tests.ts`）：

```typescript
interface ChannelAdapter {
  /** 渠道 ID，如 gotify */
  channelId: string;
  /** 声明能力，用于 skip */
  capabilities: Record<string, boolean>;
  /** 发送一条入站（或模拟用户消息） */
  send(input: StandardTestInput, ctx: TestContext): Promise<SendResult>;
  /** 等待回复；可轮询或订阅；宜返回 latencyMs / pollCount */
  waitForReply(ctx: TestContext, opts: WaitOptions): Promise<ReplyResult | null>;
  /** 可选：负向用例确认无回复 */
  waitForNoReply?(ctx: TestContext, opts: WaitOptions): Promise<{
    pollCount: number;
    waitDurationMs: number;
    unexpectedReply?: ReplyResult;
  }>;
  /** L0：health */
  healthCheck?(): Promise<{ ok: boolean; latencyMs: number }>;
  /** L0：doctor */
  runDoctor?(): Promise<{ ok: boolean; errors: string[] }>;
  /** 可选：清理测试消息 */
  cleanup?(messageIds: string[]): Promise<void>;
}
```

**不得** 在 `testing/` 内 import 各插件 src；适配器写在 `extensions/{channel}/scripts/standard-test-adapter.ts`。

---

## 10. 结果报告

Runner 输出 JUnit 或 Markdown 摘要：

```
OpenClaw Standard Channel Tests — gotify
──────────────────────────────────────
PASS  L0-01  health probe          42ms
PASS  L1-01  ping-pong            8234ms
SKIP  L7-01  image URL            (supports_image_inbound=false)
FAIL  L10-01 context memory       expected ALPHA-xxx
──────────────────────────────────────
Total: 28  Pass: 25  Fail: 1  Skip: 2
```

CI 规则建议：**P0 用例失败即阻断合并**。

---

## 11. 与现有测试的关系

| 层级 | 位置 | 职责 |
|------|------|------|
| 单元测试 | `src/**/*.test.ts` | mapper、config、ACL、纯函数 |
| 功能测试 | `scripts/functional-test.ts` | 渠道 API（Gotify CRUD） |
| 集成测试 | `scripts/integration-test.ts` | mock runtime 管道 |
| **标准套件** | `testing/test-dataset.yaml` | 跨插件可比的 Agent E2E 规范 |

**推荐：** 保留原有 functional-test；新增 `standard-test-adapter` 调用共享 runner。

---

## 12. 版本与变更

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-05-21 | 初始 32 用例、runner 骨架、Gotify 接入说明 |
| 1.1.0 | 2026-05-21 | L1-RT 发送-等待-回复层、wait_metrics、wait-reply-test.ts |

新增用例时：

1. 在 `test-dataset.yaml` 增加条目（ID 不可复用）  
2. 更新本文件 Tier 表  
3. 在插件 `capabilities.*.yaml` 中标记相关 flag  

---

## 13. 参考资料

- OpenClaw Plugin SDK：`defineChannelPluginEntry`、`ChannelPlugin.capabilities`  
- Gotify 插件：`extensions/gotify/scripts/functional-test.ts`、`e2e-agent-test.ts`  
- Gotify 入站：`dispatchInboundMessage`（dedup、echo、dmPolicy）  
- Feishu 探活：`research/openclaw/extensions/feishu/src/probe.test.ts`  
- MQTT E2E：`extensions/mqtt/test/e2e.test.ts`  

---

**维护者：** PartMe.AI openclaw-plugins 团队  
**反馈：** 在 monorepo 提 Issue 或 PR 标注 `testing/standard-suite`
