# OpenClaw WeCom 配置指南 / WeCom Configuration Guide

`@partme.ai/wecom` 是 openclaw-plugins 的旗舰渠道插件，支持企业微信**智能机器人（Bot）**与**自建应用（Agent）**双模式接入。

**相关文档**：[架构](./OpenClaw-WeCom-Architecture.md) · [流式](./OpenClaw-WeCom-Streaming-Architecture.md) · [联调测试](./OpenClaw-WeCom-Testing.md) · [README](../../extensions/wecom/README.zh-CN.md)

---

## Part A — 概览 / Overview

### 配置根路径 / Config root

所有 WeCom 配置位于 **`channels.wecom.*`**（平铺结构，**非** `wecom-kf` 的 `bot:{}` 嵌套）。

| 主题 | 说明 |
|------|------|
| 配置文件 | `~/.openclaw/openclaw.json`（或你的 Gateway 配置路径） |
| 多账号 | 使用 `accounts.<accountId>`；账号级字段覆盖顶层同名字段 |
| 默认账号 | `defaultAccount` 指定 CLI / Cron 默认出站账号 |
| 源码真值 | `extensions/wecom/src/config/wecom-config.ts` |

### 安装 / Install

```bash
openclaw plugins install @partme.ai/wecom
```

**环境要求**：Node.js ≥ 22、OpenClaw ≥ 2026.4.12、`@partme.ai/openclaw-message-sdk >= 2026.5.22`

### 模式对比 / Mode comparison

| 能力 | Bot（智能机器人） | Agent（自建应用） |
|------|:---:|:---:|
| 接收消息 | 文本/图片/语音/文件/引用 | 文本/图片/语音/视频/位置 |
| 群聊 | ✅ @机器人触发 | ❌ 仅私聊 |
| 流式响应 | ✅ 打字机效果 | ❌ |
| 主动推送 | ❌ | ✅ 指定用户/部门/标签 |
| 文件发送 | ✅ 图片/Markdown | ✅ 全格式 |
| 公网 IP | WebSocket **不需要** | HTTP 回调 **需要** |
| 配置复杂度 | 简单 | 中等 |

Bot 通过 `connectionMode` 选择 **`websocket`**（默认，需 `botId` + `secret`）或 **`webhook`**（需 `token` + `encodingAESKey`）。

### Webhook 回调路径 / Callback URLs

| 模式 | 推荐路径 | 兼容路径 |
|------|----------|----------|
| Bot | `https://<gateway-host>/plugins/wecom/bot/<accountId>` | `/plugins/wecom/bot` |
| Agent | `https://<gateway-host>/plugins/wecom/agent/<accountId>` | `/plugins/wecom/agent` |

> **Agent 配置顺序**：先配置 Gateway 并 `restart`，**再**在企微后台保存回调 URL。

### 场景索引 / Scenario index

按能力递进；每级 JSON 可独立复制，也可在上一级基础上累加字段。

| # | 场景 | 锚点 |
|---|------|------|
| 1 | 最小 Bot WebSocket（私聊） | [场景 1](#场景-1--最小-bot-websocket--minimal-bot-websocket) |
| 2 | 欢迎语与用户可见文案 | [场景 2](#场景-2--欢迎语与用户可见文案--welcome--user-facing-text) |
| 3 | 流式输出、脚注与思考占位 | [场景 3](#场景-3--流式输出--streaming-output) |
| 4 | 访问控制（私聊 / 群聊） | [场景 4](#场景-4--访问控制--access-control) |
| 5 | 媒体收发与本地路径白名单 | [场景 5](#场景-5--媒体--media) |
| 6 | Agent 模式（自建应用） | [场景 6](#场景-6--agent-模式--agent-mode) |
| 7 | 双模 Bot WS + Agent（生产推荐） | [场景 7](#场景-7--双模生产--dual-mode-production) |
| 8 | 多账号 | [场景 8](#场景-8--多账号--multi-account) |
| 9 | 知识库 / RAG 集成 | [场景 9](#场景-9--知识库--rag--knowledge--rag) |
| 10a | 动态 Agent + 出口代理 | [场景 10a](#场景-10a--动态-agent--出口代理--dynamic-agents--egress-proxy) |
| 10b | Agent 语音 ASR（腾讯云） | [场景 10b](#场景-10b--agent-语音-asr--agent-voice-asr) |
| 10c | Bot Webhook 模式（替代 WebSocket） | [场景 10c](#场景-10c--bot-webhook-模式--bot-webhook-mode) |
| 11 | Cron 定时推送与出站目标格式 | [场景 11](#场景-11--cron-定时推送--cron-scheduled-delivery) |
| — | 未实现配置项速查 | [附录 A](#附录-a--未实现配置项--unimplemented-keys) |
| — | 完整 *Text 文案键参考 | [附录 B](#附录-b--text-文案键参考--text-template-keys) |
| — | 常见问题 | [附录 C](#附录-c--常见问题--faq) |

---

## Part B — 分场景配置 / Scenario-by-scenario

---

### 场景 1 — 最小 Bot WebSocket / Minimal Bot WebSocket

#### 中文

**何时使用**：最快接入路径；WebSocket 长连接收发明文私聊，**无需公网 IP**。

**解锁能力**：私聊对话、基础 AI 回复、WS 自动重连与心跳。

**前置条件**

| 企微管理后台 | OpenClaw |
|--------------|----------|
| 安全与管理 → 管理工具 → **智能机器人** → 创建（**API 模式**） | 已安装 `@partme.ai/wecom` |
| 记录 **Bot ID**、**Secret** | — |

**完整配置示例**

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>"
    }
  }
}
```

**字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `enabled` | `boolean` | 是 | 启用 WeCom 通道 |
| `connectionMode` | `"websocket"` \| `"webhook"` | 否 | 默认 `websocket` |
| `botId` | `string` | WS 必填 | 智能机器人 Bot ID |
| `secret` | `string` | WS 必填 | 智能机器人 Secret |
| `websocketUrl` | `string` | 否 | 默认 `wss://openws.work.weixin.qq.com` |

**验证步骤**

```bash
openclaw gateway restart
openclaw channels status --probe
```

在企微客户端向 Bot 发送 `你好`，应收到 AI 回复；Gateway 日志可见 WebSocket 认证成功。

#### English

**When to use**: Fastest path to DM chat over WebSocket; **no public IP** required.

**Unlocks**: Private chat, basic AI replies, WS heartbeat and auto-reconnect.

**Prerequisites**

| WeCom admin | OpenClaw |
|-------------|----------|
| Security & Management → Admin Tools → **Smart Robot** → Create (**API mode**) | `@partme.ai/wecom` installed |
| Copy **Bot ID** and **Secret** | — |

**Full config**

Same JSON as above.

**Field reference**

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `enabled` | `boolean` | yes | Enable WeCom channel |
| `connectionMode` | `"websocket"` \| `"webhook"` | no | Default `websocket` |
| `botId` | `string` | WS yes | Smart robot Bot ID |
| `secret` | `string` | WS yes | Smart robot Secret |
| `websocketUrl` | `string` | no | Default `wss://openws.work.weixin.qq.com` |

**Verify**

```bash
openclaw gateway restart
openclaw channels status --probe
```

Send `hello` to the bot in WeCom; expect an AI reply and WS auth success in Gateway logs.

---

### 场景 2 — 欢迎语与用户可见文案 / Welcome & user-facing text

#### 中文

**何时使用**：定制进入会话欢迎语，以及思考、工具调用、超时等**用户可见状态文案**。

**解锁能力**：`enter_chat` 欢迎语、流式气泡状态栏文案、空回复/超时提示。

**前置条件**：完成 [场景 1](#场景-1--最小-bot-websocket--minimal-bot-websocket)。

**完整配置示例**

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "welcomeText": "你好，我是企业 AI 助手，有什么可以帮你？",
      "thinkingText": "正在思考…",
      "toolStatusText": "正在调用 {toolName}…",
      "emptyReplyText": "抱歉，我暂时无法回答这个问题。",
      "timeoutText": "处理超时，请稍后再试。"
    }
  }
}
```

**字段说明**

| 字段 | 占位符 | 用途 |
|------|--------|------|
| `welcomeText` | — | 进入会话 / subscribe 欢迎语 |
| `thinkingText` | — | 流式气泡**状态栏**（思考阶段） |
| `toolStatusText` | `{toolName}` | 工具调用状态栏 |
| `emptyReplyText` | — | Agent 返回空内容时 |
| `timeoutText` | — | 处理超时提示 |
| `readingText` | — | 入站含附件时 |
| `generatingText` | — | 开始生成答案 |
| `finishFooterText` | `{elapsed}` | 关流时脚注（见场景 3） |

完整 `*Text` 键见 [附录 B](#附录-b--text-文案键参考--text-template-keys) 与 `extensions/wecom/src/config/text-config.ts`。

**验证步骤**

1. 重新打开 Bot 私聊窗口 → 应看到 `welcomeText`
2. 发送需推理的问题 → 状态栏显示自定义 `thinkingText`

```bash
openclaw config set channels.wecom.welcomeText "你好，我是助手"
openclaw gateway restart
```

#### English

**When to use**: Customize enter-chat welcome and status strings (thinking, tools, timeout).

**Unlocks**: Welcome on `enter_chat`, stream status bar text, empty/timeout messages.

**Prerequisites**: [Scenario 1](#场景-1--最小-bot-websocket--minimal-bot-websocket).

**Full config** — same JSON structure; use English strings as needed.

**Verify**

1. Re-open bot chat → `welcomeText` appears
2. Ask a reasoning question → custom `thinkingText` in status bar

---

### 场景 3 — 流式输出 / Streaming output

#### 中文

**何时使用**：需要打字机式增量回复、状态栏/耗时脚注，或关闭「思考中」占位。

**解锁能力**：`replyStream` 增量输出、footer 耗时、可选 `sendThinkingMessage`。

**前置条件**：完成 [场景 2](#场景-2--欢迎语与用户可见文案--welcome--user-facing-text)（或至少场景 1）。

**完整配置示例**

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "welcomeText": "你好，我是企业 AI 助手。",
      "thinkingText": "正在思考…",
      "sendThinkingMessage": true,
      "streaming": {
        "enabled": true,
        "status": true,
        "content": true
      },
      "footer": {
        "status": true,
        "elapsed": true
      },
      "finishFooterText": "⏱ {elapsed}s · 已完成"
    }
  }
}
```

**字段说明**

| 字段 | 说明 |
|------|------|
| `streaming: false` | **默认模式**：状态栏 + 最终整包（非打字机） |
| `streaming: true` 或嵌套对象 | 中间状态 + 答案增量流式 |
| `streaming.status` | 工具/阶段状态流式，默认 `true`（streaming 开启时） |
| `streaming.content` | 答案 block 增量流式，默认 `true` |
| `sendThinkingMessage` | 是否发送思考占位，默认 `true` |
| `footer.status` | 状态栏阶段文案，默认 `true` |
| `footer.elapsed` | 关流时展示耗时，默认 `false` |
| `streamPlaceholderText` | **协议层**首帧占位，一般无需修改（见附录 B） |

**验证步骤**

```bash
openclaw config set channels.wecom.streaming true
openclaw gateway restart
```

发送长问题，观察回复是否逐字/逐段更新；关流后脚注含耗时。详见 [流式架构](./OpenClaw-WeCom-Streaming-Architecture.md)。

#### English

**When to use**: Typewriter-style incremental replies, status/elapsed footer, optional thinking placeholder.

| Field | Meaning |
|-------|---------|
| `streaming: false` | Default: status line + final bundle |
| `streaming: true` or nested | Status updates + incremental answer |
| `sendThinkingMessage` | Thinking placeholder (default `true`) |
| `streamPlaceholderText` | Protocol first-frame placeholder; usually leave default |

**Verify**: Send a long question; reply should stream; footer shows elapsed time.

---

### 场景 4 — 访问控制 / Access control

#### 中文

**何时使用**：限制谁可以私聊 Bot，或哪些群/群内成员可以触发机器人。

**解锁能力**：DM 配对/白名单、群白名单、群内发送者白名单。Bot（WS/Webhook）与 Agent 回调执行**同一套**门禁。

**前置条件**：完成 [场景 3](#场景-3--流式输出--streaming-output)（或至少场景 1）。

**完整配置示例**

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "dmPolicy": "pairing",
      "allowFrom": ["zhangsan", "lisi"],
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["wr1234567890abcdef"],
      "groups": {
        "wr1234567890abcdef": {
          "allowFrom": ["zhangsan", "admin_userid"]
        }
      },
      "streaming": true,
      "welcomeText": "你好，已通过访问校验。"
    }
  }
}
```

**字段说明**

| 字段 | 可选值 | 默认 | 行为 |
|------|--------|------|------|
| `dmPolicy` | `open` / `pairing` / `allowlist` / `disabled` | `open` | 私聊访问策略 |
| `allowFrom` | 用户 ID 数组 | `[]` | `allowlist` 时生效 |
| `groupPolicy` | `open` / `allowlist` / `disabled` | `open` | 群聊访问策略 |
| `groupAllowFrom` | 群 ID 数组 | `[]` | `allowlist` 时生效 |
| `groups.<chatId>.allowFrom` | 用户 ID 数组 | — | 群内发送者白名单 |

Webhook pairing 码经 `response_url` 推送；Agent pairing 经应用 API 私信下发。

**验证步骤**

```bash
openclaw pairing list wecom
openclaw pairing approve wecom <CODE>
```

未授权用户私聊应收到配对码；授权用户正常对话。群内仅 `groups.<chatId>.allowFrom` 内成员消息被处理。

#### English

**When to use**: Restrict DM access or limit which groups/members can interact with the bot.

**DM policies**: `open` (default), `pairing`, `allowlist`, `disabled`.

**Group policies**: `open` (default), `allowlist`, `disabled`.

**Verify**: Unauthorized users get pairing code; `openclaw pairing approve wecom <CODE>` grants access.

---

### 场景 5 — 媒体 / Media

#### 中文

**何时使用**：收发图片/语音/文件/视频；Agent 回复含本地路径文件。

**解锁能力**：入站媒体解密；出站本地文件（须在白名单路径内）；超限自动降级。

**前置条件**：完成 [场景 4](#场景-4--访问控制--access-control)（或场景 1 + 媒体需求）。

**完整配置示例**

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "mediaLocalRoots": [
        "~/Downloads",
        "~/Documents/reports"
      ],
      "media": {
        "maxBytes": 20971520
      },
      "mediaErrorNoAccessText": "无法访问该文件路径，请联系管理员配置 mediaLocalRoots。",
      "streaming": true
    }
  }
}
```

**字段说明**

| 字段 | 说明 |
|------|------|
| `mediaLocalRoots` | 允许 Agent 读取并发送的本地路径（支持 `~`） |
| `media.maxBytes` | 文件上限（字节），默认 20971520（20MB） |
| `mediaErrorNoAccessText` | 路径不在白名单时的用户提示 |

**媒体限制与降级**

| 类型 | 限制 | 超出行为 |
|------|------|----------|
| 图片 | 10 MB | 降级为文件发送 |
| 视频 | 10 MB | 降级为文件发送 |
| 语音 | 2 MB（AMR） | 非 AMR 或超限 → 文件 |
| 文件 | 20 MB（可用 `media.maxBytes` 调整） | 拒绝 |

> Bot 接口不支持在群内发非图片文件；插件会通过 Agent 私信发送并在群内提示。

**验证步骤**

1. 向 Bot 发送一张图片 → 应正常识别并回复
2. 让 Agent 回复含 `mediaLocalRoots` 下路径的文件 → 应成功发送

#### English

**When to use**: Inbound/outbound image, voice, file, video; local file paths for Agent replies.

| Field | Description |
|-------|-------------|
| `mediaLocalRoots` | Whitelisted local paths for outbound files |
| `media.maxBytes` | Max file size in bytes (default 20MB) |

**Verify**: Send an image inbound; Agent reply with file under whitelisted path succeeds.

---

### 场景 6 — Agent 模式 / Agent mode

#### 中文

**何时使用**：需要 HTTP 回调收消息、**主动推送**、Cron 定时任务、大文件/全格式出站。

**解锁能力**：加密 XML 回调、主动 `message/send`、部门/标签广播。

**前置条件**

| 企微管理后台 | OpenClaw |
|--------------|----------|
| 应用管理 → **自建应用** → 创建 | 已安装插件 |
| 记录 **CorpID**、**CorpSecret**、**AgentId** | Gateway 可公网访问（或内网穿透） |
| 应用 → **API 接收消息** → **Token**、**EncodingAESKey**（43 位） | 先配 Gateway 再保存回调 URL |

**完整配置示例**

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": 1000002,
        "token": "<YOUR_CALLBACK_TOKEN>",
        "encodingAESKey": "<YOUR_43_CHAR_AES_KEY>",
        "welcomeText": "欢迎使用企业应用助手。"
      },
      "network": {
        "agentReplyTimeoutMs": 360000
      }
    }
  }
}
```

**字段说明**

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `agent.corpId` | 是 | 企业 Corp ID |
| `agent.corpSecret` | 是 | 应用 Secret |
| `agent.agentId` | 出站必填 | 应用 Agent ID |
| `agent.token` | 是 | 回调验证 Token |
| `agent.encodingAESKey` | 是 | 43 位 Base64 AES 密钥 |
| `agent.welcomeText` | 否 | Agent 通道欢迎语 |
| `agent.dmPolicy` / `agent.allowFrom` | 否 | 覆盖顶层 DM 策略 |
| `network.agentReplyTimeoutMs` | 否 | Agent 回复总超时（默认见 SDK） |

回调 URL：`https://<gateway-host>/plugins/wecom/agent/default`

**验证步骤**

```bash
openclaw gateway restart
openclaw channels status --probe
openclaw message send --channel wecom --account default --target user:zhangsan --message "Agent 出站测试"
```

在企微中打开自建应用发私聊，或执行上述 `message send`。

#### English

**When to use**: HTTP callback inbound, proactive push, Cron, large/full-format outbound.

**Prerequisites**: Self-built app in WeCom admin; configure Gateway **before** saving callback URL.

Callback: `https://<gateway-host>/plugins/wecom/agent/default`

**Verify**: `openclaw message send --channel wecom --target user:zhangsan --message "test"`

---

### 场景 7 — 双模生产 / Dual-mode production

#### 中文

**何时使用**：**生产环境推荐** — Bot 负责流式对话；Agent 负责文件兜底、Cron、主动广播；Bot WS 不可用时自动回退 Agent HTTP。

**解锁能力**：最佳用户体验 + 完整出站能力 + 自动降级。

**前置条件**：[场景 1](#场景-1--最小-bot-websocket--minimal-bot-websocket) Bot 凭据 + [场景 6](#场景-6--agent-模式--agent-mode) Agent 凭据均已就绪。

**完整配置示例**

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "streaming": true,
      "footer": { "status": true, "elapsed": true },
      "mediaLocalRoots": ["~/Downloads"],
      "media": { "maxBytes": 20971520 },
      "dmPolicy": "open",
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": 1000002,
        "token": "<YOUR_CALLBACK_TOKEN>",
        "encodingAESKey": "<YOUR_43_CHAR_AES_KEY>"
      },
      "network": {
        "agentReplyTimeoutMs": 360000,
        "egressProxyUrl": "http://proxy.company.local:3128"
      }
    }
  }
}
```

**字段说明**

| 字段 | 说明 |
|------|------|
| Bot 字段 | 见场景 1–5 |
| `agent.*` | 见场景 6 |
| `network.egressProxyUrl` | 固定出口 IP（错误 60020 场景） |
| `network.timeoutMs` | 部分 HTTP 路径超时（毫秒） |

**出口代理优先级**：`network.egressProxyUrl` > `OPENCLAW_WECOM_EGRESS_PROXY_URL` > `WECOM_EGRESS_PROXY_URL` > `HTTPS_PROXY` > `ALL_PROXY` > `HTTP_PROXY`

**验证步骤**

1. Bot 私聊流式回复正常
2. 在群内请求发送大文件 → 应私信文件并在群内提示
3. Cron 测试（见 [场景 11](#场景-11--cron-定时推送--cron-scheduled-delivery)）

#### English

**When to use**: Production default — Bot for streaming chat; Agent for files, Cron, broadcast; auto-fallback when WS unavailable.

**Verify**: Bot DM streams; large file in group → DM file + group hint; Cron with Agent configured.

---

### 场景 8 — 多账号 / Multi-account

#### 中文

**何时使用**：运维 Bot、销售 Bot 等独立凭据与策略；`defaultAccount` 指定默认出站账号。

**解锁能力**：账号级字段覆盖、独立 Bot/Agent 凭据、隔离访问策略。

**前置条件**：每个账号在企微后台分别创建智能机器人 / 自建应用。

**完整配置示例**

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "ops",
      "dmPolicy": "open",
      "streaming": true,
      "accounts": {
        "ops": {
          "name": "运维助手",
          "botId": "<OPS_BOT_ID>",
          "secret": "<OPS_BOT_SECRET>",
          "agent": {
            "corpId": "ww1234567890abcdef",
            "corpSecret": "<OPS_CORP_SECRET>",
            "agentId": 1000002,
            "token": "<OPS_TOKEN>",
            "encodingAESKey": "<OPS_AES_KEY>"
          }
        },
        "sales": {
          "name": "销售助手",
          "dmPolicy": "allowlist",
          "allowFrom": ["zhangsan"],
          "botId": "<SALES_BOT_ID>",
          "secret": "<SALES_BOT_SECRET>"
        }
      }
    }
  }
}
```

**字段说明**

| 字段 | 说明 |
|------|------|
| `defaultAccount` | CLI / Cron 默认 `accountId` |
| `accounts.<id>` | 与顶层 `WeComConfig` 字段一致；覆盖顶层同名字段 |
| `accounts.<id>.name` | 显示名称 |

**验证步骤**

```bash
openclaw channels list
openclaw message send --channel wecom --account sales --target zhangsan --message "销售 Bot 测试"
openclaw message send --channel wecom --account ops --target zhangsan --message "运维 Bot 测试"
```

日志账号前缀应为 `[sales]`、`[ops]`。

#### English

**When to use**: Separate ops/sales bots with independent credentials and policies.

**Verify**: `openclaw channels list`; send with `--account sales` / `--account ops`.

---

### 场景 9 — 知识库 / RAG / Knowledge / RAG

#### 中文

**何时使用**：对话前自动检索知识库注入上下文；AI 通过 `knowledge_*` 工具读写知识。

**解锁能力**：RAG 注入、`knowledge_*` 工具链（需独立插件）。

**前置条件**

1. 完成 [场景 7](#场景-7--双模生产--dual-mode-production) 或 [场景 8](#场景-8--多账号--multi-account)（WeCom 通道可用）
2. **`@partme.ai/wecom` 当前未内置 knowledge hooks**，需单独安装知识库插件

```bash
openclaw plugins install @partme.ai/openclaw-knowledge
```

**完整配置示例**

```json
{
  "plugins": {
    "entries": {
      "knowledge": {
        "enabled": true,
        "config": {
          "enabled": true,
          "embedding": {
            "provider": "openai",
            "model": "text-embedding-3-small",
            "dimensions": 1536
          },
          "store": {
            "provider": "zvec",
            "dbPath": "./data/knowledge-wecom.db"
          },
          "retrieval": {
            "strategy": "hybrid",
            "topK": 5,
            "minScore": 0.3
          },
          "injection": {
            "position": "system",
            "maxContextLength": 2000
          }
        }
      }
    }
  },
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "ops",
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": 1000002,
        "token": "<YOUR_TOKEN>",
        "encodingAESKey": "<YOUR_AES_KEY>"
      }
    }
  },
  "agents": {
    "defaults": {
      "model": "gpt-4o-mini"
    }
  }
}
```

**说明**

| 主题 | 说明 |
|------|------|
| 独立插件配置 | 推荐 `plugins.entries.knowledge.config`（见 [knowledge INSTALL](../../extensions/knowledge/INSTALL.md)） |
| `channels.wecom.knowledge.*` | 仅当渠道内嵌 `registerKnowledgeHooks(api, 'channels.wecom.knowledge')` 时生效；**当前 wecom 源码未内嵌** |
| 命名空间 | 运行时按 `{accountId}:bot` 或 `{accountId}:agent` 隔离 |

**验证步骤**

```bash
openclaw gateway restart
openclaw run knowledge:stats
```

在企微：「请记住：公司报销流程见 wiki/报销.md」→ 再问「报销流程是什么？」应引用知识库内容。

**延伸阅读**：[Knowledge RAG 指南](../knowledge/OpenClaw-Knowledge-RAG-Guide_CN.md) · [集成文档](../knowledge/OpenClaw-Knowledge-RAG-Integration_CN.md)

#### English

**When to use**: Auto RAG injection before prompts; `knowledge_*` tools for AI CRUD.

**Important**: `@partme.ai/wecom` does **not** embed knowledge hooks — install `@partme.ai/openclaw-knowledge` separately.

`channels.wecom.knowledge.*` only works if the channel embeds `registerKnowledgeHooks`; not in current wecom source.

**Verify**: `openclaw run knowledge:stats`; test remember/recall in WeCom chat.

---

### 场景 10a — 动态 Agent + 出口代理 / Dynamic agents & egress proxy

#### 中文

**何时使用**：按用户/群隔离 Agent 实例；企业可信 IP / 错误 60020 需固定出口。

**解锁能力**：`wecom-dm-<userid>`、`wecom-group-<chatid>` 动态 Agent；管理员走主 Agent。

**前置条件**：熟悉 [场景 7](#场景-7--双模生产--dual-mode-production)–[场景 9](#场景-9--知识库--rag--knowledge--rag)。

**完整配置示例**

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "dynamicAgents": {
        "enabled": true,
        "dmCreateAgent": true,
        "groupEnabled": true,
        "adminUsers": ["admin_userid"]
      },
      "network": {
        "egressProxyUrl": "http://proxy.company.local:3128",
        "agentReplyTimeoutMs": 360000,
        "timeoutMs": 15000
      },
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": 1000002,
        "token": "<YOUR_TOKEN>",
        "encodingAESKey": "<YOUR_AES_KEY>"
      }
    }
  }
}
```

**字段说明**

| 字段 | 默认 | 说明 |
|------|------|------|
| `dynamicAgents.enabled` | `false` | 启用动态 Agent 路由 |
| `dynamicAgents.dmCreateAgent` | `true` | 私聊每用户独立 Agent |
| `dynamicAgents.groupEnabled` | `true` | 群聊启用动态 Agent |
| `dynamicAgents.adminUsers` | `[]` | 始终使用主 Agent 的管理员 userid |
| `network.egressProxyUrl` | — | 出口 HTTP 代理 |
| `network.timeoutMs` | — | 部分 HTTP 路径超时 |

动态 Agent ID 格式：`wecom-dm-<userid>`、`wecom-group-<chatid>`。

**验证步骤**

两名用户分别私聊，日志中 `agentId` / session 应不同；若曾遇 `60020`，配置代理后 Agent API 应恢复。

#### English

**When to use**: Per-user/per-group isolated agents; fixed egress for error 60020.

Agent ID format: `wecom-dm-<userid>`, `wecom-group-<chatid>`. `adminUsers` always use main agent.

**Verify**: Two users DM separately → different agent/session in logs.

---

### 场景 10b — Agent 语音 ASR / Agent voice ASR

#### 中文

**何时使用**：自建应用私聊收到语音消息，需腾讯云 Flash 识别后进入 Agent 推理。

**前置条件**：[场景 6](#场景-6--agent-模式--agent-mode) Agent 已配置；腾讯云 ASR 凭据。

**完整配置示例**

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": 1000002,
        "token": "<YOUR_TOKEN>",
        "encodingAESKey": "<YOUR_AES_KEY>",
        "asr": {
          "appId": "<TENCENT_APP_ID>",
          "secretId": "<TENCENT_SECRET_ID>",
          "secretKey": "<TENCENT_SECRET_KEY>",
          "engineType": "16k_zh",
          "voiceFormat": "amr"
        }
      }
    }
  }
}
```

**字段说明**

| 字段 | 说明 |
|------|------|
| `agent.asr.appId` | 腾讯云应用 ID |
| `agent.asr.secretId` / `secretKey` | 腾讯云 API 密钥 |
| `agent.asr.engineType` | 引擎，如 `16k_zh` |
| `agent.asr.voiceFormat` | 语音格式，企微多为 `amr` |

**验证步骤**

通过自建应用私聊发送语音 → 日志应显示 ASR 文本并进入 Agent 推理。

#### English

**When to use**: Transcribe voice messages in Agent DM via Tencent Cloud Flash ASR.

**Verify**: Send voice via self-built app → ASR text in logs → Agent processes text.

---

### 场景 10c — Bot Webhook 模式 / Bot webhook mode

#### 中文

**何时使用**：无法维持 WS 长连接、已有公网 URL 的场景（替代 WebSocket）。

**前置条件**：智能机器人回调 URL 指向 Gateway。

**完整配置示例**

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "webhook",
      "token": "<WEBHOOK_TOKEN>",
      "encodingAESKey": "<YOUR_43_CHAR_AES_KEY>",
      "receiveId": "<BOT_OR_CORP_ID>",
      "welcomeText": "欢迎通过 Webhook 接入。",
      "streamPlaceholderText": "1",
      "streaming": true
    }
  }
}
```

**字段说明**

| 字段 | 说明 |
|------|------|
| `connectionMode` | 设为 `"webhook"` |
| `token` | Webhook 验证 Token |
| `encodingAESKey` | 43 位 AES 密钥 |
| `receiveId` | 接收方 ID（解密校验） |
| `streamPlaceholderText` | 流式首帧占位，Webhook 默认常设为 `"1"` |

回调 URL：`https://<gateway-host>/plugins/wecom/bot/default`

Bot Webhook 有 **6 分钟**流式窗口；deadline 前 30s 自动回退 Agent（若已配置）。

**验证步骤**

企微后台保存 URL 后发送私聊；Gateway 日志出现 webhook 入站且无 WS 连接亦可回复。

#### English

**When to use**: Cannot maintain WS; have public URL for HTTP callback.

Callback: `https://<gateway-host>/plugins/wecom/bot/default`

**Verify**: Save URL in admin; DM works without WS connection in logs.

---

### 场景 11 — Cron 定时推送 / Cron scheduled delivery

#### 中文

**何时使用**：定时向部门/标签/用户/群推送消息（**必须配置 Agent**，Cron 走 Agent 出站）。

**完整配置示例**（WeCom 片段 + Cron CLI）

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": 1000002,
        "token": "<YOUR_TOKEN>",
        "encodingAESKey": "<YOUR_AES_KEY>"
      }
    }
  }
}
```

**出站目标格式（`delivery.to` / `--to`）**

| 格式 | 目标 | 示例 |
|------|------|------|
| `party:<id>` | 部门（所有成员） | `party:1` |
| `tag:<id>` | 标签组 | `tag:Ops` |
| `user:<id>` | 指定用户 | `user:zhangsan` |
| `group:<id>` / `chat:<id>` | 群聊 | `group:wr123abc` |
| 纯数字 | 自动识别为部门 | `1` → `party:1` |

命名空间前缀（`wecom:`、`qywx:` 等）解析前自动剥离。

**验证步骤**

```bash
openclaw cron add \
  --name "wecom-daily" \
  --agent main \
  --cron "0 9 * * 1-5" \
  --tz "Asia/Shanghai" \
  --message "今日简报" \
  --announce --channel wecom --to "party:1"
```

#### English

**When to use**: Scheduled push to party/tag/user/group — **Agent mode required**.

**Verify**: Run `openclaw cron add ... --channel wecom --to "party:1"`; message delivers at schedule.

---

## 附录 A — 未实现配置项 / Unimplemented keys

以下键在 TypeScript 类型中已定义，**运行时未接线**，请勿依赖。

| 配置键 | 状态 |
|--------|------|
| `media.tempDir` | 已定义，未接线 |
| `media.retentionHours` | 已定义，未接线 |
| `media.cleanupOnStart` | 已定义，未接线 |
| `network.retries` | 已定义，未接线 |
| `network.retryDelayMs` | 已定义，未接线 |
| `channels.wecom.knowledge.*`（无 knowledge 插件） | 不生效 |

## 附录 B — *Text 文案键参考 / *Text template keys

平铺在 `channels.wecom` 下（与 `welcomeText` 同层）。支持 `{elapsed}`、`{toolName}`、`{minutes}` 等占位符。

| 配置键 | 默认（节选） | 用途 |
|--------|-------------|------|
| `welcomeText` | （空） | enter_chat / subscribe 欢迎语 |
| `thinkingText` | `正在思考…` | 流式气泡状态栏 |
| `toolStatusText` | `正在查资料…` | 工具调用状态栏 `{toolName}` |
| `readingText` | — | 入站含附件 |
| `generatingText` | — | 开始生成答案 |
| `streamPlaceholderText` | 见下 | **协议层**首帧占位 |
| `emptyReplyText` | — | 空回复 |
| `timeoutText` | — | 超时 |
| `finishFooterText` | — | 关流脚注 `{elapsed}` |
| `mediaErrorNoAccessText` | — | 路径无权限 |

**`streamPlaceholderText` 与 `welcomeText` / `thinkingText` 的区别**

| 字段 | 层级 | 何时出现 |
|------|------|----------|
| `welcomeText` | 业务文案 | 用户**进入会话**（`enter_chat`） |
| `thinkingText` | 业务文案 | 回复进行中，stream 气泡**状态栏** |
| `streamPlaceholderText` | 协议占位 | Bot 流式**第一条** `replyStream` 的 `content`（不能为空） |

一般**不用改** `streamPlaceholderText`；欢迎语只用 `welcomeText`。

完整键名：`extensions/wecom/src/config/text-config.ts`（`WECOM_TEXT_KEY_MAPPING`）。

```bash
# 多账号：账号级 scalar 覆盖顶层
openclaw config set channels.wecom.accounts.bot2.thinkingText "Bot2 思考中…"
```

## 附录 C — 常见问题 / FAQ

### 报错 60020 / Error 60020

```
60020 not allow to access from your ip
```

**原因**：企业微信 API 限制来源 IP。**解决**：配置出口代理。

```bash
openclaw config set channels.wecom.network.egressProxyUrl "http://proxy.company.local:3128"
openclaw gateway restart
```

### 群聊发文件失败 / Group file send fails

企业微信 Bot 接口不支持在群内发送非图片文件。插件会自动通过 Agent **私信**发送，并在群里提示「文件已私信发给您」。需配置 [场景 6](#场景-6--agent-模式--agent-mode) 或 [场景 7](#场景-7--双模生产--dual-mode-production)。

### 快速 CLI 配置 / Quick CLI

**Bot 模式**

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.botId "<YOUR_BOT_ID>"
openclaw config set channels.wecom.secret "<YOUR_SECRET>"
openclaw gateway restart
```

**Agent 模式**

```bash
openclaw config set channels.wecom.agent.corpId "<CORP_ID>"
openclaw config set channels.wecom.agent.corpSecret "<SECRET>"
openclaw config set channels.wecom.agent.agentId 1000002
openclaw config set channels.wecom.agent.token "<TOKEN>"
openclaw config set channels.wecom.agent.encodingAESKey "<AES_KEY>"
openclaw gateway restart
```

**交互式向导**

```bash
openclaw channels add
```

---

## 配置源码索引 / Source of truth

| 模块 | 路径 |
|------|------|
| 主配置类型 | `extensions/wecom/src/config/wecom-config.ts` |
| 文案 *Text | `extensions/wecom/src/config/text-config.ts` |
| 流式 / footer | `extensions/wecom/src/config/streaming-config.ts` |
| 多账号 | `extensions/wecom/src/config/accounts.ts` |
| 动态 Agent | `extensions/wecom/src/config/dynamic-routing.ts` |
| 子结构类型 | `extensions/wecom/src/types/config.ts` |

**联调与测试**：[OpenClaw-WeCom-Testing.md](./OpenClaw-WeCom-Testing.md)

**架构总览**：[OpenClaw-WeCom-Architecture.md](./OpenClaw-WeCom-Architecture.md)
