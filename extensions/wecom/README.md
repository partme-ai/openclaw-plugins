<div align="center">

# OpenClaw WeCom

**OpenClaw 企业微信渠道插件：Bot WebSocket、Bot Webhook 与自建应用 Agent 双模集成**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fwecom-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-ISC-green)

[简体中文](./README.md) | [English](./README.en.md)

</div>

`@partme.ai/wecom` 用于把 OpenClaw 接入企业微信。它面向中国企业微信用户，支持智能机器人 Bot WebSocket、Bot HTTP Webhook 和自建应用 Agent 三条路径：Bot 负责低门槛交互式对话与流式回复，Agent 负责主动推送、Cron 定时投递、部门/标签广播和完整文件兜底。

当前版本：`2026.5.25`。依赖 `@partme.ai/openclaw-message-sdk`：`2026.5.24`。`pnpm test` 当前约 330 个 Vitest 用例，数量会随源码覆盖变化。

## ✨ 核心能力

`@partme.ai/wecom` 已吸收研究版 WeCom 插件能力，并按当前 OpenClaw 插件实现统一到 `channels.wecom` 平铺配置。中文 README 是主文档；英文 README 跟随本页事实同步维护。

- 🔗 **双模式**：Bot（WebSocket / Webhook）与 Agent（HTTP webhook）可以独立运行，也可以同时启用。
- 💬 同时支持私聊（DM）和群聊。
- 📤 支持向指定用户、群聊、部门或标签主动推送消息。
- 🖼️ 接收并处理图片、语音、视频、文件和 **mixed（图文混排）** 消息；在入站路径支持媒体访问时自动下载。
- 🗣️ 语音转文字：Agent ASR 开启时自动提取语音消息转写文本。
- 💬 引用消息支持：处理被引用的文本、图片、语音和文件消息。
- ⏳ Bot 模式支持带「thinking」占位消息的流式回复。
- 🔐 Agent 模式支持 AES-256-CBC 加密 XML 回调，并进行 SHA1 签名校验。
- 📝 支持 Markdown / 文本格式回复；Agent HTTP 文本发送会剥离 Markdown 为纯文本，富文本展示取决于实际出站路径和企业微信客户端。
- 🃏 支持模板卡片消息（`text_notice`、`news_notice`、`button_interaction`、`vote_interaction`、`multiple_interaction`），并处理 **事件回调**。
- 🔒 内置访问控制：私聊策略（`pairing` / `open` / `allowlist` / `disabled`）和群聊策略（`open` / `allowlist` / `disabled`）。
- 🔑 命令授权：支持按账号控制命令权限，并支持访问组。
- 👥 多账号支持：可运行多个企业微信账号，每个账号拥有独立 Bot / Agent 配置。
- 🧩 MCP 工具集成（`wecom_mcp`），包含拦截器管道（`biz-error`、`doc-auth-error`、`msg-media`、`smartpage-create`、`smartpage-export`、`smartsheet-upload`）。
- 🎯 **11 个内置 Skill 包**：媒体发送、模板卡片、联系人查询、文档管理、待办、会议、日程、消息、smartsheet、预检和统一企业微信操作。
- 🔀 动态 Agent 路由：按用户 / 群自动创建隔离 Agent。
- 📁 本地文件发送支持可配置的媒体路径白名单（`mediaLocalRoots`）。
- 📊 智能媒体大小限制与自动降级（图片 10MB → 文件，视频 10MB → 文件，语音 2MB / 仅 AMR → 文件，文件最大 20MB）。
- 🔄 **Bot 优先、Agent 兜底** 出站投递：Bot WS 不可用时自动回退到 Agent HTTP API。
- ⚡ 自动心跳保活与重连（最多 10 次重连尝试，5 次鉴权失败重试）。
- 🛡️ 反踢保护：服务端断开连接时抑制自动重启，避免互踢循环。

能力边界：

| 能力 | Bot WebSocket | Bot Webhook | Agent 自建应用 |
|------|---------------|-------------|----------------|
| 私聊 / 群聊入站 | 支持 | 支持 | 支持自建应用回调 |
| 流式回复 | 优先支持 | 支持 Webhook stream 路径 | 以 API 发送最终消息为主 |
| 主动推送 | 支持已连接会话 | 不推荐作为主路径 | 支持用户、部门、标签、群聊 |
| Cron 定时投递 | 可作为会话入口 | 不推荐作为主路径 | 推荐，依赖 `agent.agentId` |
| 媒体与文件兜底 | 支持常见媒体限制 | 支持常见媒体限制 | 推荐用于文件上传和兜底 |
| 企业微信可信 IP | 通常不需要 | 回调需公网可达 | 调 API 需可信出口 IP 或代理 |

## 重要事实

- 只要同一账号存在 `botId` + `secret`，运行时优先启动 Bot WebSocket；即使 `connectionMode` 写成 `webhook` 也会走 WS。纯 Bot Webhook 请不要配置 `botId` 和 `secret`。
- `agent.agentId` 是主动推送、Cron 和 Agent 兜底投递的必填字段。
- Bot WebSocket 主动发送使用企业微信原始 `userid`，不要带 `user:` 前缀，否则可能触发 `93006 invalid chatid`。
- Bot stream 是纯文本流式载体；Markdown 是否展示为富文本取决于实际出站路径与企业微信客户端。

## 架构与投递优先级

`@partme.ai/wecom` 是 OpenClaw Gateway 的渠道插件。入站消息先被规范化为 OpenClaw 消息模型，再交给绑定的 Agent 或动态 Agent；出站消息再按当前账号能力选择 Bot WS 或 Agent API。

```text
WeCom Bot WS / Bot Webhook / Agent Webhook
        ↓
WeCom channel runtime
        ↓
OpenClaw message-sdk normalization
        ↓
Agent binding / Dynamic Agent routing / MCP tools
        ↓
Outbound delivery: Bot WS first, Agent HTTP fallback
```

出站投递顺序：

1. 同一账号 Bot WebSocket 在线时，优先通过 WS 发送，适合交互式回复和流式体验。
2. Bot WS 不可用且 `agent.*` 已配置时，使用 Agent HTTP API 兜底，适合主动消息、Cron、部门/标签广播和文件。
3. 媒体上传失败时，插件会尽量降级为文件或文本链接；仍需遵守企业微信的文件大小和类型限制。

## 安装与更新

```bash
openclaw plugins install @partme.ai/wecom
openclaw plugins update @partme.ai/wecom
```

本地开发安装如果被插件安全扫描拦截，请先确认来源可信，再使用：

```bash
openclaw plugins install @partme.ai/wecom@latest --dangerously-force-unsafe-install
```

## 快速开始：Bot WebSocket

适合最快接入私聊/群聊和流式对话，不需要公网回调地址。

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.connectionMode websocket
openclaw config set channels.wecom.botId "<YOUR_BOT_ID>"
openclaw config set channels.wecom.secret "<YOUR_BOT_SECRET>"
openclaw gateway restart
openclaw channels status --probe
```

最小 JSON：

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

在企业微信里向智能机器人发送 `你好`。Gateway 日志应出现 WebSocket 连接和鉴权成功，随后收到 Agent 回复。

## 生产双模配置

需要 Bot 流式对话 + Agent 主动推送/文件兜底/Cron 时使用：

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "streaming": true,
      "footer": {
        "status": true,
        "elapsed": true
      },
      "sendThinkingMessage": true,
      "streamPlaceholderText": "1",
      "mediaLocalRoots": ["/data/wecom-media"],
      "media": {
        "maxBytes": 20971520
      },
      "agent": {
        "corpId": "<YOUR_CORP_ID>",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": "<YOUR_AGENT_ID>",
        "token": "<YOUR_CALLBACK_TOKEN>",
        "encodingAESKey": "<YOUR_43_CHAR_ENCODING_AES_KEY>"
      },
      "network": {
        "agentReplyTimeoutMs": 360000,
        "egressProxyUrl": "http://proxy.company.local:3128"
      }
    }
  }
}
```

如果不需要固定出口代理，请删除 `network.egressProxyUrl`。不要把真实企业微信密钥提交到仓库。

## 模式总览

插件支持 Bot WebSocket、Bot Webhook、Agent 自建应用三类连接路径。它们可以独立使用，也可以组合成生产双模：Bot 负责低延迟聊天和流式体验，Agent 负责企业微信 API 出站、Cron、部门/标签广播和媒体兜底。

| 模式 | 连接方式 | 消息格式 | 凭据 | 适合场景 |
|------|----------|----------|------|----------|
| Bot WebSocket | 企业微信长连接 WS | JSON | `botId` + `secret` | 快速接入、私聊/群聊、流式回复 |
| Bot Webhook | HTTPS 回调 | JSON | `token` + `encodingAESKey` + 可选 `receiveId` | 无法保持 WS 的部署环境 |
| Agent 自建应用 | HTTPS 回调 + 企业微信 HTTP API | 加密 XML | `corpId` + `corpSecret` + `agentId` + `token` + `encodingAESKey` | 主动推送、Cron、部门/标签、文件兜底 |
| 双模生产 | Bot WS + Agent | JSON + XML | Bot 凭据 + `agent.*` | 生产默认方案 |

> 注意：Bot 连接模式通过 `channels.wecom.connectionMode` 选择，但只要同一账号存在 `botId` + `secret`，运行时会优先启动 Bot WebSocket。纯 Bot Webhook 请不要配置这两个字段。

### Bot WebSocket

Bot WebSocket 是默认和推荐的交互式对话入口，不需要公网回调地址，适合先跑通智能机器人私聊、群聊和流式回复。

#### 配置步骤

1. 在企业微信智能机器人后台获取 **Bot ID** 和 **Secret**。
2. 写入 `channels.wecom` 平铺配置并重启 Gateway：

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.connectionMode websocket
openclaw config set channels.wecom.botId "<YOUR_BOT_ID>"
openclaw config set channels.wecom.secret "<YOUR_BOT_SECRET>"
openclaw gateway restart
openclaw channels status --probe
```

3. 在企业微信向智能机器人发送消息，确认 Gateway 日志出现 WebSocket 连接和鉴权成功。

### Bot Webhook

Bot Webhook 适合不能保持 WebSocket 长连接的部署。它使用企业微信 JSON 回调，支持 `stream` / `stream_refresh`，但生产环境通常仍优先使用 Bot WS。

#### 配置步骤

1. 确保 Gateway 具备公网 HTTPS 地址。
2. 在企业微信后台准备 **Token**、**EncodingAESKey** 和可选 **ReceiveId**。
3. 不配置 `botId` / `secret`，只写入 Webhook 字段：

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.connectionMode webhook
openclaw config set channels.wecom.token "<YOUR_CALLBACK_TOKEN>"
openclaw config set channels.wecom.encodingAESKey "<YOUR_43_CHAR_ENCODING_AES_KEY>"
openclaw config set channels.wecom.receiveId "<YOUR_RECEIVE_ID>"
openclaw gateway restart
```

4. 在企业微信后台填写回调地址：

```text
https://<GATEWAY_HOST>/plugins/wecom/bot/<accountId>
```

单账号可使用 `/plugins/wecom/bot` 兼容路径；新部署建议带 `<accountId>`。

### Agent 自建应用

Agent 使用企业微信自建应用加密 XML 回调和 HTTP API。它是主动推送、Cron、部门/标签广播、群聊投递和文件兜底的主路径。

#### 配置步骤

1. 在 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame#apps) 创建自建应用。
2. 记录 **CorpID**、应用 **Secret** 和 **AgentId**。
3. 进入应用的 “API 接收” 设置，准备 **Token** 和 **EncodingAESKey**，但先不要点击保存。
4. 先在 Gateway 写入 `agent.*` 并重启：

```bash
openclaw config set channels.wecom.agent.corpId "<YOUR_CORP_ID>"
openclaw config set channels.wecom.agent.corpSecret "<YOUR_CORP_SECRET>"
openclaw config set channels.wecom.agent.agentId "<YOUR_AGENT_ID>"
openclaw config set channels.wecom.agent.token "<YOUR_CALLBACK_TOKEN>"
openclaw config set channels.wecom.agent.encodingAESKey "<YOUR_43_CHAR_ENCODING_AES_KEY>"
openclaw config set channels.wecom.enabled true
openclaw gateway restart
```

5. 回到企业微信后台保存回调 URL：

```text
https://<GATEWAY_HOST>/plugins/wecom/agent/<accountId>
```

企业微信保存时会立即发送 `echostr` 校验请求。Gateway 必须已配置 Token 和 EncodingAESKey，才能正确解密并返回校验结果。

### 双模共存

Bot 与 Agent 可以在同一账号同时配置。此时 Bot WS 优先处理交互式对话和流式体验，Agent API 负责主动推送、Cron、部门/标签广播和 Bot WS 不可用时的 HTTP 兜底。

#### 配置步骤

1. 先按 Bot WebSocket 步骤写入 `botId` + `secret`。
2. 再按 Agent 步骤补齐 `agent.corpId`、`agent.corpSecret`、`agent.agentId`、`agent.token`、`agent.encodingAESKey`。
3. 为 Agent 回调保存 `/plugins/wecom/agent/<accountId>`。
4. 为 Cron 或主动发送配置目标 Agent，例如使用 `--agent main` 或在 `bindings` 中显式绑定。

推荐回调地址：

| 路径 | 推荐 URL |
|------|----------|
| Bot Webhook | `https://<GATEWAY_HOST>/plugins/wecom/bot/<accountId>` |
| Agent Webhook | `https://<GATEWAY_HOST>/plugins/wecom/agent/<accountId>` |

旧路径 `/wecom`、`/wecom/bot`、`/wecom/agent` 仍用于兼容，新部署建议使用 `/plugins/wecom/...`。

## 配置参考

### Bot 基础配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `channels.wecom.enabled` | 启用企业微信渠道 | `false` |
| `channels.wecom.connectionMode` | Bot 连接模式：`websocket` 或 `webhook` | `websocket` |
| `channels.wecom.name` | 渠道显示名称 | `企业微信` |
| `channels.wecom.botId` | 智能机器人 Bot ID；存在时优先走 WS | 无 |
| `channels.wecom.secret` | 智能机器人 Secret；存在时优先走 WS | 无 |
| `channels.wecom.websocketUrl` | Bot WebSocket 服务地址 | 企业微信默认地址 |

### Bot Webhook 配置

仅在不能保持 WebSocket 长连接时使用。纯 Bot Webhook 不要配置 `botId` 和 `secret`。

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "webhook",
      "token": "<YOUR_CALLBACK_TOKEN>",
      "encodingAESKey": "<YOUR_43_CHAR_ENCODING_AES_KEY>",
      "receiveId": "<YOUR_RECEIVE_ID>"
    }
  }
}
```

| 配置项 | 说明 |
|--------|------|
| `channels.wecom.token` | Bot Webhook 回调校验 Token |
| `channels.wecom.encodingAESKey` | 43 位 EncodingAESKey |
| `channels.wecom.receiveId` | 回调解密校验用接收方 ID，按企业微信后台配置填写 |
| `channels.wecom.welcomeText` | 进入会话事件的欢迎语 |
| `channels.wecom.streamPlaceholderText` | Bot 流式首帧占位（协议层，非欢迎语） |
| `channels.wecom.sendThinkingMessage` | 是否在 Agent 首 token 前发送流式首帧占位，默认 `true` |
| `channels.wecom.streaming` | 流式总开关：`false` / `true` / `{ status?, content?, enabled? }` |
| `channels.wecom.footer.status` | 状态栏是否写入 stream 气泡，默认 `true` |
| `channels.wecom.footer.elapsed` | 关流是否展示耗时脚注，默认 `false` |

### Bot 基础配置（补充）

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `channels.wecom.sendThinkingMessage` | WS 是否在回复开始前发送首帧占位 | `true` |
| `channels.wecom.streamPlaceholderText` | 首帧占位文案；未设时 WS 用 `<think></think>`，Webhook 常见 `"1"` | 无 |
| `channels.wecom.streaming` | 流式模式开关，见 [流式输出](#流式输出) | `false` |
| `channels.wecom.footer` | 状态栏与耗时脚注，见 [流式输出](#流式输出) | `{ status: true, elapsed: false }` |

### Agent 自建应用配置

Agent 使用企业微信自建应用的加密 XML 回调和 HTTP API。它负责主动推送、Cron、部门/标签投递和文件兜底。

配置顺序很重要：先在 Gateway 写入 `agent.*` 并重启，再到企业微信后台保存回调 URL。企业微信保存时会立即发送 `echostr` 验证请求，Gateway 必须已经具备 Token 和 EncodingAESKey 才能通过。

```bash
openclaw config set channels.wecom.agent.corpId "<YOUR_CORP_ID>"
openclaw config set channels.wecom.agent.corpSecret "<YOUR_CORP_SECRET>"
openclaw config set channels.wecom.agent.agentId "<YOUR_AGENT_ID>"
openclaw config set channels.wecom.agent.token "<YOUR_CALLBACK_TOKEN>"
openclaw config set channels.wecom.agent.encodingAESKey "<YOUR_43_CHAR_ENCODING_AES_KEY>"
openclaw config set channels.wecom.enabled true
openclaw gateway restart
```

企业微信后台回调 URL 使用：

```text
https://<GATEWAY_HOST>/plugins/wecom/agent/<accountId>
```

单账号也可以使用 `/plugins/wecom/agent` 兼容路径；多账号建议始终带 `<accountId>`。

| 配置项 | 说明 | 是否常用必填 |
|--------|------|--------------|
| `channels.wecom.agent.corpId` | 企业 CorpID | 是 |
| `channels.wecom.agent.corpSecret` | 自建应用 Secret | 是 |
| `channels.wecom.agent.agentId` | 自建应用 AgentId | 主动推送 / Cron 必填 |
| `channels.wecom.agent.token` | 回调 Token | 是 |
| `channels.wecom.agent.encodingAESKey` | 回调 EncodingAESKey | 是 |
| `channels.wecom.agent.welcomeText` | Agent 回调欢迎语 | 否 |
| `channels.wecom.agent.dmPolicy` | Agent 私聊策略覆盖值 | 否 |
| `channels.wecom.agent.allowFrom` | Agent 私聊白名单覆盖值 | 否 |

### 访问控制

| 配置项 | 说明 | 可选值 | 默认值 |
|--------|------|--------|--------|
| `channels.wecom.dmPolicy` | 私聊访问策略 | `open` / `pairing` / `allowlist` / `disabled` | `open` |
| `channels.wecom.allowFrom` | 私聊用户白名单 | 用户 ID 数组 | `[]` |
| `channels.wecom.groupPolicy` | 群聊访问策略 | `open` / `allowlist` / `disabled` | `open` |
| `channels.wecom.groupAllowFrom` | 群聊白名单 | 群 ID 数组 | `[]` |
| `channels.wecom.groups` | 群级配置，例如群内发送人白名单 | 对象 | `{}` |

只允许指定群和指定成员发起会话：

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

### 网络与代理

| 配置项 | 说明 |
|--------|------|
| `channels.wecom.network.timeoutMs` | 企业微信 HTTP 请求超时时间 |
| `channels.wecom.network.retries` | HTTP 请求重试次数 |
| `channels.wecom.network.retryDelayMs` | 重试间隔 |
| `channels.wecom.network.agentReplyTimeoutMs` | Agent 回复等待时间 |
| `channels.wecom.network.egressProxyUrl` | 固定出口代理，常用于可信 IP 场景 |

出口代理优先级：`channels.wecom.network.egressProxyUrl` > `OPENCLAW_WECOM_EGRESS_PROXY_URL` > `WECOM_EGRESS_PROXY_URL` > `HTTPS_PROXY` > `ALL_PROXY` > `HTTP_PROXY`。

## 欢迎语（enter_chat / subscribe）

用户首次进入 Bot 会话或关注 Agent 应用时，插件可发送可配置的欢迎语。欢迎语与流式首帧占位（`streamPlaceholderText`）、状态栏文案（`thinkingText`）职责不同，请勿混用。

### 触发时机

| 模式 | 事件 | 实现路径 | 发送方式 |
|------|------|----------|----------|
| Bot WebSocket | `event.enter_chat` | `dispatch/ws-monitor.ts` 监听 `event.enter_chat` | SDK `replyWelcome(frame, { msgtype: "text", ... })` |
| Bot Webhook | `msgtype=event` 且 `eventtype=enter_chat` | `webhook/monitor.ts` → `handleEnterChat` | HTTP 回调同步返回 `{ msgtype: "text", text: { content } }` |
| Agent 自建应用 | `msgType=event` 且 `eventType` 为 `enter_chat` 或 `subscribe` | `agent/handler.ts` → `agent/welcome.ts` | Agent API `sendText` 主动发送 |

未配置 `welcomeText` 时：**Bot WS 直接跳过**；**Bot Webhook 返回 null**；**Agent 不调用 sendText**。

### 配置键与优先级

| 配置项 | 作用域 | 说明 |
|--------|--------|------|
| `channels.wecom.welcomeText` | Bot WS / Bot Webhook | enter_chat 欢迎语 |
| `channels.wecom.agent.welcomeText` | Agent 回调 | **优先**于渠道级 `welcomeText` |
| `channels.wecom.accounts.<accountId>.welcomeText` | 多账号 | 账号级覆盖顶层同名字段 |
| `channels.wecom.accounts.<accountId>.agent.welcomeText` | 多账号 Agent | 账号级 Agent 欢迎语 |

Agent 欢迎语解析逻辑（`resolveAgentWelcomeText`）：`agent.welcomeText` 非空则使用；否则回退到 `channels.wecom.welcomeText`。

### 示例与验证

```bash
openclaw config set channels.wecom.welcomeText "你好，我是企业微信助手，有什么可以帮您？"
openclaw config set channels.wecom.agent.welcomeText "欢迎使用自建应用，我会尽快回复您。"
openclaw gateway restart
```

验证步骤：

1. 在企业微信中打开智能机器人会话（触发 enter_chat）。
2. 查看 Gateway 日志：
   - Bot WS：`[<accountId>] ws-event: sent enter_chat welcome`
   - Bot Webhook：`[webhook] enter_chat (userId=..., account=...)`
   - Agent：`[wecom-agent] welcome message failed`（失败时）或用户收到文本（成功时）
3. 运行单元测试：`pnpm test src/agent/welcome.test.ts src/config/streaming-config.test.ts`

## 用户可见文案模板

所有 `*Text` 字段平铺在 `channels.wecom`（或账号级覆盖），由 `config/text-config.ts` 映射到内部模板，默认值见 `config/templates.ts` 的 `WECOM_DEFAULT_TEMPLATES`。

### 配置键一览

| 配置键 | 内部键 | 默认文案 | 典型使用场景 |
|--------|--------|----------|--------------|
| `welcomeText` | welcome | （空） | enter_chat / subscribe 欢迎语 |
| `streamPlaceholderText` | — | 见下方说明 | Bot 流式**协议首帧**占位，非欢迎语 |
| `thinkingText` | thinking | 正在思考… | 状态栏：Agent 开始推理 |
| `receivedText` | received | 已收到，正在处理… | 状态栏：已收到消息 |
| `toolStatusText` | tool | 正在查资料… | 状态栏：工具调用中 |
| `readingText` | reading | 正在阅读附件… | 状态栏：阅读附件 |
| `generatingText` | generating | 正在输入… | 状态栏：生成答案 block |
| `compactionText` | compaction | 📦 正在压缩上下文… | 状态栏：上下文压缩 |
| `emptyReplyText` | emptyReply | ⚠️ 未能生成可展示的回复… | 关流时无正文兜底 |
| `finishFooterText` | finishFooter | ⏱ {elapsed}s · 已完成 | 关流耗时脚注 |
| `cardSentText` | cardSent | 📋 卡片消息已发送。 | 模板卡片已投递 |
| `mediaSentText` | mediaSent | 📎 文件已发送，请查收。 | 媒体发送成功提示 |
| `mediaParseFailedText` | mediaParseFailed | ⚠️ 未能解析该媒体…{emptyReply} | 入站媒体解析失败 |
| `mediaDeliveredText` | mediaDelivered | ✅ 文件已发送。 | Webhook 关流前媒体已单独投递 |
| `processedCompleteText` | processedComplete | ✅ 已处理完成。 | Webhook 空 content 关流兜底 |
| `timeoutText` | timeout | ⚠️ 处理超时（约 {minutes} 分钟）… | Agent 回复超时（默认 6 分钟） |
| `dispatchErrorText` | dispatchError | ⚠️ 回复生成失败（{kind}）：{detail} | OpenClaw dispatch 错误 |
| `mediaErrorNoAccessText` | mediaErrorNoAccess | ⚠️ 文件发送失败：没有权限访问路径 {mediaUrl}… | 本地路径不在 `mediaLocalRoots` |
| `mediaErrorReasonText` | mediaErrorReason | ⚠️ 文件发送失败：{reason} | 媒体发送被拒 |
| `mediaErrorGenericText` | mediaErrorGeneric | ⚠️ 文件发送失败：无法处理文件 {mediaUrl}… | 其他媒体错误 |
| `queuedText` | queued | 已收到，已排队处理中... | 同会话消息排队 |
| `mergedQueuedText` | mergedQueued | 已收到，已合并排队处理中... | 合并排队 |
| `mergedDoneText` | mergedDone | ✅ 已合并处理完成，请查看上一条回复。 | 合并处理完成 |
| `sessionResetText` | sessionReset | ✅ 已重置会话。 | 会话重置命令 |
| `sessionNewText` | sessionNew | ✅ 已开启新会话。 | 新会话命令 |

### 占位符

下列占位符由 `formatWecomTemplate` / message-sdk 在运行时替换；未列出的 `*Text` 键为**静态文案**（不含 `{…}`）。

| 占位符 | 适用配置键 | 含义 |
|--------|------------|------|
| `{toolName}` | `toolStatusText` | 当前工具名；模板含此占位符且传入工具名时替换，否则使用整段静态文案 |
| `{elapsed}` | `finishFooterText` | 关流耗时秒数（至少 1s，见 `formatWecomElapsedFooter`） |
| `{minutes}` | `timeoutText` | Agent 回复超时阈值分钟数（`timeoutMs / 60000` 取整） |
| `{kind}` | `dispatchErrorText` | OpenClaw dispatch 错误类别标识 |
| `{detail}` | `dispatchErrorText` | 截断后的错误详情（默认最长 200 字符） |
| `{emptyReply}` | `mediaParseFailedText` | 运行时注入已解析的 `emptyReplyText` 全文 |
| `{mediaUrl}` | `mediaErrorNoAccessText`、`mediaErrorGenericText` | 媒体本地路径或 URL |
| `{reason}` | `mediaErrorReasonText` | 媒体发送被拒原因（`rejectReason` 或 `error`） |

### 完整示例（全部 25 个 `*Text` 键）

JSON 不支持注释；下方按职责分组排列：**欢迎与流式协议** → **状态栏** → **关流与兜底** → **卡片/媒体** → **错误** → **排队与会话命令**。可按需删除未使用的键，未配置项使用 `WECOM_DEFAULT_TEMPLATES` 默认值。

```json
{
  "channels": {
    "wecom": {
      "welcomeText": "您好！我是智能助手，发送消息即可开始对话。",
      "streamPlaceholderText": "1",
      "thinkingText": "正在思考…",
      "receivedText": "已收到，正在处理…",
      "toolStatusText": "正在调用 {toolName}…",
      "readingText": "正在阅读附件…",
      "generatingText": "正在输入…",
      "compactionText": "📦 正在压缩上下文…",
      "emptyReplyText": "⚠️ 未能生成可展示的回复，请稍后重试或发送文字消息。",
      "finishFooterText": "⏱ {elapsed}s · 已完成",
      "cardSentText": "📋 卡片消息已发送。",
      "mediaSentText": "📎 文件已发送，请查收。",
      "mediaParseFailedText": "⚠️ 未能解析该媒体并生成回复。{emptyReply}",
      "mediaDeliveredText": "✅ 文件已发送。",
      "processedCompleteText": "✅ 已处理完成。",
      "timeoutText": "⚠️ 处理超时（约 {minutes} 分钟），请稍后重试或发送文字消息。",
      "dispatchErrorText": "⚠️ 回复生成失败（{kind}）：{detail}",
      "mediaErrorNoAccessText": "⚠️ 文件发送失败：没有权限访问路径 {mediaUrl}\n请在 openclaw.json 的 mediaLocalRoots 中添加该路径的父目录后重启生效。",
      "mediaErrorReasonText": "⚠️ 文件发送失败：{reason}",
      "mediaErrorGenericText": "⚠️ 文件发送失败：无法处理文件 {mediaUrl}，请稍后再试。",
      "queuedText": "已收到，已排队处理中...",
      "mergedQueuedText": "已收到，已合并排队处理中...",
      "mergedDoneText": "✅ 已合并处理完成，请查看上一条回复。",
      "sessionResetText": "✅ 已重置会话。",
      "sessionNewText": "✅ 已开启新会话。"
    }
  }
}
```

## 流式输出

仅 **Bot WebSocket** 与 **Bot Webhook** 支持企业微信 `stream` / `replyStream` 流式载体；**Agent 自建应用入站对话不支持 Bot 式流式**，出站以 `sendMessage` 一次性 Markdown / 媒体为主。

### 流式输出配置速查

下面几组命令来自 [流式架构](../../doc/wecom/OpenClaw-WeCom-Streaming-Architecture.md)，适合直接复制到本地环境中切换体验。

```bash
# 默认模式：状态栏过程 + 最终整包答案（推荐大多数业务 Bot）
openclaw config set channels.wecom.streaming false
openclaw config set channels.wecom.footer.status true
openclaw config set channels.wecom.footer.elapsed true

# 开启流式输出：状态进度 + 答案打字机
openclaw config set channels.wecom.streaming true
openclaw config set channels.wecom.streaming.status true
openclaw config set channels.wecom.streaming.content true

# 仅答案打字机：不刷中间状态行
openclaw config set channels.wecom.streaming true
openclaw config set channels.wecom.streaming.status false
openclaw config set channels.wecom.streaming.content true

# 关闭流式输出
openclaw config set channels.wecom.streaming false

# thinking 占位消息
openclaw config set channels.wecom.sendThinkingMessage true
```

JSON 等价写法：

```json
{
  "channels": {
    "wecom": {
      "streaming": {
        "status": true,
        "content": true
      },
      "footer": {
        "status": true,
        "elapsed": true
      },
      "sendThinkingMessage": true
    }
  }
}
```

`streaming` 可以是布尔值，也可以是对象。CLI 中的 `channels.wecom.streaming.status` / `channels.wecom.streaming.content` 会写入对象形态；源码解析会同时接受 `true`、`false` 和 `{ "enabled"?, "status"?, "content"? }`。若要显式关闭对象形态下的流式，可写 `{ "enabled": false }` 或直接执行 `openclaw config set channels.wecom.streaming false`。

### 配置形式

`channels.wecom.streaming` 支持布尔或对象：

| 写法 | 含义 |
|------|------|
| 省略 / `false` | **默认模式**：仅状态栏 + 关流时整包答案（`streamingContent=false`） |
| `true` | **流式模式**：中间 status 与 answer block 增量均开启 |
| `{ "status": false, "content": true }` | 仅答案增量，不刷状态行 |
| `{ "enabled": false }` | 显式关闭对象形式下的流式（见 `WecomStreamingNestedConfig`） |

`channels.wecom.footer`：

| 键 | 默认 | 说明 |
|----|------|------|
| `footer.status` | `true` | 是否在气泡中展示状态行（thinking / tool / reading 等） |
| `footer.elapsed` | `false` | 关流时是否附加耗时脚注（`finishFooterText`） |

`sendThinkingMessage`（默认 `true`）：为 `true` 时，WS 在 Agent 首 token 前会通过 `sendThinkingReply` 发送**协议首帧**（`streamPlaceholderText` 或内置 `<think></think>`），避免长时间空白气泡；为 `false` 时跳过该 thinking 首帧。

`streamPlaceholderText`：Bot 流式通道的第一条 `finish=false` 内容，与 `welcomeText`、`thinkingText` 不同。Webhook 未配置时常见回退为 `"1"`（企微要求先回一条非空 stream）。

解析与合成逻辑：`config/streaming-config.ts`（委托 `@partme.ai/openclaw-message-sdk/transcript`），将 status / answer / footer 拼成**单条纯文本** `replyStream` 内容。

### 三种模式行为差异

| 能力 | Bot WebSocket | Bot Webhook | Agent |
|------|---------------|-------------|-------|
| 流式载体 | `replyStream` / `replyStreamNonBlocking` | HTTP `msgtype: stream` + `stream_refresh` 轮询 | 无 Bot stream |
| 首帧占位 | `sendThinkingReply` + `streamPlaceholderText` | `resolveWecomStreamPlaceholderText`，默认 `"1"` | 不适用 |
| 状态栏 | `footer.status` 或 `streaming.status` | 同左，`webhook/reply-pipeline.ts` | 不适用 |
| 媒体出站 | `aibot_send_msg` 主动发送，不覆盖 thinking 流 | `outbound/reply-deliver.ts` 写入 streamStore | Agent API 上传发送 |
| 关流文案 | `dispatch/finish-thinking.ts` → `resolveThinkingFinishText` | 同逻辑 + `applyWecomWebhookEmptyContentFallback` | 最终 API 消息 |

### 硬约束与降级

- **纯文本**：`replyStream` 内容不支持 Markdown；最终展示是否富文本取决于降级路径（如 `sendMessage` markdown）。
- **6 分钟窗口**：流式超过 6 分钟未更新，企微返回 **errcode 846608**（`STREAM_EXPIRED_ERRCODE`）。插件在 `finishWsThinkingStream` 捕获后降级为 `sendMessage` 主动发送。
- **Agent 回复超时**：默认 `network.agentReplyTimeoutMs` = 360000 ms（6 分钟），超时用户可见 `timeoutText`。
- **空白关流**：纯空白 content 无法 `finish=true`；插件用 `emptyReplyText` 等可见字符兜底。

### 推荐配置样例

**稳定非流式（默认，适合业务整包回复）：**

```json
{
  "channels": {
    "wecom": {
      "streaming": false,
      "footer": { "status": true, "elapsed": true }
    }
  }
}
```

**打字机 + 工具进度：**

```json
{
  "channels": {
    "wecom": {
      "streaming": true,
      "footer": { "status": true, "elapsed": true },
      "sendThinkingMessage": true
    }
  }
}
```

**仅状态栏、答案关流时一次展示：**

```json
{
  "channels": {
    "wecom": {
      "streaming": { "status": true, "content": false },
      "footer": { "status": true, "elapsed": false }
    }
  }
}
```

### 验证

```bash
cd extensions/wecom
pnpm test src/config/streaming-config.test.ts src/dispatch/finish-thinking.test.ts
openclaw gateway restart
# 发送长推理问题，观察状态栏与增量；grep 846608 / stream expired / sendMessage
grep -E '846608|stream expired|sendThinkingReply|enter_chat welcome|finish=true' /tmp/openclaw/openclaw-*.log
```

详见 [流式架构](../../doc/wecom/OpenClaw-WeCom-Streaming-Architecture.md)。

## 知识库 / RAG

**准确结论**：`@partme.ai/wecom` **不内置**知识库 hooks，源码中**不存在** `channels.wecom.knowledge` 或 `registerKnowledgeHooks`。仅配置 `channels.wecom.knowledge.*` **不会**启用 RAG。

知识能力由独立的 **`@partme.ai/openclaw-knowledge`** 插件提供（`before_prompt_build` 自动检索注入 + `knowledge_query` / `knowledge_add` 等工具）。WeCom 插件只负责把用户消息送入 OpenClaw Agent 运行时；Agent 绑定 knowledge 插件后，即可在企微对话中检索并回答。

### 消息路径

```text
企业微信用户消息
  → WeCom 入站（WS / Webhook / Agent 回调）
  → OpenClaw dispatch（bindings / dynamicAgents）
  → Agent Runtime
       ├─ [knowledge 插件] before_prompt_build 检索 → 注入 system 上下文
       └─ [可选] Agent 调用 knowledge_* 工具
  → 回复经 WeCom 出站（Bot stream 或 Agent API）
```

### 配置示例

WeCom 与 knowledge **分开配置**：

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
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>"
    }
  },
  "bindings": [
    {
      "agentId": "main",
      "match": { "channel": "wecom", "accountId": "default" }
    }
  ]
}
```

### 验证

```bash
openclaw plugins install @partme.ai/openclaw-knowledge
openclaw gateway restart
openclaw run knowledge:stats
```

在企微中让助手记住一条测试事实，再用新消息询问；应答应引用知识库内容。

延伸阅读：

- [知识库 RAG 指南](../../doc/knowledge/OpenClaw-Knowledge-RAG-Guide_CN.md)
- [知识库 RAG 集成](../../doc/knowledge/OpenClaw-Knowledge-RAG-Integration_CN.md)
- [配置指南 §9 知识库](../../doc/wecom/OpenClaw-WeCom-Configuration.zh-CN.md#9-知识库--rag-集成)

## 媒体、MEDIA 指令、模板卡片、MCP 与 Skills

### before_prompt_build 提示注入

插件在 `index.ts` 注册 `before_prompt_build`（仅 `channelId === wecom` 时），向 Agent system 追加：

- 发送图片/视频/语音/文件时使用 **`MEDIA:`** 指令 → 详见 `wecom-send-media` skill
- 发送结构化卡片时在回复中输出 **JSON 代码块**（含 `card_type`）→ 详见 `wecom-send-template-card` skill

这不会自动发媒体/卡片，而是指导 LLM 输出可被出站管线解析的格式。

### MEDIA 指令

Agent 回复中的行级指令：

```text
MEDIA: /absolute/path/to/file.png
MEDIA: `/path/with spaces/report.pdf`
```

出站时由 `outbound/media-deliver.ts`、`media/media-uploader.ts` 等解析；本地路径必须在 `mediaLocalRoots` 白名单内。Agent 回调路径在 `agent/handler.ts` 亦解析 `MEDIA:` 行。媒体通过 **WS 主动 `aibot_send_msg`** 发送，避免覆盖 `replyStream` thinking 流。

### 模板卡片

LLM 输出中的 markdown JSON 代码块由 `outbound/template-card-parser.ts` 提取；合法 `card_type` 见 `types/const.ts` 的 `VALID_CARD_TYPES`。流式中间帧会用 `maskTemplateCardBlocks` 隐藏未完成的 JSON，避免用户看到源码。卡片发送后可用 `cardSentText` 提示。

### wecom_mcp 工具

full 模式注册 Agent 工具 **`wecom_mcp`**（`mcp/tool.ts`）：

| 操作 | 用法 |
|------|------|
| `list` | `wecom_mcp call ...` / action=list，列出某品类 MCP 工具 |
| `call` | 调用 doc、contact、msg 等品类下的 MCP 方法 |

会话上下文自动注入：`requesterUserId`、`accountId`、`chatId`、`chatType`（来自 OpenClaw session）。文档类 MCP 端点可通过 Bot WS 命令 `aibot_get_mcp_config` 拉取并持久化到 state 目录 `wecomConfig/config.json`（`mcp/config-fetch.ts`）。

### 内置 Skills（extensions/wecom/skills/）

| Skill | 用途 |
|-------|------|
| `wecom-send-media` | MEDIA 指令发送本地文件 |
| `wecom-send-template-card` | 模板卡片 JSON 格式 |
| `wecom-doc` | 企微文档 MCP |
| `wecom-contact` | 通讯录 |
| `wecom-schedule` / `wecom-meeting` / `wecom-todo` | 日程、会议、待办 |
| `wecom-msg` | 聊天记录与媒体下载 |
| `wecom-smartsheet` | 智能表格 |
| `wecom-preflight` | 发送前检查 |
| `wecom-unified` | 统一操作参考 |

临时 HTTP 媒体：`/wecom-media` 路由供出站链接访问（15 分钟 TTL）。

## 嵌套 `bot` 配置兼容（向后兼容）

自 `@partme.ai/wecom@2026.5.25-1` 起，插件在**读取配置时**会自动将历史嵌套 `bot` 块规范化为运行时平铺字段。**推荐新配置继续使用平铺写法**（`channels.wecom.botId` / `accounts.<id>.botId`）；嵌套 `bot` 仅用于兼容旧版或 CLI 生成的配置。

| 嵌套路径（兼容） | 运行时平铺字段（canonical） | 说明 |
|------------------|----------------------------|------|
| `bot.botId` | `botId` | WebSocket Bot 凭据 |
| `bot.secret` | `secret` | WebSocket Bot 凭据 |
| `bot.connectionMode` | `connectionMode` | `websocket` / `webhook` |
| `bot.welcomeText` | `welcomeText` | enter_chat 欢迎语 |
| `bot.streamPlaceholderContent` | `streamPlaceholderText` | 流式首帧占位（历史别名） |
| `bot.dm.policy` | `dmPolicy` | 私聊策略 |
| `bot.dm.allowFrom` / `bot.dm.allow` | `allowFrom` | 私聊白名单 |

**优先级**：同层平铺字段 **高于** 嵌套 `bot.*`（便于渐进迁移）。顶层 `channels.wecom.bot.*` 与 `accounts.<id>.bot.*` 均支持；`agent` 嵌套块不受影响。

迁移示例（嵌套 → 平铺）：

```json
{
  "channels": {
    "wecom": {
      "accounts": {
        "cs-assistant": {
          "name": "客服助理.AI",
          "enabled": true,
          "botId": "<BOT_ID>",
          "secret": "<BOT_SECRET>",
          "connectionMode": "websocket",
          "welcomeText": "您好！",
          "streamPlaceholderText": "正在处理中...",
          "dmPolicy": "open"
        }
      }
    }
  }
}
```

## 多账号与动态 Agent

多账号用于多个企业、多个 Bot 或多团队隔离。账号级字段会覆盖顶层同名字段。

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "main",
      "accounts": {
        "main": {
          "botId": "<BOT_ID_MAIN>",
          "secret": "<BOT_SECRET_MAIN>",
          "agent": {
            "corpId": "<CORP_ID>",
            "corpSecret": "<CORP_SECRET_MAIN>",
            "agentId": "<AGENT_ID_MAIN>",
            "token": "<TOKEN_MAIN>",
            "encodingAESKey": "<AES_KEY_MAIN>"
          }
        },
        "support": {
          "dmPolicy": "allowlist",
          "allowFrom": ["admin_user_id"],
          "agent": {
            "corpId": "<CORP_ID>",
            "corpSecret": "<CORP_SECRET_SUPPORT>",
            "agentId": "<AGENT_ID_SUPPORT>",
            "token": "<TOKEN_SUPPORT>",
            "encodingAESKey": "<AES_KEY_SUPPORT>"
          }
        }
      }
    }
  }
}
```

多账号生产环境建议显式配置绑定，避免消息落到非预期 Agent：

```json
{
  "bindings": [
    {
      "agentId": "main",
      "match": {
        "channel": "wecom",
        "accountId": "main"
      }
    }
  ]
}
```

动态 Agent 可按用户或群创建隔离会话，适合不同群、不同用户上下文互不污染的场景。

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
| `channels.wecom.dynamicAgents.dmCreateAgent` | 私聊按用户创建隔离 Agent | `true` |
| `channels.wecom.dynamicAgents.groupEnabled` | 群聊启用动态 Agent | `true` |
| `channels.wecom.dynamicAgents.adminUsers` | 管理员用户，绕过动态路由使用主 Agent | `[]` |

## 实用 CLI 速查

### 欢迎语与用户可见文案

```bash
openclaw config set channels.wecom.welcomeText "你好，我是企业微信助手，有什么可以帮您？"
openclaw config set channels.wecom.agent.welcomeText "欢迎使用自建应用，我会尽快回复您。"
openclaw config set channels.wecom.thinkingText "正在思考…"
openclaw config set channels.wecom.toolStatusText "正在调用 {toolName}…"
openclaw config set channels.wecom.finishFooterText "⏱ {elapsed}s · 已完成"
openclaw gateway restart
```

验证时重新打开 Bot 会话触发 `enter_chat`，并检查日志是否出现 `enter_chat welcome`。`welcomeText` 是进入会话欢迎语，`streamPlaceholderText` 是 Bot 流式协议首帧，两者不要混用。

### 访问控制与 pairing

```bash
# 私聊新用户走配对审批
openclaw config set channels.wecom.dmPolicy pairing

# 群聊只允许指定群触发
openclaw config set channels.wecom.groupPolicy allowlist
openclaw config set channels.wecom.groupAllowFrom '["<GROUP_CHAT_ID>"]'

# 查看并批准配对
openclaw pairing list wecom
openclaw pairing approve wecom <PAIRING_CODE>
```

Bot WS 与 Bot Webhook 使用 `channels.wecom.dmPolicy` / `channels.wecom.groupPolicy`。Agent 私聊可使用 `channels.wecom.agent.dmPolicy` 与 `channels.wecom.agent.allowFrom` 覆盖。

### 知识库 / RAG

WeCom 插件不内置 `channels.wecom.knowledge.*`，需要独立安装并配置 knowledge 插件；WeCom 只负责把消息送入 Agent Runtime。

```bash
openclaw plugins install @partme.ai/openclaw-knowledge
openclaw gateway restart
openclaw run knowledge:stats
```

配置示例见 [知识库 / RAG](#知识库--rag) 与 [配置指南 §9](../../doc/wecom/OpenClaw-WeCom-Configuration.zh-CN.md#9-知识库--rag-集成)。

### 媒体测试与大小限制

```bash
openclaw config set channels.wecom.mediaLocalRoots '["/data/wecom-media"]'
openclaw config set channels.wecom.media.maxBytes 20971520
openclaw gateway restart
```

验证建议：

1. 向 Bot 发送图片、文件、语音各一条，确认日志出现媒体下载或保存记录。
2. 让 Agent 回复 `MEDIA: /data/wecom-media/report.pdf`，确认白名单内文件可以发送。
3. 尝试白名单外路径，确认用户看到 `mediaErrorNoAccessText` 类提示。
4. 使用接近限制的图片 / 视频 / 文件验证降级：图片和视频常见限制 10 MB，语音常见限制 2 MB AMR，文件受 `media.maxBytes` 控制。

### 验证与排障命令

```bash
# 基础健康检查
openclaw channels list
openclaw channels status --probe
openclaw plugins doctor

# CLI 设备授权：message send / agent --deliver 需要 operator.write
openclaw devices list
openclaw devices approve --latest

# Bot WS 主动发送：使用纯 userid，不要写 user:<id>
openclaw message send --channel wecom --account default --target <USERID> --message "Bot WS 测试"

# Agent / Cron 目标支持显式前缀
openclaw message send --channel wecom --account default --target user:<USER_ID> --message "Agent 出站测试"

# 常用日志 grep
LOG=/tmp/openclaw/openclaw-$(date +%Y-%m-%d).log
grep -E 'Authentication successful|WebSocket connected|Kicked by server|\[webhook\]' "$LOG"
grep -E 'aibot_callback|policy blocked|authz:|duplicate msgId' "$LOG"
grep -E '846608|stream expired|stream_refresh|finalizeWsWecomReply|active-reply' "$LOG"
grep -E '\[wecom-agent\]|gettoken|60020|93006|Agent reply timed out' "$LOG"
```

## 常用命令

```bash
# 状态与诊断
openclaw channels list
openclaw channels status --probe
openclaw plugins doctor

# Agent 回调字段
openclaw config set channels.wecom.agent.corpId "<CORP_ID>"
openclaw config set channels.wecom.agent.corpSecret "<SECRET>"
openclaw config set channels.wecom.agent.agentId 1000002
openclaw config set channels.wecom.agent.token "<TOKEN>"
openclaw config set channels.wecom.agent.encodingAESKey "<AES_KEY>"

# Bot WS 主动发送：使用纯 userid
openclaw message send --channel wecom --account default --target <USERID> --message "Bot WS 测试"

# Agent/Cron 出站：支持显式前缀
openclaw message send --channel wecom --account default --target user:<USER_ID> --message "Agent 出站测试"
```

Cron 投递属于主动出站，必须配置 Agent：

| 目标格式 | 含义 | 示例 |
|----------|------|------|
| `party:<id>` | 部门 | `party:1` |
| `dept:<id>` | 部门别名 | `dept:5` |
| `tag:<id>` | 标签 | `tag:Ops` |
| `user:<id>` | 指定用户 | `user:zhangsan` |
| `group:<id>` | 群聊 | `group:wr123abc` |
| `chat:<id>` | 群聊别名 | `chat:wc456def` |
| 纯数字 | 自动按部门处理 | `1` |

```bash
openclaw cron add \
  --name "wecom-daily-brief" \
  --agent main \
  --cron "0 9 * * 1-5" \
  --tz "Asia/Shanghai" \
  --message "今日简报" \
  --announce \
  --channel wecom \
  --to "party:<PARTY_ID>"
```

## 媒体与文件

| 方向 | 类型 | 行为 |
|------|------|------|
| 入站 | 图片、语音、视频、文件 | 当前路径支持时下载/解密并写入入站上下文 |
| 入站 | mixed、引用消息 | Bot payload 存在时解析 |
| 出站 | 图片/视频 | Bot 常见限制 10 MB，超限时尽量按文件兜底 |
| 出站 | 语音 | AMR 且常见限制 2 MB；非 AMR 或超限按文件处理 |
| 出站 | 文件 | 受 `media.maxBytes` 限制，完整能力依赖 Agent API 或兜底 |
| 本地路径 | 任意本地文件 | 必须位于 `mediaLocalRoots`，白名单外路径会被拒绝 |

```bash
openclaw config set channels.wecom.mediaLocalRoots '["/data/wecom-media"]'
openclaw config set channels.wecom.media.maxBytes 20971520
```

常见大小策略：

| 类型 | 常见限制 | 插件处理 |
|------|----------|----------|
| 图片 | 10 MB | 超限时尽量按文件发送 |
| 视频 | 10 MB | 超限时尽量按文件发送 |
| 语音 | 2 MB，通常要求 AMR | 非 AMR 或超限时按文件处理 |
| 文件 | 20 MB | 超过 `media.maxBytes` 会拒绝或降级 |

## 本地开发与测试

```bash
cd extensions/wecom
pnpm build
pnpm typecheck
pnpm test
pnpm run pack-dry
```

手工联调：

```bash
openclaw gateway restart
openclaw channels status --probe
openclaw message send --channel wecom --account default --target <USERID> --message "测试"
```

建议验证顺序：

1. `pnpm test` 通过，确认约 330 个 Vitest 用例仍可运行。
2. `openclaw channels status --probe` 能看到 WeCom 渠道启用和账号状态。
3. Bot WS 场景下，Gateway 日志出现连接和鉴权成功。
4. Agent 场景下，先验证企业微信后台回调 URL 保存成功，再测试主动投递。
5. 媒体场景下，分别测试白名单内本地文件、超限图片和普通文件。

## 常见问题

| 现象 | 常见原因 | 处理方式 |
|------|----------|----------|
| `60020 not allow to access from your ip` | 企业微信 API 调用来自未授权出口 IP | 在企微后台加入 Gateway 出口 IP，或配置 `channels.wecom.network.egressProxyUrl` |
| `93006 invalid chatid` | Bot WS 主动发送使用了 `user:<id>` | Bot WS 主动发送改用纯 `userid` |
| `Kicked by server: a new connection was established elsewhere` | 多个 Gateway 或重复账号同时连接 | 同一 Bot 账号只保留一个 WS 连接 |
| Bot Webhook 没有最终流式内容 | 回调验证、去重或 stream refresh 路径异常 | 按真实联调 Checklist 排查 |
| 本地媒体路径被拒绝 | 文件不在 `mediaLocalRoots` 下 | 把可信目录加入 `mediaLocalRoots` |
| Cron 没有投递 | 未配置 Agent 或缺少 `agent.agentId` | 补齐 `agent.*` 字段并确认目标可见范围 |
| 企业微信后台保存回调失败 | Gateway 未提前配置 Token/AESKey 或 URL 不可公网访问 | 先配置并重启 Gateway，再保存 `/plugins/wecom/agent/<accountId>` |
| Bot Webhook 被意外绕过 | 同账号仍配置了 `botId` + `secret` | 纯 Webhook 模式删除 Bot WS 凭据 |

## 深入文档

- [配置指南](../../doc/wecom/OpenClaw-WeCom-Configuration.zh-CN.md)：Bot WS、Bot Webhook、Agent、双模、多账号、媒体、RAG、代理、Cron。
- [真实联调 Checklist](../../doc/wecom/OpenClaw-WeCom-Integration-Checklist.md)：真实企业微信租户验收清单。
- [架构设计](../../doc/wecom/OpenClaw-WeCom-Architecture.md)：双模式拓扑、模块地图、入站/出站优先级、MCP 和 Skills。
- [流式架构](../../doc/wecom/OpenClaw-WeCom-Streaming-Architecture.md)：Bot stream 协议、6 分钟窗口、846608 降级。
- [联调与测试](../../doc/wecom/OpenClaw-WeCom-Testing.md)：Gateway 手工联调、目标格式、设备授权和媒体检查。

## 许可证

ISC
