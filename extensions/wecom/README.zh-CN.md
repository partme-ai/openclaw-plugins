# WeCom (WeChat Work / 企业微信)

**OpenClaw 渠道插件 -- 企业微信 Bot + Agent 双模式深度集成**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fwecom-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-ISC-green)

[English](./README.en.md) | [简体中文](./README.md)

---

## 功能特性

- **双模式架构**：Bot（WebSocket 长连接 / HTTP Webhook JSON 回调）和 Agent（HTTP Webhook XML 加密回调）可独立或组合运行
- **消息类型全覆盖**：文本、图片、语音、视频、文件、图文混排（mixed），自动下载解密
- **语音转文字**：自动提取语音消息中的识别文本
- **引用消息**：支持被引用的文本、图片、语音、文件消息
- **流式回复**：Bot 模式带"思考中"占位消息
- **Agent 模式**：AES-256-CBC 加密 XML 回调 + SHA1 签名验证
- **Markdown 格式回复**
- **模板卡片消息**：text_notice、news_notice、button_interaction、vote_interaction、multiple_interaction 及事件回调处理
- **内置访问控制**：DM Policy（pairing / open / allowlist / disabled）和 Group Policy（open / allowlist / disabled）
- **命令授权**：按账号控制命令权限，支持访问组
- **多账号支持**：独立 Bot / Agent 配置，互不干扰，支持账号级字段覆盖
- **MCP 工具集成**（`wecom_mcp`），含拦截器管道（biz-error, media, smartpage-create, smartpage-export 等）
- **10 个内置 Skills**：联系人、文档、待办、会议、日程、消息、smartsheet、模板卡片等
- **动态 Agent 路由**：按用户 / 群组自动创建隔离 Agent 实例
- **本地文件发送**：可配置 `mediaLocalRoots` 白名单
- **智能媒体降级**：图片 10MB -> 文件、视频 10MB -> 文件、语音 2MB/仅AMR -> 文件，上限 20MB
- **Bot 优先、Agent 兜底** 的出站策略：Bot WS 不可用时自动回退到 Agent HTTP API
- **自动心跳保活与重连**（最多 10 次重连，5 次鉴权重试）
- **防互踢保护**：服务端主动断连时不自动重启，避免互踢循环
- **交互式 CLI 配置向导**

## 快速开始

### 环境要求

- Node.js >= 22.0.0
- OpenClaw >= 2026.4.12

### 安装

```bash
openclaw plugins install @partme.ai/wecom
```

最低依赖：`@partme.ai/openclaw-message-sdk >= 2026.5.22`。

### 配置

#### 方式一：交互式配置

```bash
openclaw channels add
```

按提示输入企业微信机器人的 Bot ID 和 Secret。

#### 方式二：CLI 快速配置

```bash
openclaw config set channels.wecom.botId <YOUR_BOT_ID>
openclaw config set channels.wecom.secret <YOUR_BOT_SECRET>
openclaw config set channels.wecom.enabled true
openclaw gateway restart
```

### 模式概览

| 模式 | 连接方式 | 消息格式 | 适用场景 |
|------|---------|---------|---------|
| **Bot**（智能机器人） | WebSocket（默认）或 HTTP Webhook | JSON | 快速接入，流式回复 |
| **Agent**（自建应用） | HTTP Webhook 回调 | XML | 企业应用，API 驱动消息 |

> Bot 模式通过 `connectionMode` 支持两种连接方式：
> - `websocket`（默认）-- WebSocket 长连接，需 `botId` + `secret`
> - `webhook` -- HTTP 回调，需 `token` + `encodingAESKey`

### Bot 模式配置

#### 核心设置

| 配置项 | 说明 | 可选值 | 默认值 |
|--------|------|--------|--------|
| `channels.wecom.enabled` | 启用通道 | `true` / `false` | `false` |
| `channels.wecom.connectionMode` | Bot 连接模式 | `websocket` / `webhook` | `websocket` |
| `channels.wecom.name` | 账号显示名称 | - | `企业微信` |

#### WebSocket 模式（默认）

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `channels.wecom.botId` | 企业微信机器人 ID | - |
| `channels.wecom.secret` | 企业微信机器人 Secret | - |
| `channels.wecom.websocketUrl` | WebSocket 端点 | `wss://openws.work.weixin.qq.com` |
| `channels.wecom.sendThinkingMessage` | 发送"思考中"占位消息 | `true` |

#### Webhook 模式（`connectionMode: "webhook"`）

| 配置项 | 说明 |
|--------|------|
| `channels.wecom.token` | Webhook 验证 Token |
| `channels.wecom.encodingAESKey` | AES 加密密钥（43 位 Base64） |
| `channels.wecom.receiveId` | 接收者 ID（解密校验用） |
| `channels.wecom.welcomeText` | 进入聊天事件欢迎语 |
| `channels.wecom.streamPlaceholderContent` | 流式占位内容 |

#### 访问控制

| 配置项 | 说明 | 可选值 | 默认值 |
|--------|------|--------|--------|
| `channels.wecom.dmPolicy` | 私聊访问策略 | `pairing` / `open` / `allowlist` / `disabled` | `open` |
| `channels.wecom.allowFrom` | 私聊白名单（用户 ID 列表） | - | `[]` |
| `channels.wecom.groupPolicy` | 群聊访问策略 | `open` / `allowlist` / `disabled` | `open` |
| `channels.wecom.groupAllowFrom` | 群聊白名单（群 ID 列表） | - | `[]` |
| `channels.wecom.groups` | 按群配置（如发送者白名单） | - | `{}` |

#### 媒体设置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `channels.wecom.mediaLocalRoots` | 媒体发送允许的额外本地路径（支持 `~`） | `[]` |
| `channels.wecom.media.maxBytes` | 最大媒体文件大小（字节） | `20971520`（20MB） |
| `channels.wecom.media.tempDir` | 媒体处理临时目录 | - |
| `channels.wecom.media.retentionHours` | 媒体文件保留时长（小时） | - |
| `channels.wecom.media.cleanupOnStart` | 启动时清理临时媒体文件 | - |

**媒体大小限制与自动降级：**

| 媒体类型 | 最大限制 | 降级行为 |
|----------|----------|----------|
| 图片 | 10 MB | 超出 -> 以文件形式发送 |
| 视频 | 10 MB | 超出 -> 以文件形式发送 |
| 语音 | 2 MB（仅 AMR） | 非 AMR 格式或超出 -> 以文件形式发送 |
| 文件 | 20 MB | 超出 -> 拒绝发送 |

#### 网络设置

| 配置项 | 说明 |
|--------|------|
| `channels.wecom.network.timeoutMs` | HTTP 请求超时（毫秒） |
| `channels.wecom.network.retries` | 重试次数 |
| `channels.wecom.network.retryDelayMs` | 重试间隔（毫秒） |
| `channels.wecom.network.egressProxyUrl` | 出口代理 URL（固定 IP 场景） |

> **出口代理优先级**：`channels.wecom.network.egressProxyUrl` > `OPENCLAW_WECOM_EGRESS_PROXY_URL` > `WECOM_EGRESS_PROXY_URL` > `HTTPS_PROXY` > `ALL_PROXY` > `HTTP_PROXY`

### Agent 模式配置

Agent 模式使用 HTTP Webhook 回调，消息体为 XML 加密格式。需在企业微信管理后台「API 接收消息」中配置回调 URL。

#### 前置条件

1. 在[企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame#apps)创建自建应用
2. 记录 **CorpID**、**CorpSecret**（应用凭证）和 **AgentId**
3. 在应用设置 ->「API 接收消息」中：记录 **Token** 和 **EncodingAESKey**

#### 配置步骤

> **重要**：必须先配置 Gateway，再在企微后台保存回调 URL。

**第一步：配置 Gateway**

```bash
openclaw config set channels.wecom.agent.corpId <YOUR_CORP_ID>
openclaw config set channels.wecom.agent.corpSecret <YOUR_CORP_SECRET>
openclaw config set channels.wecom.agent.agentId <YOUR_AGENT_ID>
openclaw config set channels.wecom.agent.token <YOUR_CALLBACK_TOKEN>
openclaw config set channels.wecom.agent.encodingAESKey <YOUR_ENCODING_AES_KEY>
openclaw config set channels.wecom.enabled true
openclaw gateway restart
```

**第二步：在企微后台保存回调 URL**

URL：`https://<your-gateway-host>/plugins/wecom/agent/<accountId>`

#### Agent 配置参考

| 配置项 | 说明 | 必填 |
|--------|------|------|
| `channels.wecom.agent.corpId` | 企业 Corp ID | 是 |
| `channels.wecom.agent.corpSecret` | 应用 Secret | 是 |
| `channels.wecom.agent.agentId` | 应用 Agent ID | 否（主动发消息时需要） |
| `channels.wecom.agent.token` | 回调验证 Token | 是 |
| `channels.wecom.agent.encodingAESKey` | 回调加密密钥（43 位） | 是 |
| `channels.wecom.agent.welcomeText` | 欢迎语 | 否 |
| `channels.wecom.agent.dmPolicy` | DM 访问策略（覆盖顶层） | 否 |
| `channels.wecom.agent.allowFrom` | DM 白名单（覆盖顶层） | 否 |

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
          "agent": { ... }
        },
        "support": {
          "dmPolicy": "allowlist",
          "allowFrom": ["admin1"],
          "agent": { ... }
        }
      }
    }
  }
}
```

### 动态 Agent 配置

动态 Agent 路由可为每个用户或群组自动创建隔离的 Agent 实例：

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
|--------|------|--------|
| `channels.wecom.dynamicAgents.enabled` | 启用动态 Agent 路由 | `false` |
| `channels.wecom.dynamicAgents.dmCreateAgent` | 为每个私聊用户创建隔离 Agent | `true` |
| `channels.wecom.dynamicAgents.groupEnabled` | 为群聊启用动态 Agent | `true` |
| `channels.wecom.dynamicAgents.adminUsers` | 管理员用户（绕过动态路由，使用主 Agent） | `[]` |

## 访问控制

### 私聊（DM）访问

**默认**：`dmPolicy: "open"` -- 所有用户可自由发送私聊消息。

- **配对审批**：`openclaw pairing list wecom` / `openclaw pairing approve wecom <CODE>`
- **白名单模式**：通过 `channels.wecom.allowFrom` 配置允许的用户 ID
- **开放模式**：`dmPolicy: "open"` 允许所有用户
- **禁用模式**：`dmPolicy: "disabled"` 完全禁止私聊

### 群聊访问

- `"open"` -- 允许所有群消息（默认）
- `"allowlist"` -- 仅允许 `groupAllowFrom` 中列出的群
- `"disabled"` -- 禁用所有群消息

支持群内发送者白名单：`groups.<chatId>.allowFrom` 限制群内哪些成员可以与机器人交互。

## 定时任务（Cronjob）

插件支持通过 OpenClaw 内置 Cron 服务进行定时消息投递。Cron 任务走 Agent 出站通道，因此必须配置 Agent 模式。

### 目标格式

`delivery.to` 字段支持以下格式：

| 格式 | 目标 | 示例 |
|------|------|------|
| `party:<id>` | 部门（所有成员） | `party:1` |
| `tag:<id>` | 标签组 | `tag:Ops` |
| `user:<id>` | 指定用户 | `user:zhangsan` |
| `group:<id>` / `chat:<id>` | 群聊 | `group:wr123abc` |
| 纯数字 | 自动识别为部门 | `1` -> `party:1` |

> 命名空间前缀（`wecom:`、`qywx:`、`wework:`、`wechatwork:`、`wecom-agent:`）在解析前自动剥离。

### 创建方式

**CLI（推荐，即时生效）：**

```bash
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

**编辑 `jobs.json`（需重启 Gateway）：** 文件路径 `~/.openclaw/cron/jobs.json`

**对话创建：** 在企微对话中让 AI Agent 直接创建，如"每天早上 9 点向全公司发送今日简报"。

## 开发

```bash
pnpm build          # tsc -> dist/
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run（279 个测试用例）
pnpm run pack-dry   # 预览发布包内容
```

## 更新

```bash
openclaw plugins update @partme.ai/wecom
```

## 技术详情

### 安全机制

- **签名验证**：SHA1(token, timestamp, nonce, encrypt) 验证回调真实性
- **加密标准**：AES-256-CBC + PKCS#7 填充（32 字节块）
- **Webhook 路径**：`/wecom`（旧版）、`/wecom/bot`、`/wecom/agent`、`/plugins/wecom/bot/*`、`/plugins/wecom/agent/*`

### 超时处理

Bot webhook 模式有 6 分钟窗口（360s）用于流式回复。插件在 deadline 前 30s 自动回退到 Agent 模式。

### 媒体处理

- 入站：AES-256-CBC 解密企业微信加密媒体 URL
- 出站图片：通过 `msg_item` 以 base64 形式在流中发送
- 出站文件：需 Agent 模式，通过 `media/upload` + `message/send` 发送

### 代理支持

对于动态 IP 服务器（常见错误：`60020 not allow to access from your ip`）：

```bash
openclaw config set channels.wecom.network.egressProxyUrl "http://proxy.company.local:3128"
```

### 依赖项

- `@partme.ai/openclaw-message-sdk`：共享消息类型与工具
- `@wecom/aibot-node-sdk`：官方 WeCom Bot WebSocket SDK + 加密库
- `undici`：HTTP 客户端（支持代理）
- `fast-xml-parser`：XML 解析
- `file-type`：MIME 类型检测
- `zod`：配置验证

## 关于 openclaw-plugins

本插件属于 [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) 的一部分。该仓库是由 **PartMe.AI 团队** 开发和维护的企业级 OpenClaw 插件集合，涵盖 27+ 个插件，覆盖 IM 渠道、消息队列、AI 能力和基础设施。

每个插件在 npm 上独立发布，位于 `@partme.ai` 作用域下：

```bash
openclaw plugins install @partme.ai/nacos
openclaw plugins install @partme.ai/wecom
```

**PartMe.AI** 专注于 AI 客服与企业级 AI Agent 基础设施，提供从企业微信 / 钉钉 / 飞书 / QQ 渠道集成到 RAG 知识库、多层记忆和生产监控的端到端解决方案。

> 联系方式：partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)

## 许可证

ISC
