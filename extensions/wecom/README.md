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
