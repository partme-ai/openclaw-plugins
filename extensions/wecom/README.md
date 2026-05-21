# 🤖 WeCom OpenClaw Plugin

**企业微信 channel plugin for [OpenClaw](https://github.com/partme-ai/openclaw)** — by PartMe.AI.

> 支持 **Bot 模式**（WebSocket 长连接 / HTTP Webhook JSON 回调）和 **Agent 模式**（HTTP Webhook XML 加密回调）。私聊、群聊、流式回复、主动消息、模板卡片。

---

📖 [企业微信智能机器人官方文档](https://open.work.weixin.qq.com/help?doc_id=21657)

## ✨ 功能特性

- 🔗 **双模式**: Bot（WebSocket / Webhook）和 Agent（HTTP 回调）可独立或组合运行
- 💬 支持私聊（DM）和群聊
- 📤 主动消息：可按用户、部门、标签、群聊精准推送
- 🖼️ 接收并处理图片、语音、视频、文件、**图文混排（mixed）** 消息，自动下载解密
- 🗣️ 语音转文字：自动提取语音消息中的识别文本
- 💬 引用消息：支持被引用的文本、图片、语音、文件消息
- ⏳ 流式回复，Bot 模式带"思考中"占位消息
- 🔐 Agent 模式：AES-256-CBC 加密 XML 回调 + SHA1 签名验证
- 📝 Markdown 格式回复
- 🃏 模板卡片消息（text_notice, news_notice, button_interaction, vote_interaction, multiple_interaction）及事件回调处理
- 🔒 内置访问控制：DM Policy（pairing / open / allowlist / disabled）和 Group Policy（open / allowlist / disabled）
- 🔑 命令授权：按账号控制命令权限，支持访问组
- 👥 多账号支持：独立 Bot/Agent 配置，互不干扰
- 🧩 MCP 工具集成（`wecom_mcp`），含拦截器管道（biz-error, media, smartpage-create, smartpage-export 等）
- 🎯 **10 个内置 Skills**：联系人、文档、待办、会议、日程、消息、-smartsheet、模板卡片等
- 🔀 动态 Agent 路由：按用户/群组自动创建隔离 Agent
- 📁 本地文件发送，可配置 mediaLocalRoots 白名单
- 📊 智能媒体大小限制与自动降级（图片 10MB → 文件、视频 10MB → 文件、语音 2MB/仅AMR → 文件，上限 20MB）
- 🔄 **Bot 优先、Agent 兜底** 的出站策略：Bot WS 不可用时自动回退到 Agent HTTP API
- ⚡ 自动心跳保活与重连（最多 10 次重连，5 次鉴权重试）
- 🛡️ 防互踢保护：服务端主动断连时不自动重启，避免互踢循环
- 🧙 交互式 CLI 配置向导

---

## 🚀 快速开始

### 环境要求

- Node.js >= 22.0.0
- OpenClaw >= 2026.4.12

### 安装

```shell
openclaw plugins install @partme.ai/wecom
```

### 配置

#### 方式一：交互式配置

```shell
openclaw channels add
```

按提示输入企业微信机器人的 **Bot ID** 和 **Secret**。

#### 方式二：CLI 快速配置

```shell
openclaw config set channels.wecom.botId <YOUR_BOT_ID>
openclaw config set channels.wecom.secret <YOUR_BOT_SECRET>
openclaw config set channels.wecom.enabled true
openclaw gateway restart
```

### 模式概览

插件支持两种连接模式，可独立或组合使用：

| 模式 | 连接方式 | 消息格式 | 适用场景 |
|------|---------|---------|---------|
| **Bot**（智能机器人） | WebSocket（默认）或 HTTP Webhook | JSON | 快速接入，流式回复 |
| **Agent**（自建应用） | HTTP Webhook 回调 | XML | 企业应用，API 驱动消息 |

> **说明**：Bot 模式通过 `connectionMode` 支持两种连接方式：
> - `websocket`（默认）— WebSocket 长连接，需 `botId` + `secret`
> - `webhook` — HTTP 回调，需 `token` + `encodingAESKey`

### Bot 模式配置

#### 核心设置

| 配置项 | 说明 | 可选值 | 默认值 |
|---|---|---|---|
| `channels.wecom.enabled` | 启用通道 | `true` / `false` | `false` |
| `channels.wecom.connectionMode` | Bot 连接模式 | `websocket` / `webhook` | `websocket` |
| `channels.wecom.name` | 账号显示名称 | — | `企业微信` |

#### WebSocket 模式（默认）

| 配置项 | 说明 | 可选值 | 默认值 |
|---|---|---|---|
| `channels.wecom.botId` | 企业微信机器人 ID | — | — |
| `channels.wecom.secret` | 企业微信机器人 Secret | — | — |
| `channels.wecom.websocketUrl` | WebSocket 端点 | — | `wss://openws.work.weixin.qq.com` |
| `channels.wecom.sendThinkingMessage` | 发送"思考中"占位消息 | `true` / `false` | `true` |

#### Webhook 模式（`connectionMode: "webhook"`）

| 配置项 | 说明 | 可选值 | 默认值 |
|---|---|---|---|
| `channels.wecom.token` | Webhook 验证 Token | — | — |
| `channels.wecom.encodingAESKey` | AES 加密密钥（43 位 Base64） | — | — |
| `channels.wecom.receiveId` | 接收者 ID（解密校验用） | — | — |
| `channels.wecom.welcomeText` | 进入聊天事件欢迎语 | — | — |
| `channels.wecom.streamPlaceholderContent` | 流式占位内容 | — | — |

#### 访问控制

| 配置项 | 说明 | 可选值 | 默认值 |
|---|---|---|---|
| `channels.wecom.dmPolicy` | 私聊访问策略 | `pairing` / `open` / `allowlist` / `disabled` | `open` |
| `channels.wecom.allowFrom` | 私聊白名单（用户 ID 列表） | — | `[]` |
| `channels.wecom.groupPolicy` | 群聊访问策略 | `open` / `allowlist` / `disabled` | `open` |
| `channels.wecom.groupAllowFrom` | 群聊白名单（群 ID 列表） | — | `[]` |
| `channels.wecom.groups` | 按群配置（如发送者白名单） | — | `{}` |

#### 媒体设置

| 配置项 | 说明 | 默认值 |
|---|---|---|
| `channels.wecom.mediaLocalRoots` | 媒体发送允许的额外本地路径（支持 `~`） | `[]` |
| `channels.wecom.media.maxBytes` | 最大媒体文件大小（字节） | `20971520`（20MB） |
| `channels.wecom.media.tempDir` | 媒体处理临时目录 | — |
| `channels.wecom.media.retentionHours` | 媒体文件保留时长（小时） | — |
| `channels.wecom.media.cleanupOnStart` | 启动时清理临时媒体文件 | — |

**媒体大小限制与自动降级：**

| 媒体类型 | 最大限制 | 降级行为 |
|---|---|---|
| 图片 | 10 MB | 超出 → 以文件形式发送 |
| 视频 | 10 MB | 超出 → 以文件形式发送 |
| 语音 | 2 MB（仅 AMR） | 非 AMR 格式或超出 → 以文件形式发送 |
| 文件 | 20 MB | 超出 → 拒绝发送 |

#### 网络设置

| 配置项 | 说明 | 默认值 |
|---|---|---|
| `channels.wecom.network.timeoutMs` | HTTP 请求超时（毫秒） | — |
| `channels.wecom.network.retries` | 重试次数 | — |
| `channels.wecom.network.retryDelayMs` | 重试间隔（毫秒） | — |
| `channels.wecom.network.egressProxyUrl` | 出口代理 URL（固定 IP 场景） | — |

> **出口代理优先级**：`channels.wecom.network.egressProxyUrl` > `OPENCLAW_WECOM_EGRESS_PROXY_URL` > `WECOM_EGRESS_PROXY_URL` > `HTTPS_PROXY` > `ALL_PROXY` > `HTTP_PROXY`

### Agent 模式配置

Agent 模式使用 HTTP Webhook 回调，消息体为 XML 加密格式。需在企业微信管理后台「API 接收消息」中配置回调 URL。

#### 前置条件

1. 在[企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame#apps)创建自建应用
2. 记录 **CorpID**、**CorpSecret**（应用凭证）和 **AgentId**
3. 在应用设置 →「API 接收消息」中：
   - 记录 **Token** 和 **EncodingAESKey**（自动生成或自定义）
   - **先不要点击保存** — 保存时企微会立即验证回调 URL

#### 配置步骤

> **重要**：必须先配置 Gateway，再在企微后台保存回调 URL。企微保存时会立即发送 GET 请求（带 `echostr` 参数）验证，Gateway 需要 `token` 和 `encodingAESKey` 才能正确解密并响应。

**第一步：配置 Gateway**

```shell
openclaw config set channels.wecom.agent.corpId <YOUR_CORP_ID>
openclaw config set channels.wecom.agent.corpSecret <YOUR_CORP_SECRET>
openclaw config set channels.wecom.agent.agentId <YOUR_AGENT_ID>
openclaw config set channels.wecom.agent.token <YOUR_CALLBACK_TOKEN>
openclaw config set channels.wecom.agent.encodingAESKey <YOUR_ENCODING_AES_KEY>
openclaw config set channels.wecom.enabled true
openclaw gateway restart
```

**第二步：在企微后台保存回调 URL**

回到「API 接收消息」设置，填入回调 URL：
- **URL**：`https://<your-gateway-host>/plugins/wecom/agent/<accountId>`（如 `/plugins/wecom/agent/default`）；单账号模式也可使用 `/plugins/wecom/agent`

点击保存 — 验证应通过。

#### JSON 配置示例

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "your-corp-secret",
        "agentId": 1000002,
        "token": "your-callback-token",
        "encodingAESKey": "your-encoding-aes-key-43-chars"
      }
    }
  }
}
```

#### Agent 配置参考

| 配置项 | 说明 | 必填 |
|---|---|---|
| `channels.wecom.agent.corpId` | 企业 Corp ID | 是 |
| `channels.wecom.agent.corpSecret` | 应用 Secret | 是 |
| `channels.wecom.agent.agentId` | 应用 Agent ID | 否（主动发消息时需要） |
| `channels.wecom.agent.token` | 回调验证 Token | 是 |
| `channels.wecom.agent.encodingAESKey` | 回调加密密钥（43 位） | 是 |
| `channels.wecom.agent.welcomeText` | 欢迎语 | 否 |
| `channels.wecom.agent.dmPolicy` | DM 访问策略（覆盖顶层） | 否 |
| `channels.wecom.agent.allowFrom` | DM 白名单（覆盖顶层） | 否 |

#### Webhook 路径

**Agent 模式：**

| 路径 | 说明 |
|---|---|
| `/plugins/wecom/agent/<accountId>` | 推荐路径（如 `/plugins/wecom/agent/default`） |
| `/plugins/wecom/agent/default` | 多账号模式下自动路由到默认账号 |
| `/plugins/wecom/agent` | 兼容路径（单账号 / 多账号签名匹配） |
| `/wecom/agent` | 旧版兼容路径 |

**Bot Webhook 模式**（`connectionMode: "webhook"`）：

| 路径 | 说明 |
|---|---|
| `/plugins/wecom/bot` | 推荐路径（单账号） |
| `/plugins/wecom/bot/<accountId>` | 多账号路径 |
| `/wecom/bot` | 旧版兼容路径 |
| `/wecom` | 旧版兼容路径 |

### 出站投递（Bot WS → Agent HTTP 兜底）

插件采用 **Bot 优先、Agent 兜底** 的出站策略：

1. **Bot WebSocket 可用** → 通过 WS 发送（支持 Markdown、流式）
2. **Bot WS 不可用** → 自动回退到 **Agent HTTP API**（`cgi-bin/message/send`）

这意味着：
- **纯 Agent 账号**（未配置 Bot）仍可发送主动消息、定时任务和广播
- **目标格式**如 `party:1`、`tag:Ops`、`user:zhangsan` 在两条路径中均完全支持
- **媒体兜底**：Bot WS 不可用时，媒体文件会被下载、通过 Agent API 上传到企微后发送；上传失败则降级为文本 + URL
- 无需手动切换 — 插件透明处理回退

### 双模式组合使用

Bot 和 Agent 可在同一账号同时运行。Bot 处理 WebSocket 流式消息；Agent 处理 HTTP Webhook 回调及 API 驱动的主动消息。

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "botId": "your-bot-id",
      "secret": "your-bot-secret",
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "your-corp-secret",
        "agentId": 1000002,
        "token": "your-callback-token",
        "encodingAESKey": "your-encoding-aes-key-43-chars"
      }
    }
  }
}
```

### 多账号配置

通过 `accounts` 配置多个企业微信账号，每个可独立配置 Bot 和/或 Agent。账号级字段覆盖顶层同名字段。

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "main",
      "dmPolicy": "open",
      "accounts": {
        "main": {
          "botId": "bot-id-1",
          "secret": "secret-1",
          "agent": {
            "corpId": "ww1234567890abcdef",
            "corpSecret": "secret-a",
            "agentId": 1000002,
            "token": "token-a",
            "encodingAESKey": "aes-key-a"
          }
        },
        "support": {
          "dmPolicy": "allowlist",
          "allowFrom": ["admin1"],
          "agent": {
            "corpId": "ww1234567890abcdef",
            "corpSecret": "secret-b",
            "agentId": 1000003,
            "token": "token-b",
            "encodingAESKey": "aes-key-b"
          }
        }
      }
    }
  }
}
```

> **注意**：多账号模式下，需为每个账号配置 bindings：
> ```json
> {
>   "bindings": [
>     { "agentId": "your-agent", "match": { "channel": "wecom", "accountId": "main" } }
>   ]
> }
> ```

### 动态 Agent 配置

动态 Agent 路由可为每个用户或群组自动创建隔离的 Agent 实例，实现会话隔离。

```json
{
  "channels": {
    "wecom": {
      "dynamicAgents": {
        "enabled": true,
        "dmCreateAgent": true,
        "groupEnabled": true,
        "adminUsers": ["admin_user_id"]
      }
    }
  }
}
```

| 配置项 | 说明 | 默认值 |
|---|---|---|
| `channels.wecom.dynamicAgents.enabled` | 启用动态 Agent 路由 | `false` |
| `channels.wecom.dynamicAgents.dmCreateAgent` | 为每个私聊用户创建隔离 Agent | `true` |
| `channels.wecom.dynamicAgents.groupEnabled` | 为群聊启用动态 Agent | `true` |
| `channels.wecom.dynamicAgents.adminUsers` | 管理员用户（绕过动态路由，使用主 Agent） | `[]` |

---

## 🔒 访问控制

### 私聊（DM）访问

**默认**：`dmPolicy: "open"` — 所有用户可自由发送私聊消息，无需审批。

#### 配对审批

```shell
openclaw pairing list wecom            # 查看待审批的配对请求
openclaw pairing approve wecom <CODE>  # 批准配对请求
```

#### 白名单模式

通过 `channels.wecom.allowFrom` 配置允许的用户 ID：

```json
{
  "channels": {
    "wecom": {
      "dmPolicy": "allowlist",
      "allowFrom": ["user_id_1", "user_id_2"]
    }
  }
}
```

#### 开放模式

设置 `dmPolicy: "open"` 允许所有用户发私聊，无需审批。

#### 禁用模式

设置 `dmPolicy: "disabled"` 完全禁止所有私聊消息。

### 群聊访问

#### 群聊策略（`channels.wecom.groupPolicy`）

- `"open"` — 允许所有群消息（默认）
- `"allowlist"` — 仅允许 `groupAllowFrom` 中列出的群
- `"disabled"` — 禁用所有群消息

### 群配置示例

#### 允许所有群（默认行为）

```json
{
  "channels": {
    "wecom": {
      "groupPolicy": "open"
    }
  }
}
```

#### 仅允许特定群

```json
{
  "channels": {
    "wecom": {
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["group_id_1", "group_id_2"]
    }
  }
}
```

#### 限制群内特定发送者（发送者白名单）

除了群白名单，还可限制群内哪些成员可以与机器人交互。只有 `groups.<chatId>.allowFrom` 中列出的用户的消息才会被处理；其他成员的消息将被静默忽略。这是应用于**所有消息**的发送者级白名单。

```json
{
  "channels": {
    "wecom": {
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["group_id_1"],
      "groups": {
        "group_id_1": {
          "allowFrom": ["user_id_1", "user_id_2"]
        }
      }
    }
  }
}
```

---

## ⏰ 定时任务（Cronjob）

插件支持通过 OpenClaw 内置 Cron 服务进行定时消息投递。Cron 任务走 **Agent 出站通道**，因此必须配置 Agent 模式。

### 目标格式

`delivery.to` 字段支持以下目标格式：

| 格式 | 目标 | 示例 |
|------|------|------|
| `party:<id>` | 部门（所有成员） | `party:1`（根部门 = 全员） |
| `dept:<id>` | 部门（party 别名） | `dept:5` |
| `tag:<id>` | 标签组 | `tag:Ops` |
| `user:<id>` | 指定用户 | `user:zhangsan` |
| `group:<id>` | 外部群聊 | `group:wr123abc` |
| `chat:<id>` | 群聊（group 别名） | `chat:wc456def` |
| 纯数字 | 自动识别为部门 | `1` → `party:1` |
| `wr...` / `wc...` | 自动识别为群聊 | `wr123` → `chatid` |
| 其他字符串 | 自动识别为用户 | `zhangsan` → `touser` |

> **命名空间前缀**（`wecom:`、`qywx:`、`wework:`、`wechatwork:`、`wecom-agent:`）在解析前自动剥离。

### 方式一：CLI（推荐 — 即时生效）

```shell
openclaw cron add \
  --name "daily-report" \
  --agent main \
  --cron "0 9 * * 1-5" \
  --tz "Asia/Shanghai" \
  --message "早上好！这是今日简报。" \
  --announce \
  --channel wecom \
  --to "party:1"
```

> **说明**：`--announce` 启用投递模式（将 AI 回复广播到目标聊天）。使用 `--no-deliver` 可将输出保留在内部。已弃用的 `--deliver` 是 `--announce` 的别名。

常用 CLI 命令：

```shell
openclaw cron list              # 列出所有 cron 任务
openclaw cron show <id>         # 查看任务详情
openclaw cron enable <id>       # 启用任务
openclaw cron disable <id>      # 禁用任务
openclaw cron remove <id>       # 删除任务
openclaw cron run <id>          # 手动触发任务
openclaw cron runs --id <id>    # 查看运行历史
openclaw cron edit <id> --message "New prompt"  # 编辑任务
```

### 方式二：编辑 `jobs.json`（需重启 Gateway）

文件路径：`~/.openclaw/cron/jobs.json`

```json
{
  "version": 1,
  "jobs": [
    {
      "id": "daily-report",
      "name": "Daily Report",
      "agentId": "main",
      "enabled": true,
      "schedule": { "kind": "cron", "expr": "0 9 * * 1-5", "tz": "Asia/Shanghai" },
      "sessionTarget": "isolated",
      "wakeMode": "now",
      "payload": {
        "kind": "agentTurn",
        "message": "Generate today's briefing and send it."
      },
      "delivery": {
        "mode": "announce",
        "channel": "wecom",
        "to": "party:1",
        "accountId": "main"
      },
      "state": {}
    }
  ]
}
```

编辑后重启 Gateway：

```shell
openclaw gateway restart
```

### 方式三：对话创建（即时生效）

可直接在企业微信对话中让 AI Agent 创建定时任务：

> "创建一个定时任务：每天早上 9 点向全公司发送今日简报"

Agent 将调用 Cron API 创建任务 — 无需重启。

### 注意事项

- Cron 任务走 **Agent 出站通道** — 必须配置 Agent 模式（`corpId` / `corpSecret` / `agentId`）。
- 服务器 IP 需在企业微信可信 IP 白名单中，或配置 `egressProxyUrl` 使用固定出口代理。
- 通过 CLI 或对话 API 创建的任务即时生效。手动编辑 `jobs.json` 需 `openclaw gateway restart`。
- 多账号场景下，设置 `delivery.accountId` 指定目标账号（如 `"main"`、`"support"`）。

---

## 🛠️ 开发

```bash
pnpm build          # tsc → dist/
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run（279 个测试用例）
pnpm run pack-dry   # 预览发布包内容
```

---

## 📦 更新

```shell
openclaw plugins update @partme.ai/wecom
```

---

## 📄 License

ISC
