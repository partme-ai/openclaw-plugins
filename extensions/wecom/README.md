<div align="center">

# OpenClaw WeCom

**OpenClaw 企业微信渠道插件：Bot WebSocket、Bot Webhook 与自建应用 Agent 双模集成**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fwecom-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-ISC-green)

[简体中文](./README.md) | [English](./README.en.md)

</div>

`@partme.ai/wecom` 用于把 OpenClaw 接入企业微信。它面向中国企业微信用户，支持智能机器人 Bot WebSocket、Bot HTTP Webhook 和自建应用 Agent 三条路径：Bot 负责低门槛交互式对话与流式回复，Agent 负责主动推送、Cron 定时投递、部门/标签广播和完整文件兜底。

当前版本：`2026.5.24`。依赖 `@partme.ai/openclaw-message-sdk`：`2026.5.24`。`pnpm test` 当前约 330 个 Vitest 用例，数量会随源码覆盖变化。

## 核心能力

- **三种运行模式**：Bot WebSocket、Bot Webhook、自建应用 Agent 加密回调。
- **流式回复**：支持 `replyStream` / Webhook `stream`，包含思考占位、状态文案、脚注和 846608 降级。
- **Bot 与 Agent 共存**：生产环境通常用 Bot 做对话，用 Agent 做主动推送、Cron 和文件兜底。
- **平铺配置**：运行时配置位于 `channels.wecom`；多账号位于 `channels.wecom.accounts.<accountId>`。
- **多账号路由**：支持 `defaultAccount` 与账号级覆盖，用于多团队、多租户或多 Bot。
- **访问控制**：私聊策略 `open` / `pairing` / `allowlist` / `disabled`，群聊策略 `open` / `allowlist` / `disabled`。
- **媒体处理**：支持入站图片、语音、视频、文件、mixed 图文混排、引用消息；出站本地文件受 `mediaLocalRoots` 白名单保护。
- **MCP 与 Skills**：注册 `wecom_mcp`，并提供联系人、文档、日程、会议、消息、媒体、模板卡片、smartsheet、待办、预检和统一操作等技能。

## 重要事实

- 只要同一账号存在 `botId` + `secret`，运行时优先启动 Bot WebSocket；即使 `connectionMode` 写成 `webhook` 也会走 WS。纯 Bot Webhook 请不要配置 `botId` 和 `secret`。
- `agent.agentId` 是主动推送、Cron 和 Agent 兜底投递的必填字段。
- Bot WebSocket 主动发送使用企业微信原始 `userid`，不要带 `user:` 前缀，否则可能触发 `93006 invalid chatid`。
- Bot stream 是纯文本流式载体；Markdown 是否展示为富文本取决于实际出站路径与企业微信客户端。

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
      "streaming": {
        "enabled": true,
        "status": true,
        "content": true
      },
      "footer": {
        "status": true,
        "elapsed": true
      },
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

## 模式选择

| 模式 | 连接方式 | 凭据 | 适合场景 |
|------|----------|------|----------|
| Bot WebSocket | 长连接 WS | `botId` + `secret` | 快速聊天、私聊/群聊、流式回复 |
| Bot Webhook | HTTPS 回调 | `token` + `encodingAESKey` + 可选 `receiveId` | 无法保持 WS 的部署环境 |
| Agent 自建应用 | HTTPS 回调 + 企微 API | `corpId` + `corpSecret` + `agentId` + `token` + `encodingAESKey` | 主动推送、Cron、部门/标签、文件兜底 |
| 双模生产 | Bot WS + Agent | Bot 凭据 + `agent.*` | 生产默认方案 |

推荐回调地址：

| 路径 | 推荐 URL |
|------|----------|
| Bot Webhook | `https://<GATEWAY_HOST>/plugins/wecom/bot/<accountId>` |
| Agent Webhook | `https://<GATEWAY_HOST>/plugins/wecom/agent/<accountId>` |

旧路径 `/wecom`、`/wecom/bot`、`/wecom/agent` 仍用于兼容，新部署建议使用 `/plugins/wecom/...`。

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

## 常见问题

| 现象 | 常见原因 | 处理方式 |
|------|----------|----------|
| `60020 not allow to access from your ip` | 企业微信 API 调用来自未授权出口 IP | 在企微后台加入 Gateway 出口 IP，或配置 `channels.wecom.network.egressProxyUrl` |
| `93006 invalid chatid` | Bot WS 主动发送使用了 `user:<id>` | Bot WS 主动发送改用纯 `userid` |
| `Kicked by server: a new connection was established elsewhere` | 多个 Gateway 或重复账号同时连接 | 同一 Bot 账号只保留一个 WS 连接 |
| Bot Webhook 没有最终流式内容 | 回调验证、去重或 stream refresh 路径异常 | 按真实联调 Checklist 排查 |
| 本地媒体路径被拒绝 | 文件不在 `mediaLocalRoots` 下 | 把可信目录加入 `mediaLocalRoots` |
| Cron 没有投递 | 未配置 Agent 或缺少 `agent.agentId` | 补齐 `agent.*` 字段并确认目标可见范围 |

## 深入文档

- [配置指南](../../doc/wecom/OpenClaw-WeCom-Configuration.zh-CN.md)：Bot WS、Bot Webhook、Agent、双模、多账号、媒体、RAG、代理、Cron。
- [真实联调 Checklist](../../doc/wecom/OpenClaw-WeCom-Integration-Checklist.md)：真实企业微信租户验收清单。
- [架构设计](../../doc/wecom/OpenClaw-WeCom-Architecture.md)：双模式拓扑、模块地图、入站/出站优先级、MCP 和 Skills。
- [流式架构](../../doc/wecom/OpenClaw-WeCom-Streaming-Architecture.md)：Bot stream 协议、6 分钟窗口、846608 降级。
- [联调与测试](../../doc/wecom/OpenClaw-WeCom-Testing.md)：Gateway 手工联调、目标格式、设备授权和媒体检查。

## 许可证

ISC
