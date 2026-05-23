# 企业微信（WeCom）Channel 插件配置指南

`@partme.ai/wecom` 是 openclaw-plugins 的旗舰插件，支持企业微信智能机器人 + 自建应用双模式接入。

## 功能亮点

- **Bot + Agent 双模**：WebSocket 长连接实时对话 + HTTP API 文件/广播兜底
- **多账号矩阵**：无限扩展的账号隔离，每账号独立 bot/agent 配置
- **20 个内置 Skills**：通讯录、文档、日程、待办、会议、智能表格等
- **全媒体支持**：图片/视频/语音/文件收发，自动降级
- **动态 Agent**：per-user/per-group 自动创建隔离 Agent
- **流式响应**：打字机效果 + 非阻塞发送
- **MCP 工具**：`wecom_mcp` 直接调用企微 MCP Server

## 模式对比

| 能力 | Bot (智能机器人) | Agent (自建应用) |
|------|:---:|:---:|
| 接收消息 | 文本/图片/语音/文件/引用 | 文本/图片/语音/视频/位置 |
| 群聊 | ✅ @机器人触发 | ❌ 仅私聊 |
| 流式响应 | ✅ 打字机效果 | ❌ |
| 主动推送 | ❌ | ✅ 指定用户/部门/标签 |
| 文件发送 | ✅ 图片/Markdown | ✅ 全格式 |
| 配置复杂度 | 简单 (无需公网 IP) | 中等 (需公网 IP) |

## 安装

```bash
openclaw plugins install @partme.ai/wecom
```

## 快速配置

### Bot 模式（推荐，无需公网 IP）

企业微信管理后台 → 安全与管理 → 管理工具 → 智能机器人 → 创建（API 模式）

记录 **Bot ID** 和 **Secret**：

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.accounts.default.botId "<YOUR_BOT_ID>"
openclaw config set channels.wecom.accounts.default.secret "<YOUR_SECRET>"
openclaw gateway restart
```

### Agent 模式（需要公网 IP）

企业微信管理后台 → 应用管理 → 自建应用 → 创建

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.accounts.default.agent.corpId "<CORP_ID>"
openclaw config set channels.wecom.accounts.default.agent.corpSecret "<SECRET>"
openclaw config set channels.wecom.accounts.default.agent.agentId 1000002
openclaw config set channels.wecom.accounts.default.agent.token "<TOKEN>"
openclaw config set channels.wecom.accounts.default.agent.encodingAESKey "<AES_KEY>"
openclaw gateway restart
```

### 双模（推荐，同时启用）

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "main",
      "accounts": {
        "main": {
          "botId": "your-bot-id",
          "secret": "your-secret",
          "agent": {
            "corpId": "ww1234567890abcdef",
            "corpSecret": "your-corp-secret",
            "agentId": 1000002,
            "token": "your-token",
            "encodingAESKey": "your-aes-key-43-chars"
          }
        }
      }
    }
  }
}
```

## 多账号

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "ops",
      "accounts": {
        "ops": {
          "name": "运维助手",
          "botId": "bot-ops",
          "secret": "secret-ops"
        },
        "sales": {
          "name": "销售助手",
          "dmPolicy": "allowlist",
          "allowFrom": ["zhangsan", "lisi"],
          "botId": "bot-sales",
          "secret": "secret-sales"
        }
      }
    }
  }
}
```

## 访问控制

### DM 策略

| 策略 | 行为 |
|------|------|
| `open` | 所有用户可私聊 |
| `pairing` | 新用户需审批 |
| `allowlist` | 仅白名单用户 |
| `disabled` | 禁止私聊 |

```bash
# 审批配对请求
openclaw pairing list wecom
openclaw pairing approve wecom <CODE>
```

### 群聊策略

```json
{
  "groupPolicy": "allowlist",
  "groupAllowFrom": ["group_id_1"]
}
```

## 配置参考

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "main",
      "connectionMode": "websocket",
      "sendThinkingMessage": true,
      "dmPolicy": "open",
      "groupPolicy": "open",
      "dynamicAgents": {
        "enabled": false,
        "dmCreateAgent": true,
        "groupEnabled": true,
        "adminUsers": ["admin"]
      },
      "network": {
        "egressProxyUrl": "http://proxy:3128",
        "timeoutMs": 15000
      },
      "media": {
        "maxBytes": 20971520,
        "tempDir": "/tmp/wecom-media"
      },
      "accounts": {
        "main": {
          "botId": "...",
          "secret": "...",
          "agent": {
            "corpId": "...",
            "corpSecret": "...",
            "agentId": 1000002,
            "token": "...",
            "encodingAESKey": "..."
          }
        }
      }
    }
  }
}
```

## Webhook 路径

| 模式 | 路径 |
|------|------|
| Bot (推荐) | `/plugins/wecom/bot/<accountId>` |
| Agent (推荐) | `/plugins/wecom/agent/<accountId>` |
| Bot (兼容) | `/plugins/wecom/bot` |
| Agent (兼容) | `/plugins/wecom/agent` |

## 常见问题

### 报错 60020

```
60020 not allow to access from your ip
```

配置出口代理（适用于动态 IP / 内网穿透场景）：

```bash
openclaw config set channels.wecom.network.egressProxyUrl "http://proxy.company.local:3128"
```

### 群聊发文件失败

企业微信 Bot 接口不支持发送非图片文件。插件会自动通过 Agent 私信发送，并在群里提示"文件已私信发给您"。

## 流式输出架构

Bot 流式回复（WebSocket / Webhook 双路径、Feishu 式 `streaming` / `footer` 开关、默认模式 vs 流式模式）见：

**[OpenClaw-WeCom-Streaming-Architecture.md](./OpenClaw-WeCom-Streaming-Architecture.md)**

快速开关示例：

```bash
# 默认：状态栏过程 + 最终一次出结果
openclaw config set channels.wecom.streaming false
openclaw config set channels.wecom.footer.status true

# 流式：中间状态 + 结果打字机
openclaw config set channels.wecom.streaming true
openclaw config set channels.wecom.streaming.status true
openclaw config set channels.wecom.streaming.content true
```

### 文案模板

用户可见状态栏、关流脚注、空回复与 Webhook 队列 Ack 文案可通过 `channels.wecom.templates` 覆盖（默认值与历史行为一致）：

```bash
openclaw config set channels.wecom.templates.thinking "正在思考…"
openclaw config set channels.wecom.templates.tool "正在调用 {toolName}…"
openclaw config set channels.wecom.templates.compaction "📦 正在压缩上下文…"
openclaw config set channels.wecom.templates.emptyReply "⚠️ 未能生成可展示的回复，请稍后重试。"
openclaw config set channels.wecom.templates.finishFooter "⏱ {elapsed}s · 已完成"
openclaw config set channels.wecom.templates.welcome "你好，我是助手"
```

账号级：`channels.wecom.accounts.<accountId>.templates.thinking`

## 联调与测试

手工联调（入站/出站、多 Bot、`message send`、`agent --deliver`、常见报错）见：

**[OpenClaw-WeCom-Testing.md](./OpenClaw-WeCom-Testing.md)**
