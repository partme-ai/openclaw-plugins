# WeCom (WeChat Work / 企业微信)

**OpenClaw 渠道插件 -- 企业微信 Bot + Agent 双模式深度集成**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fwecom-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-ISC-green)

[English](./README.md) | [简体中文](./README.zh-CN.md)

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
- **11 个内置 Skills**：联系人、文档、待办、会议、日程、消息、smartsheet、模板卡片、预检等
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

#### 方式三：分场景配置指南（推荐）

从「最小 Bot WS」到「双模 + 多账号 + RAG + 高级项」，每场景含完整 JSON、字段说明与验证步骤：

**[WeCom 配置指南（Level 1–11）](../../doc/wecom/OpenClaw-WeCom-Configuration.zh-CN.md)**

最小可用（场景 1）：

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.botId "<YOUR_BOT_ID>"
openclaw config set channels.wecom.secret "<YOUR_BOT_SECRET>"
openclaw gateway restart
openclaw channels status --probe
```

### 模式概览

| 模式 | 连接方式 | 消息格式 | 适用场景 |
|------|---------|---------|---------|
| **Bot**（智能机器人） | WebSocket（默认）或 HTTP Webhook | JSON | 快速接入，流式回复 |
| **Agent**（自建应用） | HTTP Webhook 回调 | XML | 企业应用，API 驱动消息 |

> Bot 模式通过 `connectionMode` 支持两种连接方式：
> - `websocket`（默认）-- WebSocket 长连接，需 `botId` + `secret`
> - `webhook` -- HTTP 回调，需 `token` + `encodingAESKey`

### 配置参考

Bot / Agent / 双模 / 多账号 / 流式 / 访问控制 / 媒体 / RAG / 高级项的**完整 JSON 与字段说明**见：

**[WeCom 配置指南](../../doc/wecom/OpenClaw-WeCom-Configuration.zh-CN.md)**

常用 CLI 速查：

```bash
# Bot WebSocket（场景 1）
openclaw config set channels.wecom.botId "<YOUR_BOT_ID>"
openclaw config set channels.wecom.secret "<YOUR_BOT_SECRET>"

# Agent 回调（场景 6）— 先配 Gateway，再在企微后台保存 URL
openclaw config set channels.wecom.agent.corpId "<CORP_ID>"
openclaw config set channels.wecom.agent.corpSecret "<SECRET>"
openclaw config set channels.wecom.agent.agentId 1000002
openclaw config set channels.wecom.agent.token "<TOKEN>"
openclaw config set channels.wecom.agent.encodingAESKey "<AES_KEY>"

# 出口代理（错误 60020）
openclaw config set channels.wecom.network.egressProxyUrl "http://proxy.company.local:3128"
```

## 详细文档

Monorepo 内专题文档见 [`doc/wecom/`](../../doc/wecom/)：

| 文档 | 说明 |
|------|------|
| [**配置指南（权威）**](../../doc/wecom/OpenClaw-WeCom-Configuration.zh-CN.md) | Level 1–11 场景 JSON、字段说明、验证步骤、FAQ |
| [架构设计](../../doc/wecom/OpenClaw-WeCom-Architecture.md) | 双模式拓扑、源码模块地图、入站主流程、流式概要 |
| [流式架构](../../doc/wecom/OpenClaw-WeCom-Streaming-Architecture.md) | `replyStream` 生命周期、6 分钟窗口、846608 降级、状态机 |
| [联调测试](../../doc/wecom/OpenClaw-WeCom-Testing.md) | `message send`、`agent --deliver`、`user:` 前缀（93006）、配对 |
| [Feishu SDK 对照](../../doc/wecom/OpenClaw-WeCom-Feishu-SDK-Inventory.md) | OpenClaw plugin-sdk 与飞书通道映射、message-sdk 承接 |

## 访问控制与 Cron

私聊/群聊策略、配对命令、Cron 目标格式与示例见配置指南 [场景 4](../../doc/wecom/OpenClaw-WeCom-Configuration.zh-CN.md#4-访问控制私聊与群聊策略)、[场景 11](../../doc/wecom/OpenClaw-WeCom-Configuration.zh-CN.md#11-cron-定时推送)。

## 联调测试

Gateway 环境下的手工联调步骤见上文 [联调测试](../../doc/wecom/OpenClaw-WeCom-Testing.md) 文档（主动发消息、多 Bot、`message send` / `agent --deliver`、93006 等）。

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
openclaw plugins install @partme.ai/openclaw-nacos
openclaw plugins install @partme.ai/wecom
```

**PartMe.AI** 专注于 AI 客服与企业级 AI Agent 基础设施，提供从企业微信 / 钉钉 / 飞书 / QQ 渠道集成到 RAG 知识库、多层记忆和生产监控的端到端解决方案。

> 联系方式：partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)

## 许可证

ISC
