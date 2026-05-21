# OpenClaw 标准渠道测试套件 — 接入指南

本目录为 **文档 + 数据集 + 可选 runner 模板**，不是可 import 的插件共享库。各渠道在自身 `extensions/{channel}/scripts/` 下实现 **ChannelAdapter**，再调用 `run-standard-tests.ts`。

## 为什么在 Control UI 里看不到测试对话？

标准测试（含 Gotify `pnpm test:standard`）**会真实调用 Agent**，但对话写在 **渠道隔离的 sessionKey** 里，不会出现在默认的 **`main`** 会话。

| 你正在看 | 测试实际写入 |
|----------|----------------|
| Control UI 默认下拉 **main** / `agent:main:main` | `agent:main:gotify:direct:<peerId>`（如 `…:direct:4`） |
| Gotify 手机 App 消息列表 | 入站/出站回复消费后常被插件 **DELETE**（默认 `deleteAfterConsume: true`） |

**正确查看方式（Gotify）：**

1. 打开 Control UI：`http://127.0.0.1:18789`（或你的 `OPENCLAW_GATEWAY_URL`）
2. 左侧 **Sessions** → 选择 **`gotify: e2e-user`** 或 sessionKey **`agent:main:gotify:direct:4`**（`4` 为 e2e-user 的 appid，可用 `GOTIFY_TEST_PEER_ID` 覆盖）
3. 不要停留在顶部的默认 **main** 聊天

**让测试更易对照：**

```bash
# runner 跳过额外 cleanup（不 DELETE 轮询到的消息）；插件仍默认消费即删
OPENCLAW_TEST_VISIBLE=1 pnpm test:standard
```

或在 OpenClaw 配置中：

```json
"channels": {
  "gotify": {
    "inbound": { "deleteAfterConsume": false }
  }
}
```

运行 `pnpm test:standard` 时，每条 **L1+** 且触发 Agent 的用例 **PASS** 后，终端会打印上述 sessionKey 与 UI 链接提示。

## 发送 → 等待 → 回复（L1-RT 层）

除「仅发送」外，标准 runner 对 `wait_for_reply: true` 的用例执行三阶段：

1. **[send]** — `adapter.send()`，记录 `messageId` / `sent_at`
2. **[wait]** — `adapter.waitForReply()`，在 `reply_timeout_ms` 内轮询；日志含 `poll_count`、`wait_duration_ms`
3. **[assert]** — `reply_assertions`（`contains_any` / `min_length` / `not_contains`）+ `reply_latency_ms_max`

| 用例 ID | 说明 |
|---------|------|
| **L1-RT-01** | 发送后等待回复，断言内容含期望片段 |
| **L1-RT-02** | 30s SLA 内必须收到回复，记录 `latency_ms` |
| **L1-RT-03** | 极短超时（800ms）负向：runner 必须以「等待回复超时」FAIL |
| **L20-01** | 5 次采样 ping，与 `wait_metrics` 对齐统计 p95 |

**仅跑回复等待层：**

```bash
cd extensions/gotify
OPENCLAW_TEST_IDS=L1-RT-01,L1-RT-02,L1-RT-03 pnpm test:standard
```

**薄 E2E（单条 send→wait→打印）：**

```bash
GOTIFY_APP_TOKEN=... GOTIFY_CLIENT_TOKEN=... \
  npx tsx scripts/wait-reply-test.ts
```

超时失败示例：`等待回复超时 (waited 30124ms, polls=120)`

## 快速开始（Gotify 参考实现 — 已完成）

```bash
# 1. 进入插件目录
cd openclaw-plugins/extensions/gotify

# 2. 构建并安装依赖
pnpm install && pnpm build

# 3. 确保 Gotify (8080) + OpenClaw Gateway (18789) 已启动

# 4. 运行标准套件（L0–L3 冒烟）
GOTIFY_SERVER_URL=http://localhost:8080 \
GOTIFY_APP_TOKEN=AK-MvdcbyFOfBmQ \
GOTIFY_CLIENT_TOKEN=C7ErQjzzeoAXCKg \
OPENCLAW_TEST_TIERS=L0,L1,L2,L3 \
pnpm test:standard
```

### Gotify 参考文件

| 文件 | 说明 |
|------|------|
| `extensions/gotify/scripts/standard-test-adapter.ts` | `ChannelAdapter` 实现（send / waitForReply / health / doctor / account status） |
| `extensions/gotify/scripts/run-gotify-standard-tests.ts` | 薄包装，读取 `OPENCLAW_TEST_TIERS` |
| `extensions/gotify/scripts/wait-reply-test.ts` | 单条 send→wait→print 薄 E2E |
| `testing/capabilities.gotify.yaml` | 能力矩阵 → skip 逻辑 |
| `extensions/gotify/package.json` → `test:standard` | npm 脚本入口 |

**Adapter 要点：**

1. **send：** e2e-user `GOTIFY_APP_TOKEN` → `POST /message`（模拟用户入站）
2. **waitForReply：** `GOTIFY_CLIENT_TOKEN` → 轮询 `GET /message`，跳过发送前快照中的旧消息；返回 `latencyMs` / `pollCount`
3. **waitForNoReply：** 负向用例，在短窗口内确认无意外回复
4. **healthCheck / runDoctor：** 复用 `gotify-api.ts`
5. **getAccountStatus：** Gateway `GET /gotify/status` → `runtime.running`
6. **skip：** `capabilities.gotify.yaml` 中 `supports_image_inbound: false` 等 → L7–L9 自动 SKIP

## 快速开始（其他插件）

## 文件说明

| 文件 | 用途 |
|------|------|
| [STANDARD-TEST-SUITE.md](./STANDARD-TEST-SUITE.md) | 主测试计划（Tier、步骤、通过标准） |
| [test-dataset.yaml](./test-dataset.yaml) | **37** 条结构化用例（含 L1-RT 发送-等待-回复） |
| [scripts/run-standard-tests.ts](./scripts/run-standard-tests.ts) | 通用 runner（解析 YAML、调度、断言） |
| [fixtures/](./fixtures/) | 多模态测试资源 |

## 插件接入清单

- [ ] 在 README 增加 **Testing** 小节，链接本目录
- [ ] 新增 `capabilities.{channel}.yaml`（或写在 README 表格）
- [ ] 实现 `ChannelAdapter`（send / waitForReply / 可选 health）
- [ ] 新增 `scripts/run-{channel}-standard-tests.ts`（薄包装，~30 行）
- [ ] 声明 CI 跑哪些 Tier（至少 L0 + L1 + L13）
- [ ] P0 失败阻断 release

## ChannelAdapter 最小实现

```typescript
import {
  runStandardTests,
  type ChannelAdapter,
} from '../../../testing/scripts/run-standard-tests.js';

export const gotifyAdapter: ChannelAdapter = {
  channelId: 'gotify',
  capabilities: {
    supports_text: true,
    supports_markdown: true,
    supports_image_inbound: false,
    supports_ws_or_push: true,
    supports_health_endpoint: true,
    supports_dm_policy: true,
    supports_multi_account: true,
    supports_skill_tools: true,
  },
  async send(input, ctx) {
    // POST /message 或 WS 注入
    return { messageId: '...', sentAt: Date.now() };
  },
  async waitForReply(ctx, opts) {
    // 轮询 GET /message 或 WS 捕获
    return { text: '...', receivedAt: Date.now(), messageId: '...' };
  },
  async healthCheck() {
    // 调用 gotify-api healthCheck
    return { ok: true, latencyMs: 12 };
  },
};

runStandardTests(gotifyAdapter, {
  tiers: process.env.OPENCLAW_TEST_TIERS?.split(','),
  ids: process.env.OPENCLAW_TEST_IDS?.split(','),
});
```

## Gotify 优先接入 ✅

Gotify 为 **参考实现**（`standard-test-adapter.ts` + `pnpm test:standard`）。映射关系：

| 标准 Tier | 现有脚本 | 动作 |
|-----------|----------|------|
| L0-01, L0-02 | `functional-test.ts` → Health / Doctor | 复用 `healthCheck`、`runGotifyDoctor` |
| L0-03 | Gateway `startAccount` + WS | semi：需运行 openclaw gateway |
| L1-01, L1-02 | `e2e-agent-test.ts` | 改为读取 `test-dataset.yaml` 的 input/expected |
| L13-01, L14-01 | `channel.test.ts` + 源码 | 单元已覆盖；E2E 补一条 |
| L7+ | — | capabilities 声明 `media: false` → auto skip |

**建议文件布局：**

```
extensions/gotify/
├── scripts/
│   ├── functional-test.ts          # 保留：API 层
│   ├── e2e-agent-test.ts           # 可 deprecate → 调用标准 runner
│   ├── standard-test-adapter.ts    # 新建：Gotify ChannelAdapter
│   └── run-gotify-standard-tests.ts
└── testing/
    └── capabilities.gotify.yaml    # 可选：能力声明
```

**Gotify adapter 要点：**

1. **send：** `POST /message`，body 来自 `input.message`；correlation_id 写入 message 前缀  
2. **waitForReply：** 与 `e2e-agent-test.ts` 相同 — 记录 beforeIds，poll `/message?limit=10`，跳过 outbound echo（title/extras 标记）  
3. **cleanup：** DELETE `/message/{id}`  
4. **skip：** `supports_image_inbound: false` 自动跳过 L7–L9、X-01  

**运行示例：**

```bash
cd extensions/gotify
pnpm build
GOTIFY_APP_TOKEN=AK-MvdcbyFOfBmQ GOTIFY_CLIENT_TOKEN=C7ErQjzzeoAXCKg \
  OPENCLAW_TEST_TIERS=L0,L1,L2,L3 pnpm test:standard
```

## 其他插件提示

| 插件 | send | waitForReply | 备注 |
|------|------|--------------|------|
| **feishu** | 开放平台发消息 API / 模拟 webhook POST | 查消息列表或 webhook 出站 | 支持图片；L7+ 可跑 |
| **mqtt** | publish 到 inbound topic | subscribe outbound topic | L11 topic 路由 |
| **redis-stream** | PUBLISH | SUBSCRIBE out channel | 注意 exclude 回环 topic |
| **wecom** | 应用消息 API | 回调或轮询 | dmPolicy、加密需 fixture |

## 环境变量

| 变量 | 说明 |
|------|------|
| `OPENCLAW_TEST_DATASET` | YAML 路径，默认 `testing/test-dataset.yaml` |
| `OPENCLAW_TEST_TIERS` | 逗号分隔，如 `L0,L1,L2` |
| `OPENCLAW_TEST_IDS` | 逗号分隔用例 ID |
| `OPENCLAW_TEST_CHANNEL` | 渠道 ID |
| `OPENCLAW_TEST_TIMEOUT_MULTIPLIER` | 全局超时倍数（慢 CI 用 2） |
| `OPENCLAW_TEST_POLL_MS` | 等待回复轮询间隔（默认 250，Gotify 消费即删场景） |
| `OPENCLAW_WAIT_REPLY_TIMEOUT_MS` | `wait-reply-test.ts` 专用超时（默认 120000） |
| `OPENCLAW_TEST_VISIBLE` | `1` = 标准测试 runner 跳过额外 cleanup；不关闭插件 `deleteAfterConsume` |
| `OPENCLAW_GATEWAY_URL` | Control UI / Gateway 地址，用于终端提示（默认 `http://127.0.0.1:18789`） |
| `GOTIFY_TEST_PEER_ID` / `OPENCLAW_TEST_PEER_ID` | Gotify 对端 appid，用于 sessionKey 提示（e2e-user 常为 `4`） |
| `OPENCLAW_TEST_DM_SCOPE` | 与 `session.dmScope` 一致时 sessionKey 提示更准确（默认按 `per-channel-peer`） |

## 依赖

Runner 使用 Node 22+ 内置能力解析 YAML；若需严格 schema 校验，可后续加 `zod`（不强制）。

```bash
# 可选：安装 yaml 解析（runner 内已 try 动态 import）
npm install yaml
```

## 贡献新用例

1. 编辑 `test-dataset.yaml`  
2. 更新 `STANDARD-TEST-SUITE.md` Tier 表  
3. PR 描述中说明适用渠道与 capability  

## 许可证

与 openclaw-plugins monorepo 相同（MIT）。
