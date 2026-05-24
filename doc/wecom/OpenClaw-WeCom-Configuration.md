# 企业微信（WeCom）Channel 插件配置指南

`@partme.ai/wecom` 是 openclaw-plugins 的旗舰插件，支持企业微信智能机器人 + 自建应用双模式接入。

**渐进式配置（Level 1–10 完整 JSON + 验证）**：[configuration-examples.zh-CN.md](./configuration-examples.zh-CN.md)

**架构总览**（双模式、源码模块、入站主流程、流式概要）：**[OpenClaw-WeCom-Architecture.md](./OpenClaw-WeCom-Architecture.md)**

## 功能亮点

- **Bot + Agent 双模**：WebSocket 长连接实时对话 + HTTP API 文件/广播兜底
- **多账号矩阵**：无限扩展的账号隔离，每账号独立 bot/agent 配置
- **11 个内置 Skills**：通讯录、文档、日程、待办、会议、智能表格等
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
openclaw config set channels.wecom.botId "<YOUR_BOT_ID>"
openclaw config set channels.wecom.secret "<YOUR_SECRET>"
openclaw gateway restart
```

单账号也可平铺配置；多账号见 [Level 8 示例](./configuration-examples.zh-CN.md#level-8--多账号)。

### Agent 模式（需要公网 IP）

企业微信管理后台 → 应用管理 → 自建应用 → 创建

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.agent.corpId "<CORP_ID>"
openclaw config set channels.wecom.agent.corpSecret "<SECRET>"
openclaw config set channels.wecom.agent.agentId 1000002
openclaw config set channels.wecom.agent.token "<TOKEN>"
openclaw config set channels.wecom.agent.encodingAESKey "<AES_KEY>"
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

Bot（WebSocket / Webhook）与 Agent 回调均执行同一套 **dmPolicy / groupPolicy** 门禁；Webhook pairing 码经 `response_url` 主动推送，Agent pairing 经应用 API 私信下发。

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
        "agentReplyTimeoutMs": 360000,
        "timeoutMs": 15000
      },
      "media": {
        "maxBytes": 20971520
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

> **未接线配置项**（仅 TypeScript 类型，运行时勿依赖）：`media.tempDir`、`media.retentionHours`、`media.cleanupOnStart`、`network.retries`、`network.retryDelayMs`。详见 [渐进式配置 §未实现](./configuration-examples.zh-CN.md#未实现配置项速查)。

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

## 架构与流式

- **插件架构**（双模式拓扑、模块地图、入站三路流程）：**[OpenClaw-WeCom-Architecture.md](./OpenClaw-WeCom-Architecture.md)**
- **流式专题**（协议、状态机、846608 降级、演进路线）：**[OpenClaw-WeCom-Streaming-Architecture.md](./OpenClaw-WeCom-Streaming-Architecture.md)**

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

### 用户可见文案（*Text）

在 `channels.wecom` **平铺 `*Text` 字段**（与 `welcomeText` 同一命名习惯）。支持 `{elapsed}`、`{toolName}`、`{minutes}` 等占位符（见各字段说明）。

| 配置键 | 默认 | 占位符 | 用途 |
|--------|------|--------|------|
| `welcomeText` | （空） | — | enter_chat / subscribe 欢迎语 |
| `thinkingText` | `正在思考…` | — | 流式气泡 **状态栏**（思考阶段） |
| `toolStatusText` | `正在查资料…` | `{toolName}` | 工具调用状态栏 |
| `readingText` | `正在阅读附件…` | — | 入站含附件 |
| `generatingText` | `正在组织回复…` | — | 开始生成答案 |
| `streamPlaceholderText` | （见下） | — | **流式首帧** replyStream 占位（协议层） |
| `queuedText` / `mergedQueuedText` / … | 见源码默认值 | — | Webhook 队列 Ack |

完整键名见 `extensions/wecom/src/text-config.ts`（`WECOM_TEXT_KEY_MAPPING`）；默认值见 `WECOM_DEFAULT_TEMPLATES`。

```bash
openclaw config set channels.wecom.welcomeText "你好，我是助手"
openclaw config set channels.wecom.thinkingText "正在思考…"
openclaw config set channels.wecom.toolStatusText "正在调用 {toolName}…"
openclaw config set channels.wecom.finishFooterText "⏱ {elapsed}s · 已完成"

# 多账号：账号级 scalar 覆盖顶层同名字段
openclaw config set channels.wecom.accounts.bot2.thinkingText "Bot2 思考中…"
```

#### `streamPlaceholderText` 是什么？

**有必要**，但与 `welcomeText` / `thinkingText` **不是一回事**：

| 字段 | 层级 | 何时出现 |
|------|------|----------|
| `welcomeText` | 业务文案 | 用户 **进入会话**（`enter_chat`）单独一条欢迎 |
| `thinkingText` | 业务文案 | 回复进行中，stream 气泡 **状态栏**（「正在思考…」） |
| `streamPlaceholderText` | **协议占位** | Bot 开始流式回复时 **第一条** `replyStream` 的 `content` |

企微 Bot 流式要求先占住 stream：`finish=false` 的首帧不能为空。Webhook 未配置时回退 `"1"`；WebSocket 未配置时回退 `<think></think>`（`THINKING_MESSAGE`）。

- 一般 **不用改** `streamPlaceholderText`。
- **不要**用它当欢迎语；欢迎语只用 `welcomeText`。

```bash
openclaw config set channels.wecom.streamPlaceholderText "1"
```

各文案在流式气泡中的触发时机见 **[Streaming 架构 §10.3](./OpenClaw-WeCom-Streaming-Architecture.md#用户可见文案text)**。

## 联调与测试

手工联调（入站/出站、多 Bot、`message send`、`agent --deliver`、常见报错）见：

**[OpenClaw-WeCom-Testing.md](./OpenClaw-WeCom-Testing.md)**
