<div align="center">

# OpenClaw Gotify

**OpenClaw 插件：Gotify 渠道桥接 — REST API 推送 + WebSocket 流接收 + 多账号会话隔离**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--gotify-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

[简体中文](./README.md) | [English](./README.en.md)

`@partme.ai/openclaw-gotify` 是为 [OpenClaw](https://github.com/openclaw/openclaw) 开发的 [Gotify](https://gotify.net/) 渠道插件：通过 REST API **发送消息**，通过 WebSocket `/stream` **实时接收消息**，并完整支持 Application 和 Client 的 **生命周期管理**。

## 📖 简介

**OpenClaw Gotify**（`@partme.ai/openclaw-gotify`）基于 Gotify 官方 REST API 和 WebSocket Stream API，将自托管的 Gotify 推送服务器桥接到 OpenClaw Agent 系统。插件按照官方文档使用 [`defineChannelPluginEntry`](https://docs.openclaw.ai/plugins/sdk-entrypoints#definechannelpluginentry) + `ChannelPlugin` 实现。

### 🎯 核心能力

- **REST 消息发送** — 通过 Gotify Message API (`POST /message`) 发送 Agent 回复
- **WebSocket 流接收** — 通过 Gotify Stream API (`GET /stream`) 实时接收入站消息
- **Application 管理** — 完整的 CRUD：创建、更新、删除、上传图标
- **Client 管理** — 完整的 CRUD：创建、更新、删除
- **消息管理** — 获取消息列表（游标分页）、按 ID 删除、批量删除
- **多账号多智能体** — `accounts` 映射支持多个 Gotify 实例，按 `dmScope` 粒度隔离会话
- **会话隔离** — 完全遵循 OpenClaw 全局 `session.dmScope` 配置（`main` / `per-peer` / `per-channel-peer` / `per-account-channel-peer`）
- **幂等去重** — 60 秒窗口内相同账号+消息 ID 不会重复派发

### 生命周期

- WebSocket 监听器在 Gateway 对 Gotify 渠道执行 `startAccount` 时启动
- 账号级并发锁确保同一 Gotify 实例的请求串行化，防止触发限流
- HTTP `GET /gotify/status`、`/gotify/health`、`/gotify/doctor` 在入口的 `registerFull` 中注册
- 会话键粒度遵循 OpenClaw 全局 `session.dmScope` 配置
- **`package.json` → `openclaw.setupEntry`** 指向 `dist/setup-entry.js`，通过 `defineSetupPluginEntry` 导出轻量入口

## 前置要求

- 已安装 [OpenClaw](https://github.com/openclaw/openclaw)（`>=2026.4.0`，见 `package.json` 中 `peerDependencies` 与 `openclaw.compat` / `openclaw.build`）
- **Node.js 22+**（与官方 [Building plugins](https://docs.openclaw.ai/plugins/building-plugins) 前置要求一致）
- 一个运行中的 [Gotify 服务器](https://gotify.net/docs/install)（v2.x+）

## 安装

### 1. 使用 OpenClaw CLI（推荐）

```bash
openclaw plugins install @partme.ai/openclaw-gotify
```

然后在 `channels.gotify` 中填写配置（见下文）。

### 2. 使用 npm（手动 / 高级）

```bash
npm install @partme.ai/openclaw-gotify
```

再按你所用版本的规则，通过 `openclaw.plugin.json`、`plugins.entries` 等将包接入 OpenClaw。

## 配置

### 最小配置（单账号）

```jsonc
{
  "channels": {
    "gotify": {
      "serverUrl": "https://gotify.example.com",
      "appToken": "Axxxxxxxxxxxxx",
      "clientToken": "Cxxxxxxxxxxxxx",
      "defaultPriority": 5,
      "inbound": {
        "enabled": true
      }
    }
  }
}
```

### 多账号多智能体

```jsonc
{
  "channels": {
    "gotify": {
      "defaultAccount": "ops",
      "accounts": {
        "ops": {
          "serverUrl": "https://ops-gotify.example.com",
          "appToken": "A_ops_token",
          "clientToken": "C_ops_client",
          "defaultPriority": 5,
          "inbound": { "enabled": true }
        },
        "alert": {
          "serverUrl": "https://alert-gotify.example.com",
          "appToken": "A_alert_token",
          "clientToken": "C_alert_client",
          "defaultPriority": 9,
          "inbound": { "enabled": true }
        }
      }
    }
  },
  "agents": {
    "ops-agent": {
      "channels": { "gotify": { "accounts": ["ops"] } }
    },
    "alert-agent": {
      "channels": { "gotify": { "accounts": ["alert"] } }
    }
  },
  "session": {
    "dmScope": "per-account-channel-peer"
  }
}
```

### 配置说明

#### 顶级配置（单账号兼容模式）

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 是否启用渠道 |
| `name` | string | — | 账号显示名称 |
| `serverUrl` | string | — | Gotify 服务器地址（如 `https://gotify.example.com`） |
| `appToken` | string | — | 应用 Token，用于发送消息（前缀 `A`） |
| `clientToken` | string | — | 客户端 Token，用于接收消息和管理 API（前缀 `C`） |
| `defaultPriority` | number | `5` | 默认消息优先级（0–10） |
| `defaultAccount` | string | — | 多账号模式下的默认账号 ID |
| `accounts` | object | — | 多账号配置映射 |

#### `inbound` — WebSocket 流配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `false`（有 `clientToken` 时为 `true`） | 是否启用 WebSocket 流监听 |
| `reconnectDelayMs` | number | `2000` | 初始重连延迟（毫秒） |
| `maxReconnectDelayMs` | number | `30000` | 最大重连延迟（指数退避上限） |
| `maxReconnectAttempts` | number | `10` | 最大重连尝试次数 |
| `deleteAfterConsume` | boolean | `true` | 消费即删：入站派发成功后删除原消息，Agent 回复发送成功后删除回复消息 |

#### 消费即删策略

默认 **`deleteAfterConsume: true`**（严格策略）：只要消息被消费，就从 Gotify 服务端删除。

| 方向 | 触发时机 |
|------|----------|
| 入站 | Agent **整轮回复投递完成**后，DELETE 用户发来的原消息（避免先删后答） |
| 出站 | `POST /message` 成功后立即 DELETE 该回复（手机端先收到推送再清理） |

关闭方式：配置 `channels.gotify.inbound.deleteAfterConsume: false`。  
`OPENCLAW_TEST_VISIBLE=1` **不会**跳过插件侧删除，仅影响标准测试 runner 的额外 cleanup 行为。

### 环境变量声明

以下环境变量在 `openclaw.plugin.json` 的 `channelEnvVars` 中声明，供 OpenClaw 的 setup 发现机制在插件加载前通告给用户。**插件代码不直接读取 `process.env`** — 所有配置均从 `channels.gotify` 配置节解析（参见上面的配置章节）。

| 变量 | 用途 |
|------|------|
| `GOTIFY_SERVER_URL` | Gotify 服务器地址 — 等同于配置 `channels.gotify.serverUrl` |
| `GOTIFY_APP_TOKEN` | 应用 Token — 等同于配置 `channels.gotify.appToken` |
| `GOTIFY_CLIENT_TOKEN` | 客户端 Token — 等同于配置 `channels.gotify.clientToken` |

## 🏗️ 消息处理流程

```
┌──────────────────────────────────────────────────────────┐
│                   Gotify Server                           │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Message API │  │ Stream API   │  │ App/Client API │  │
│  │ POST /msg   │  │ WS /stream   │  │ CRUD           │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘  │
└─────────┼────────────────┼──────────────────┼───────────┘
          │                │                  │
          ▼                ▼                  ▼
┌──────────────────────────────────────────────────────────┐
│              openclaw-gotify Plugin                       │
│                                                          │
│  Outbound: mapOutbound → sendGotifyMessage → Message API │
│  Inbound:  WebSocket → dedup → dmScope session → Agent  │
│  Admin:    list/create/update/delete Apps & Clients      │
│  Health:   GET /health → latency check                   │
└──────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────┐
│                OpenClaw Gateway                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐   │
│  │ Agent    │  │ Session  │  │ Channel Reply        │   │
│  │ Routing  │  │ Store    │  │ Pipeline             │   │
│  └──────────┘  └──────────┘  └──────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

1. Gotify 应用或外部系统发送消息到 Gotify 服务器
2. 插件通过 WebSocket `/stream` 实时接收消息
3. 幂等去重（60 秒窗口）
4. 解析对端标识（`extras.openclaw.peerId` → `appid` → `title`）
5. 按 `session.dmScope` 构造会话键
6. 路由到对应 Agent 处理
7. Agent 回复通过 `POST /message`（App Token）发送回 Gotify

## 💬 一来一回对话（Gotify + Control UI）

| 层面 | 行为 |
|------|------|
| **Gotify App** | 推送通知渠道；默认消费即删（入站用户消息在 Agent **回复发送成功后**删除，出站回复在 POST **成功后**删除） |
| **OpenClaw Control UI** | **完整对话历史** 保存在 Session Store；多轮共用同一 `sessionKey`（同一 `peerId` / appid） |
| **幂等** | 仅按 `messageId` 去重，同一对端连续多条新消息不会互相屏蔽 |
| **出站** | `sendGotifyMessageWithDeliveryRetry`：失败时自动再试 1 次 |

**在 Control UI 查看测试 / 真实对话：**

1. 打开 Gateway（如 `http://127.0.0.1:18789`）→ **Sessions**
2. 不要选默认 `agent:main:main`；选择 **`gotify: e2e-user`** 或 sessionKey：`agent:main:gotify:default:direct:<peerId>`（`dmScope=per-account-channel-peer` 时，见下表）
3. Gotify 手机上可能看不到历史（已删），但 UI 里可顺畅多轮一来一回

手动连发 3 条验证：用 e2e-user App Token 连发 3 次 `POST /message`，应在同一 session 看到 3 轮 user/agent 记录。

## 🧭 dmScope 会话隔离

插件完全遵循 OpenClaw 全局 `session.dmScope` 配置，无需额外自定义隔离配置。

| dmScope | 会话键格式 | 隔离粒度 |
|---------|-----------|----------|
| `main` | `agent:<agentId>:main` | 所有消息共享同一会话 |
| `per-peer` | `agent:<agentId>:direct:<peerId>` | 按对端隔离 |
| `per-channel-peer` | `agent:<agentId>:gotify:direct:<peerId>` | 按渠道+对端隔离 |
| `per-account-channel-peer` | `agent:<agentId>:gotify:<accountId>:direct:<peerId>` | 按账号+渠道+对端隔离（推荐多账号） |

对端标识解析优先级：`extras.openclaw.peerId` → `appid` → `title` → `"gotify"`

## 🧪 测试

### 诚实评估：单元测试 ≠ Control UI 成功

| 层级 | 命令 | 证明什么 | **不能**证明什么 |
|------|------|----------|------------------|
| L0 单元 | `pnpm test`（vitest，~91 条） | 配置解析、mock 派发、去重逻辑 | Gateway 运行、WS 入站、**Control UI 有消息** |
| L1 标准 | `pnpm test:standard` | Gotify 往返 +（默认）chat.history 抽检 | 用户肉眼在 UI 点对了会话 |
| **UI 验收门禁** | **`pnpm test:ui-gate`** | **`chat.history` 含 user 消息 = UI 同源 transcript** | Agent LLM 一定成功（user 消息必须先出现） |

**发布 / 验收必须 `pnpm test:ui-gate` 通过。** 仅 vitest 全绿不算成功。

```bash
# 1. 构建并重启 Gateway（加载最新插件）
pnpm build && openclaw gateway restart

# 2. UI 验收门禁（必过）
GOTIFY_APP_TOKEN=AK-MvdcbyFOfBmQ GOTIFY_CLIENT_TOKEN=C7ErQjzzeoAXCKg pnpm test:ui-gate

# 3. 单元测试（CI，mock）
pnpm test

# 4. 标准 + Agent 往返（可选，含 chat.history 尾检）
GOTIFY_APP_TOKEN=... GOTIFY_CLIENT_TOKEN=... pnpm test:standard
```

### Control UI 里查看测试 / E2E 对话

测试消息经 Gotify REST 入站后，会话键由 **`session.dmScope`** 决定（本仓库常见为 `per-account-channel-peer` → `agent:main:gotify:default:direct:4`），**不会**出现在默认 **`agent:main:main`**。

- 打开 `http://127.0.0.1:18789` → **Sessions** → 选 **`gotify: e2e-user`** 或 **`agent:main:gotify:default:direct:4`**
- **勿用** `channels.gotify.appToken` 做入站测试（与出站同 appid 会被 echo 过滤）；用 **e2e-user App Token**（appid=4）
- 勿选已废弃的 `agent:main:gotify:direct:4`（旧 dmScope 残留、transcript 文件缺失时 UI 会显示 0 条消息）
- 默认消费即删（入站 + 出站回复），Gotify App 消息列表通常为空；需保留消息时设 `channels.gotify.inbound.deleteAfterConsume: false`
- `OPENCLAW_TEST_VISIBLE=1 pnpm test:standard`：仅跳过 runner cleanup，不关闭插件删除

```bash
# 单元测试
npm test

# 类型检查
npm run typecheck

# 构建
npm run build
```

## 🤖 GitHub Actions

| 工作流 | 触发方式 | 作用 |
|--------|----------|------|
| `ci.yml` | push / PR 到 `main` | 安装、类型检查、构建、测试 |
| `release.yml` | `v*` 标签 | 构建、测试并发布 npm 包 |

## 📦 发版

```bash
npm version patch
git push origin main --follow-tags
```

## 📁 项目结构

```
openclaw-gotify/
├── src/
│   ├── index.ts              # defineChannelPluginEntry + registerFull（HTTP 路由）
│   ├── setup-entry.ts        # defineSetupPluginEntry 轻量入口
│   ├── channel.ts            # ChannelPlugin 定义 + dispatchInboundMessage
│   ├── gotify-api.ts         # Gotify REST API 全量封装（Message/Application/Client/Health）
│   ├── config.ts             # 配置解析（多账号合并、默认值补齐）
│   ├── channel-config.ts     # ChannelConfigSchema（Zod + JSON Schema）
│   ├── peer-resolver.ts      # Gotify peerId 解析（供 resolveAgentRoute）
│   ├── inbound-access.ts     # 入站 DM 策略（SDK channel-ingress-runtime）
│   ├── message-mapper.ts     # 入站/出站消息映射
│   ├── outbound.ts           # ChannelOutboundAdapter
│   ├── ws-listener.ts        # WebSocket 流监听器（指数退避重连）
│   ├── setup.ts              # Bootstrap + Doctor
│   ├── runtime.ts            # 运行时状态管理
│   ├── config-wizard.ts      # 配置向导
│   ├── gotify-client.ts      # GotifyClient 类封装
│   └── types.ts              # 类型定义
├── scripts/
│   ├── test-client.ts        # 手动 doctor/bootstrap 测试客户端
│   ├── functional-test.ts    # 完整 API 功能测试（需真实 Gotify 服务器）
│   ├── e2e-agent-test.ts     # 端到端 Agent 通信 + chat.history 验收
│   └── ui-transcript-gate-test.ts  # Control UI 验收门禁（发布必过）
├── openclaw.plugin.json      # 插件清单
├── package.json
└── README.md / README.en.md
```

## 📚 OpenClaw 官方文档

- [Channel plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins)
- [SDK entry points](https://docs.openclaw.ai/plugins/sdk-entrypoints)
- [SDK runtime](https://docs.openclaw.ai/plugins/sdk-runtime)
- [SDK setup](https://docs.openclaw.ai/plugins/sdk-setup)
- [SDK testing](https://docs.openclaw.ai/plugins/sdk-testing)
- [Plugin manifest](https://docs.openclaw.ai/plugins/manifest)
- [Plugin architecture](https://docs.openclaw.ai/plugins/architecture)

## 📚 Gotify 参考

- [Gotify 官网](https://gotify.net/)
- [Gotify 文档](https://gotify.net/docs/)
- [Push Message API](https://gotify.net/docs/pushmsg)
- [Message Extras](https://gotify.net/docs/msgextras)
- [Gotify CLI](https://github.com/gotify/cli)
- [Gotify Android](https://github.com/gotify/android)

## ❓ 常见问题

**必须同时配置 appToken 和 clientToken 吗？**

如果只需要发送消息（出站），仅配置 `appToken` 即可。如果需要实时接收消息（入站 WebSocket 流），则需要 `clientToken`。对于完整的双向通信，两者都需要。

**WebSocket 连接断开后会自动重连吗？**

是的。插件使用指数退避重连策略：初始延迟 `reconnectDelayMs`（默认 2000ms），每次失败翻倍，上限 `maxReconnectDelayMs`（默认 30000ms），最多重试 `maxReconnectAttempts`（默认 10）次。

**如何实现多智能体隔离？**

通过 `session.dmScope` 配置会话隔离粒度。推荐多账号场景使用 `"per-account-channel-peer"`，这样不同 Gotify 应用的消息分配到独立的会话。

**Gotify 消息如何路由到不同的 Agent？**

入站消息通过 `extras.openclaw.peerId` 字段指定对端标识，或根据发送方 Application ID 自动识别。然后通过 OpenClaw 的 Agent 路由配置确定目标 Agent。

## 📄 开源协议

本项目采用 [MIT License](./LICENSE) 协议。

## 🙏 致谢

- [Gotify](https://gotify.net/) — 优秀的自托管推送通知服务器
- [OpenClaw](https://github.com/openclaw/openclaw) — AI Gateway 平台

---

<div align="center">

**如果这个项目对你有帮助，请给我们一个 ⭐️**

Made with ❤️ by PartMe

</div>
