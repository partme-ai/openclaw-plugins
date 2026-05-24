<div align="center">

# OpenClaw WeCom

**OpenClaw 企业微信渠道插件：Bot WebSocket、Bot Webhook 与自建应用 Agent 双模集成**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fwecom-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-ISC-green)

[简体中文](./README.zh-CN.md) | [英文](./README.md)

</div>

`@partme.ai/wecom` 用于把 [OpenClaw](https://github.com/openclaw/openclaw) 接入企业微信。它同时支持智能机器人 Bot 与自建应用 Agent：Bot WebSocket 适合快速接入、私聊 / 群聊和流式对话；Agent 适合主动推送、Cron 定时投递、部门 / 标签广播和完整出站文件能力。

## 简介

这是一个面向生产使用的企业微信渠道桥接插件。运行时配置位于 `channels.wecom`，多账号配置位于 `channels.wecom.accounts.<accountId>`，账号级字段会覆盖顶层同名字段。Bot 与 Agent 可以在同一账号下并存。

配置前请先理解以下事实：

- **只要存在 `botId` + `secret`，运行时优先启动 Bot WebSocket**。即使 `connectionMode` 写成 `webhook`，仍会走 WS；纯 Bot Webhook 模式请不要配置 `botId` 与 `secret`。
- **Bot 与 Agent 不是二选一**。生产环境通常用 Bot 负责交互式对话和流式回复，用 Agent 负责主动推送、Cron、文件兜底和 API 投递。
- **主动发送与 Cron 必须配置 `agent.agentId`**。Agent 入站回调需要 `corpId`、`corpSecret`、`token`、`encodingAESKey`；主动发送、Cron 和兜底投递还需要 `agent.agentId`。
- **Markdown 能力要按出站路径理解**。Bot stream 是纯文本流式载体；Agent API 与部分主动发送路径可以发送 Markdown，但企业微信客户端仍可能按消息类型展示为纯文本或剥离部分格式。

## 核心能力

- **三条运行路径**：Bot WebSocket、Bot HTTP Webhook、自建应用 Agent 加密 XML Webhook。
- **Bot 流式回复**：支持 `replyStream` / Webhook `stream`，包含思考占位、状态文案、脚注和 846608 降级。
- **多账号路由**：通过 `defaultAccount` 与 `accounts.<id>` 隔离团队、租户、环境或不同 Bot / Agent 凭据。
- **访问控制**：私聊策略 `open` / `pairing` / `allowlist` / `disabled`，群聊策略 `open` / `allowlist` / `disabled`。
- **媒体处理**：支持入站图片、语音、视频、文件、mixed 图文混排、引用消息；出站本地文件受 `mediaLocalRoots` 白名单保护。
- **模板卡片**：支持 `text_notice`、`news_notice`、`button_interaction`、`vote_interaction`、`multiple_interaction` 及事件回调。
- **动态 Agent 路由**：可按私聊用户或群聊自动隔离 Agent / 会话。
- **MCP 与内置技能**：注册 `wecom_mcp` 工具，并内置联系人、文档、日程、会议、消息、媒体、模板卡片、smartsheet、待办、预检、统一操作等技能。
- **运行可靠性**：心跳、指数退避重连、持久化去重、同会话串行队列、超时兜底和互踢保护。

## 快速开始

### 前置要求

- OpenClaw `>= 2026.4.12`
- Node.js `22+`
- `@partme.ai/openclaw-message-sdk >= 2026.5.24`
- 已具备企业微信后台权限，可创建智能机器人 API 模式或自建应用

### 安装

```bash
openclaw plugins install @partme.ai/wecom
```

本地开发安装如果被插件安全扫描拦截，请先确认风险来源；只在可信环境中使用 unsafe 安装参数：

```bash
openclaw plugins install @partme.ai/wecom@latest --dangerously-force-unsafe-install
```

### 选择配置路径

| 路径 | 适用场景 | 命令或文档 |
|------|----------|------------|
| 交互式向导 | 希望通过 CLI 引导录入配置 | `openclaw channels add` |
| 最小 CLI | 已拿到 Bot ID 和 Secret | 见 [Bot WebSocket 命令行配置](#bot-websocket-命令行配置) |
| 分场景配置 | 需要 Bot、Agent、双模、多账号、媒体、RAG、代理或 Cron 示例 | [配置指南](../../doc/wecom/OpenClaw-WeCom-Configuration.zh-CN.md) |
| 生产验收 | 需要在真实企业微信租户里验收 | [真实联调 Checklist](../../doc/wecom/OpenClaw-WeCom-Integration-Checklist.md) |

### Bot WebSocket 命令行配置

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.connectionMode websocket
openclaw config set channels.wecom.botId "<你的_BOT_ID>"
openclaw config set channels.wecom.secret "<你的_BOT_SECRET>"
openclaw gateway restart
openclaw channels status --probe
```

在企业微信里向智能机器人发送私聊消息。Gateway 日志应出现 WebSocket 连接和鉴权成功。

### 最小 JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<你的_BOT_ID>",
      "secret": "<你的_BOT_SECRET>"
    }
  }
}
```

运行时配置是 `channels.wecom.*` 的平铺结构。不要把 `bot.*`、`botIds`、`aibotid` 当作主要运行时配置。

## 模式选择

| 模式 | 连接方式 | 凭据 | 适合场景 | 说明 |
|------|----------|------|----------|------|
| Bot WebSocket | 长连接 WS | `botId` + `secret` | 快速交互式接入、私聊 / 群聊、流式回复 | 默认推荐的对话路径，不需要公网回调地址。 |
| Bot Webhook | HTTPS 回调 | `token` + `encodingAESKey` + 可选 `receiveId` | 无法保持 WS 的部署环境 | 需要公网回调 URL 和 stream refresh 处理。 |
| Agent 自建应用 | HTTPS 回调 + 企业微信 API | `corpId` + `corpSecret` + `agentId` + `token` + `encodingAESKey` | 主动推送、Cron、部门、标签、文件兜底 | Agent 入站不支持 Bot 式流式；回复通过 API 一次性发送。 |
| 双模生产配置 | Bot WS + Agent | Bot 凭据 + `agent.*` | 生产默认方案 | Bot 负责对话，Agent 负责推送、Cron 和兜底。 |

推荐回调地址：

| 运行路径 | 推荐 URL |
|----------|----------|
| Bot Webhook | `https://<你的_GATEWAY_HOST>/plugins/wecom/bot/<accountId>` |
| Agent Webhook | `https://<你的_GATEWAY_HOST>/plugins/wecom/agent/<accountId>` |

`/wecom`、`/wecom/bot`、`/wecom/agent` 等旧路径仍用于兼容，新部署建议使用 `/plugins/wecom/...`。

## 生产双模配置

需要 Bot 流式对话 + Agent 主动推送 / 兜底时，使用如下结构：

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<你的_BOT_ID>",
      "secret": "<你的_BOT_SECRET>",
      "streaming": {
        "enabled": true,
        "status": true,
        "content": true
      },
      "footer": {
        "status": true,
        "elapsed": true
      },
      "mediaLocalRoots": ["~/Downloads"],
      "media": {
        "maxBytes": 20971520
      },
      "agent": {
        "corpId": "<你的_CORP_ID>",
        "corpSecret": "<你的_CORP_SECRET>",
        "agentId": "<你的_AGENT_ID>",
        "token": "<你的回调_TOKEN>",
        "encodingAESKey": "<你的_43位_ENCODING_AES_KEY>"
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

## 常用 CLI

```bash
# Agent 回调字段；请先配置 Gateway，再到企微后台保存回调 URL。
openclaw config set channels.wecom.agent.corpId "<CORP_ID>"
openclaw config set channels.wecom.agent.corpSecret "<SECRET>"
openclaw config set channels.wecom.agent.agentId 1000002
openclaw config set channels.wecom.agent.token "<TOKEN>"
openclaw config set channels.wecom.agent.encodingAESKey "<AES_KEY>"

# 处理 60020 固定出口 IP 错误。
openclaw config set channels.wecom.network.egressProxyUrl "http://proxy.company.local:3128"

# Bot WS 主动发送使用纯 userid，不要带 user: 前缀。
openclaw message send --channel wecom --account default --target <用户_ID> --message "Bot WS 测试"

# Agent / Cron 目标支持显式前缀。
openclaw message send --channel wecom --account default --target user:<用户_ID> --message "Agent 出站测试"
```

Bot WebSocket 主动发送时，`user:<id>` 可能触发 `93006 invalid chatid`；请使用企业微信原始 userid。Agent 与 Cron 投递支持 `user:<id>`、`party:<id>`、`tag:<id>`、`group:<id>`、`chat:<id>`。

## 流式与文本格式

| 路径 | 是否流式 | 格式事实 |
|------|:--------:|----------|
| Bot WebSocket | 是 | `replyStream` 是纯文本流式载体；类似 Markdown 的内容可能按纯文本展示或被企业微信规范化。 |
| Bot Webhook | 是 | 使用加密 `msgtype: stream` 与 `stream_refresh`；受 6 分钟 Bot 窗口限制。 |
| Agent 入站回复 | 否 | 一次性 API 发送；Markdown 支持取决于企业微信 API 消息类型和客户端渲染。 |
| 主动出站 / 兜底 | 不是 Bot stream | 按可用性选择 Bot WS `sendMessage` 或 Agent API；企业微信可能按路径剥离或规范化格式。 |

默认体验是 `streaming: false`：展示状态 / 脚注更新，最后一次性给出完整答案。需要打字机效果时再设置 `streaming: true`。详见 [流式架构](../../doc/wecom/OpenClaw-WeCom-Streaming-Architecture.md) 中的 `footer.status`、`footer.elapsed`、`streaming.status`、`streaming.content`。

## 媒体能力

| 方向 | 类型 | 限制或行为 | 说明 |
|------|------|------------|------|
| 入站 | 图片、语音、视频、文件 | 当前路径支持时下载 / 解密 | 写入入站上下文，供 Agent 读取。 |
| 入站 | mixed 与引用消息 | Bot payload 存在时解析 | 具体字段取决于企业微信事件结构。 |
| 出站 | 图片 | Bot 限制 10 MB，超限前尝试兜底 | 可尽可能按文件发送。 |
| 出站 | 语音 | 2 MB AMR | 非 AMR 或超限按文件处理。 |
| 出站 | 视频 | Bot 限制 10 MB，超限前尝试兜底 | 可尽可能按文件发送。 |
| 出站 | 文件 | `media.maxBytes`，常见为 20 MB | 完整出站文件能力依赖 Agent API 或兜底支持。 |
| 本地路径 | 任意本地文件 | 必须位于 `mediaLocalRoots` | 白名单外路径会在上传前被拒绝。 |

安全发送本地文件：

```bash
openclaw config set channels.wecom.mediaLocalRoots '["/data/wecom-media"]'
openclaw config set channels.wecom.media.maxBytes 20971520
```

## 访问控制、多账号与 Cron

| 主题 | 配置 |
|------|------|
| 私聊策略 | `channels.wecom.dmPolicy`：`open`、`pairing`、`allowlist`、`disabled` |
| 群聊策略 | `channels.wecom.groupPolicy`：`open`、`allowlist`、`disabled` |
| 用户白名单 | `channels.wecom.allowFrom` |
| 群白名单 | `channels.wecom.groupAllowFrom` 与 `channels.wecom.groups.<chatId>.allowFrom` |
| 多账号 | `channels.wecom.defaultAccount` + `channels.wecom.accounts.<accountId>` |
| Cron 投递 | 必须配置 Agent 模式和 `agent.agentId` |

Cron 属于主动出站投递，因此必须走 Agent 模式：

```bash
openclaw cron add \
  --name "wecom-daily-brief" \
  --agent main \
  --cron "0 9 * * 1-5" \
  --tz "Asia/Shanghai" \
  --message "今日简报" \
  --announce \
  --channel wecom \
  --to "party:<部门_ID>"
```

## MCP 与内置技能

插件注册 `wecom_mcp`，用于通过 OpenClaw 工具管线直接访问企业微信 API。MCP 传输层包含业务错误、媒体处理、智能表格创建、智能表格导出等拦截器。

内置技能包括 `wecom-contact`、`wecom-doc`、`wecom-meeting`、`wecom-msg`、`wecom-preflight`、`wecom-schedule`、`wecom-send-media`、`wecom-send-template-card`、`wecom-smartsheet`、`wecom-todo`、`wecom-unified`。

## 常见问题与排障

| 现象 | 常见原因 | 快速处理 |
|------|----------|----------|
| `60020 not allow to access from your ip` | 企业微信 API 调用来自未授权出口 IP | 在企微后台加入 Gateway 出口 IP，或配置 `channels.wecom.network.egressProxyUrl`。 |
| `93006 invalid chatid` | Bot WS 主动发送使用了 `user:<id>` | Bot WS 主动发送改用纯 userid：`--target <用户_ID>`。 |
| `Kicked by server: a new connection was established elsewhere` | 多个 Gateway 或重复账号同时连接 | 同一 Bot 账号只保留一个 WS 连接；插件会避免立即重启导致互踢循环。 |
| Bot Webhook 没有最终流式内容 | 回调验证、去重或 stream refresh 路径异常 | 按 [真实联调 Checklist](../../doc/wecom/OpenClaw-WeCom-Integration-Checklist.md#2-webhook-bot-模式) 排查。 |
| 本地媒体路径被拒绝 | 文件不在 `mediaLocalRoots` 下 | 把可信目录加入 `mediaLocalRoots`，不要关闭路径保护。 |
| Cron 没有投递 | 未配置 Agent 或缺少 `agent.agentId` | 补齐 `agent.*` 字段，并确认目标用户 / 部门在应用可见范围内。 |

常用诊断命令：

```bash
openclaw channels list
openclaw channels status --probe
openclaw plugins doctor
openclaw pairing list wecom
```

## 详细文档

Monorepo 内专题文档见 [`doc/wecom/`](../../doc/wecom/)：

| 文档 | 说明 |
|------|------|
| [配置指南](../../doc/wecom/OpenClaw-WeCom-Configuration.zh-CN.md) | 权威分场景配置：Bot WS、Bot Webhook、Agent、双模、多账号、媒体、RAG、代理、Cron。 |
| [真实联调 Checklist](../../doc/wecom/OpenClaw-WeCom-Integration-Checklist.md) | 真实企业微信租户验收清单，覆盖 Bot WS、Bot Webhook、Agent、安全、冒烟测试和日志关键词。 |
| [架构设计](../../doc/wecom/OpenClaw-WeCom-Architecture.md) | 双模式拓扑、源码模块地图、入站流程、出站优先级、MCP 和内置技能。 |
| [流式架构](../../doc/wecom/OpenClaw-WeCom-Streaming-Architecture.md) | Bot stream 协议、状态模型、6 分钟窗口、846608 降级、脚注 / 状态配置。 |
| [联调与测试](../../doc/wecom/OpenClaw-WeCom-Testing.md) | Gateway 手工联调、`message send`、`agent --deliver`、`user:` 前缀 / 93006、媒体检查。 |

配置指南中引用的部分生态文档，例如知识库插件文档，目前主要是中文内容。

## 构建与测试

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm run pack-dry
```

`pnpm test` 当前约 330 个 Vitest 测试用例；具体数量会随源码覆盖变化。

## 更新

```bash
openclaw plugins update @partme.ai/wecom
```

## 关于 openclaw-plugins

本插件属于 [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) 的一部分。该仓库由 **PartMe.AI 团队** 维护，覆盖 IM 渠道、消息队列、AI 能力和基础设施集成。

每个插件在 npm 上独立发布，位于 `@partme.ai` 作用域下：

```bash
openclaw plugins install @partme.ai/openclaw-nacos
openclaw plugins install @partme.ai/wecom
```

PartMe.AI 专注于 AI 客服与企业级 AI Agent 基础设施，提供从企业微信 / 钉钉 / 飞书 / QQ 渠道接入到 RAG 知识库、多层记忆和生产监控的端到端方案。

联系方式：partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)

## 许可证

ISC
