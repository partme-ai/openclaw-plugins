# OpenClaw 企业微信配置指南

本文档是 `@partme.ai/wecom` 的中文权威配置指南。示例按场景组织，可复制到 `~/.openclaw/openclaw.json` 或你的 Gateway 配置文件中。

企业微信配置位于 `channels.wecom.*`。多账号配置使用 `channels.wecom.accounts.<accountId>`，账号级字段会覆盖顶层同名字段。

相关文档：[架构](./OpenClaw-WeCom-Architecture.md)、[流式](./OpenClaw-WeCom-Streaming-Architecture.md)、[联调测试](./OpenClaw-WeCom-Testing.md)、[README](../../extensions/wecom/README.md)

## 场景索引

1. [最小 Bot WebSocket / 基础私聊对话](#1-最小-bot-websocket--基础私聊对话)
2. [欢迎语与用户可见文案模板](#2-欢迎语与用户可见文案模板)
3. [流式输出 / 脚注 / 思考消息](#3-流式输出--脚注--思考消息)
4. [访问控制：私聊与群聊策略](#4-访问控制私聊与群聊策略)
5. [媒体：图片、文件、语音、视频、本地路径、大小上限](#5-媒体图片文件语音视频本地路径大小上限)
6. [Agent 模式 / 自建应用 / 主动推送](#6-agent-模式--自建应用--主动推送)
7. [Bot WebSocket + Agent 双模生产配置](#7-bot-websocket--agent-双模生产配置)
8. [多账号](#8-多账号)
9. [知识库 / RAG 集成](#9-知识库--rag-集成)
10. [高级：dynamicAgents、出口代理、ASR、Bot Webhook 替代方案](#10-高级dynamicagents出口代理asrbot-webhook-替代方案)
11. [Cron 定时推送](#11-cron-定时推送)

## 如何使用本指南

只需要 Bot 对话时从场景 1 开始；只需要自建应用、主动推送或 Cron 时从场景 6 开始；生产双模部署优先看场景 7。复制完整 JSON，替换占位符，重启 Gateway，再按对应场景的验证步骤执行。

运行时配置是 `channels.wecom.*` 与 `channels.wecom.accounts.<accountId>.*` 的平铺结构。不要把 `bot.*`、`botIds`、`aibotid` 当作主要运行时配置；Bot WebSocket 使用 `botId` + `secret`，Bot Webhook 使用 `token` + `encodingAESKey`。

## 1. 最小 Bot WebSocket / 基础私聊对话

### 何时使用

需要最快接入企业微信智能机器人私聊时使用。Bot WebSocket 不需要公网回调地址。

### 前置条件

- 安装插件：`openclaw plugins install @partme.ai/wecom`
- 在企业微信后台进入 **安全与管理 -> 管理工具 -> 智能机器人**，创建 **API 模式**机器人，并复制 Bot ID 与 Secret。API 模式表示 OpenClaw 使用官方 Bot API 连接，而不是普通群机器人 Webhook。
- 复制 Bot ID 和 Secret。
- 使用 Node.js 22+ 与 OpenClaw 2026.4.12+。

### 完整 JSON

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

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `enabled` | 是 | 启用企业微信通道。 |
| `connectionMode` | 否 | 使用 `websocket` 表示 Bot WebSocket，这是默认模式。 |
| `botId` | 是 | 企业微信智能机器人 Bot ID。 |
| `secret` | 是 | 企业微信智能机器人 Secret。 |

只要同一账号存在 `botId` + `secret`，插件就会启动 Bot WebSocket，即使 `connectionMode` 写成 `webhook`。如果要纯 Bot Webhook，请不要配置 `botId` 与 `secret`，见场景 10。

### 验证步骤

```bash
openclaw gateway restart
openclaw channels status --probe
```

在企业微信中向 Bot 发送 `你好`。应收到 AI 回复，Gateway 日志应出现 WebSocket 鉴权成功。

## 2. 欢迎语与用户可见文案模板

### 何时使用

需要定制用户进入会话、助手思考、工具调用、读取附件、超时等用户可见文案时使用。

### 前置条件

- 场景 1 已可用。
- 已确定企业希望展示给用户的文案。

### 完整 JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<你的_BOT_ID>",
      "secret": "<你的_BOT_SECRET>",
      "welcomeText": "你好，我是企业 AI 助手，有什么可以帮你？",
      "receivedText": "已收到，正在处理...",
      "thinkingText": "正在思考...",
      "toolStatusText": "正在调用 {toolName}...",
      "readingText": "正在读取附件...",
      "generatingText": "正在生成回答...",
      "compactionText": "正在压缩上下文...",
      "queuedText": "已加入队列，稍后处理。",
      "mergedQueuedText": "已收到新消息，将合并到本次请求。",
      "mergedDoneText": "已合并最近几条消息。",
      "streamPlaceholderText": "1",
      "emptyReplyText": "抱歉，本次没有生成有效回答。",
      "timeoutText": "处理超时，请稍后再试。"
    }
  }
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `welcomeText` | 用户进入会话或订阅时发送的欢迎语。 |
| `receivedText` | 入站消息被接收后的可选确认文案。 |
| `thinkingText` | 助手准备回答时展示的状态文案。 |
| `toolStatusText` | 工具调用状态文案，支持 `{toolName}`。 |
| `readingText` | 读取附件时展示的状态文案。 |
| `generatingText` | 开始生成回答时展示的状态文案。 |
| `compactionText` | 长上下文压缩时展示的状态文案。 |
| `queuedText` | 请求排队时展示的确认文案。 |
| `mergedQueuedText` / `mergedDoneText` | Bot Webhook 防抖合并消息时展示的文案。 |
| `streamPlaceholderText` | Bot 流式首帧协议占位，不是欢迎语。 |
| `emptyReplyText` | Agent 返回空内容时的兜底文案。 |
| `timeoutText` | 请求处理超时时的兜底文案。 |

其他支持的平铺文案键包括 `cardSentText`、`mediaSentText`、`mediaParseFailedText`、`mediaDeliveredText`、`processedCompleteText`、`dispatchErrorText`、`mediaErrorNoAccessText`、`mediaErrorReasonText`、`mediaErrorGenericText`、`sessionResetText`、`sessionNewText`。账号级文案会覆盖顶层文案。

### 验证步骤

1. 重启 Gateway。
2. 重新打开企业微信 Bot 私聊窗口。
3. 确认欢迎语出现。
4. 发送需要推理或工具调用的问题，确认状态文案已替换。

## 3. 流式输出 / 脚注 / 思考消息

### 何时使用

需要打字机式增量回复、完成脚注、耗时展示，或控制“思考中”占位消息时使用。

### 前置条件

- 场景 1 已可用。
- 推荐使用 Bot WebSocket 获得最佳流式体验。

### 完整 JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<你的_BOT_ID>",
      "secret": "<你的_BOT_SECRET>",
      "sendThinkingMessage": true,
      "thinkingText": "正在思考...",
      "streaming": {
        "enabled": true,
        "status": true,
        "content": true
      },
      "footer": {
        "status": true,
        "elapsed": true
      },
      "finishFooterText": "已完成，用时 {elapsed}s"
    }
  }
}
```

`streaming` 也支持布尔值。`false` 表示状态 / 最终整包模式，`true` 表示启用默认流式子选项。上面的对象形式是推荐写法，因为可以分别控制状态更新和正文增量更新。

### 字段说明

| 字段 | 说明 |
|------|------|
| `sendThinkingMessage` | 是否发送思考占位消息，默认 `true`。 |
| `streaming` | 布尔值或对象。推荐对象形式：`{ "enabled": true, "status": true, "content": true }`。 |
| `streaming.enabled` | 启用增量流式输出。 |
| `streaming.status` | 流式更新工具或阶段状态。 |
| `streaming.content` | 流式更新回答正文。 |
| `footer.status` | 启用状态 / 脚注渲染。 |
| `footer.elapsed` | 结束时展示耗时。 |
| `finishFooterText` | 完成脚注模板，支持 `{elapsed}`。 |

### 验证步骤

```bash
openclaw gateway restart
```

发送一个较长问题。Bot 应逐段更新回答，并在结束时展示配置的脚注。

## 4. 访问控制：私聊与群聊策略

### 何时使用

只允许指定用户、指定群或指定群成员使用 Bot / Agent 时使用。

### 前置条件

- 场景 1 已可用。
- 已获得允许访问的企业微信用户 ID 与群聊 ID。

### 完整 JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<你的_BOT_ID>",
      "secret": "<你的_BOT_SECRET>",
      "dmPolicy": "pairing",
      "allowFrom": ["<用户_ID_1>", "<用户_ID_2>"],
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["<群聊_ID>"],
      "groups": {
        "<群聊_ID>": {
          "allowFrom": ["<用户_ID_1>", "<管理员用户_ID>"]
        }
      }
    }
  }
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `dmPolicy` | 私聊策略：`open`、`pairing`、`allowlist`、`disabled`。 |
| `allowFrom` | 私聊用户白名单，用于 `allowlist` 与授权流程。 |
| `groupPolicy` | 群聊策略：`open`、`allowlist`、`disabled`。 |
| `groupAllowFrom` | `groupPolicy` 为 `allowlist` 时允许的群聊 ID。 |
| `groups.<chatId>.allowFrom` | 指定群内允许触发机器人的用户白名单。 |

### 验证步骤

```bash
openclaw gateway restart
openclaw pairing list wecom
openclaw pairing approve wecom <配对码>
```

未授权用户私聊时应收到配对码。授权用户应正常收到回复。群聊中只有已配置的群与用户能触发 Bot。

不同路径的策略字段不同：

| 运行路径 | 私聊策略字段 | 群聊策略字段 | pairing 投递 |
|----------|--------------|--------------|--------------|
| Bot WebSocket | `channels.wecom.dmPolicy` | `channels.wecom.groupPolicy` | Bot WS 私聊 |
| Bot Webhook | `channels.wecom.dmPolicy` | `channels.wecom.groupPolicy` | Webhook 响应 / stream |
| Agent | `channels.wecom.agent.dmPolicy` | 不适用 | Agent API 私聊 |

## 5. 媒体：图片、文件、语音、视频、本地路径、大小上限

### 何时使用

用户会向企业微信发送媒体，或 Agent 回复需要从可信本地路径发送文件时使用。

### 前置条件

- 入站媒体需要场景 1 已可用。
- 完整出站文件能力需要场景 6 的 Agent 模式。
- 已创建允许插件读取的本地目录。

### 完整 JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<你的_BOT_ID>",
      "secret": "<你的_BOT_SECRET>",
      "mediaLocalRoots": [
        "~/Downloads",
        "~/Documents/openclaw-reports"
      ],
      "media": {
        "maxBytes": 20971520
      },
      "mediaErrorNoAccessText": "该文件路径未授权，请联系管理员配置 mediaLocalRoots。"
    }
  }
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `mediaLocalRoots` | 出站文件读取白名单目录，支持 `~`。 |
| `media.maxBytes` | 文件大小上限，单位字节；示例为 20 MB。 |
| `mediaErrorNoAccessText` | 文件路径不在白名单内时展示给用户的文案。 |

媒体行为：

| 方向 | 类型 | 限制 | 降级行为 |
|------|------|------|----------|
| 入站 | 图片、语音、视频、文件 | 受企业微信平台限制 | 支持时下载 / 解密后写入入站上下文。 |
| 出站 | 图片 | 10 MB | 尽可能降级为文件发送。 |
| 出站 | 视频 | 10 MB | 尽可能降级为文件发送。 |
| 出站 | 语音 | 2 MB AMR | 非 AMR 或超限时按文件处理。 |
| 出站 | 文件 | `media.maxBytes` | 超限时拒绝发送。 |

本地文件发送受 `mediaLocalRoots` 白名单保护；白名单外路径会在上传前拒绝。`media.tempDir`、`media.retentionHours`、`media.cleanupOnStart` 目前只是类型 / 规划字段，运行时清理逻辑尚未接线。

### 验证步骤

1. 重启 Gateway。
2. 向 Bot 发送图片，确认助手可以读取。
3. 让 Agent 发送 `mediaLocalRoots` 下的文件，确认发送成功。
4. 尝试发送白名单外路径，确认出现配置的错误文案。

## 6. Agent 模式 / 自建应用 / 主动推送

### 何时使用

需要企业微信自建应用、主动推送、定时投递、部门或标签广播、完整格式出站媒体时使用。

### 前置条件

- 在企业微信后台创建 **自建应用**，记录 Corp ID、Secret 与 Agent ID，并确认应用可见范围包含测试用户。
- 开启 **API 接收消息**，复制 Token 与 EncodingAESKey。请先在 Gateway 配置相同值，再回到企微后台保存回调 URL。
- Gateway 需要能被企业微信公网访问，或使用内网穿透。
- 先配置 Gateway，再到企业微信后台保存回调地址。

### 完整 JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "agent": {
        "corpId": "<你的_CORP_ID>",
        "corpSecret": "<你的_CORP_SECRET>",
        "agentId": "<你的_AGENT_ID>",
        "token": "<你的回调_TOKEN>",
        "encodingAESKey": "<你的_43位_ENCODING_AES_KEY>",
        "welcomeText": "欢迎使用企业应用助手。"
      },
      "network": {
        "agentReplyTimeoutMs": 360000
      }
    }
  }
}
```

回调地址：

```text
https://<你的_GATEWAY_HOST>/plugins/wecom/agent/default
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `agent.corpId` | 企业微信 Corp ID。 |
| `agent.corpSecret` | 自建应用 Secret。 |
| `agent.agentId` | 自建应用 Agent ID。 |
| `agent.token` | 回调验证 Token。 |
| `agent.encodingAESKey` | 43 位回调 AES 密钥。 |
| `agent.welcomeText` | Agent 模式欢迎语。 |
| `network.agentReplyTimeoutMs` | Agent 回复超时时间，单位毫秒。 |

Agent 入站回复需要 `corpId`、`corpSecret`、`token`、`encodingAESKey`。主动发送、Cron 与兜底投递还需要 `agent.agentId`。如果企业微信返回 `60020 not allow to access from your ip`，请在企微后台加入可信 IP，或配置 `network.egressProxyUrl`。

### 验证步骤

```bash
openclaw gateway restart
openclaw channels status --probe
openclaw message send --channel wecom --account default --target user:<用户_ID> --message "Agent 出站测试"
```

在企业微信中打开自建应用并发送私聊，应收到 Agent 回复。

主动投递目标支持 `user:<id>`、`party:<id>`、`tag:<id>`、`group:<id>`、`chat:<id>`。

## 7. Bot WebSocket + Agent 双模生产配置

### 何时使用

生产环境推荐使用。Bot WebSocket 负责交互式流式对话，Agent 负责主动推送、Cron、文件兜底和完整格式出站。

### 前置条件

- 场景 1 的 Bot 凭据已准备好。
- 场景 6 的 Agent 凭据已准备好。
- 如需本地文件投递，已配置 `mediaLocalRoots`。

### 完整 JSON

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
        "egressProxyUrl": "http://<你的代理主机>:3128"
      }
    }
  }
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `botId` / `secret` | 用于交互式对话的 Bot WebSocket 凭据。 |
| `streaming` | 启用 Bot 增量流式回复。 |
| `footer` | 启用流式脚注与状态展示。 |
| `mediaLocalRoots` / `media.maxBytes` | 控制本地媒体发送。 |
| `agent.*` | 自建应用凭据，用于主动推送与兜底发送。 |
| `network.egressProxyUrl` | 固定出口 IP 所需的 HTTP 代理。 |
| `network.agentReplyTimeoutMs` | Agent 回复超时时间。 |

### 验证步骤

1. 重启 Gateway。
2. 发送 Bot 私聊，确认流式回复正常。
3. 通过 Agent 发送本地文件，确认投递成功。
4. 如使用 Cron，按场景 11 验证定时投递。

兜底顺序是 Bot WS 优先，Agent HTTP API 兜底。常见误区：同一账号写了 `connectionMode: "webhook"`，但仍保留 `botId` + `secret`，运行时仍会优先启动 Bot WS。

## 8. 多账号

### 何时使用

不同团队、环境或业务线需要不同 Bot / Agent 凭据、访问策略和默认出站账号时使用。

### 前置条件

- 已为每个账号创建企业微信 Bot 或自建应用凭据。
- 已选择稳定账号 ID，例如 `ops`、`sales`、`prod`。

### 完整 JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "ops",
      "dmPolicy": "open",
      "streaming": {
        "enabled": true,
        "status": true,
        "content": true
      },
      "accounts": {
        "ops": {
          "name": "运维助手",
          "botId": "<运维_BOT_ID>",
          "secret": "<运维_BOT_SECRET>",
          "agent": {
            "corpId": "<运维_CORP_ID>",
            "corpSecret": "<运维_CORP_SECRET>",
            "agentId": "<运维_AGENT_ID>",
            "token": "<运维回调_TOKEN>",
            "encodingAESKey": "<运维_43位_ENCODING_AES_KEY>"
          }
        },
        "sales": {
          "name": "销售助手",
          "dmPolicy": "allowlist",
          "allowFrom": ["<销售用户_ID>"],
          "botId": "<销售_BOT_ID>",
          "secret": "<销售_BOT_SECRET>"
        }
      }
    }
  }
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `defaultAccount` | CLI 与定时出站任务的默认账号。 |
| `accounts.<accountId>` | 单个企业微信账号配置。 |
| `accounts.<accountId>.name` | 供人工识别和日志展示的名称。 |
| 账号级 `botId`、`secret`、`agent`、`dmPolicy` | 覆盖顶层同名字段。 |

覆盖优先级是账号级字段优先，其次是顶层 `channels.wecom` 字段，最后才是运行时默认值。多账号回调地址应带账号 ID，例如 `/plugins/wecom/bot/ops` 与 `/plugins/wecom/agent/ops`；默认账号还可能注册 `/default` 别名。

### 验证步骤

```bash
openclaw gateway restart
openclaw channels list
openclaw message send --channel wecom --account ops --target user:<用户_ID> --message "运维账号测试"
openclaw message send --channel wecom --account sales --target user:<用户_ID> --message "销售账号测试"
```

日志中应能看到对应账号被选中。

## 9. 知识库 / RAG 集成

### 何时使用

希望企业微信对话在模型生成前检索知识库，或让助手使用 `knowledge_*` 工具时使用。

### 前置条件

- 企业微信 Bot 或 Agent 已可用。
- 已单独安装并配置知识库插件。可先阅读 [知识库 RAG 指南](../knowledge/OpenClaw-Knowledge-RAG-Guide_CN.md) 与 [知识库 RAG 集成](../knowledge/OpenClaw-Knowledge-RAG-Integration_CN.md)。
- 重要说明：`@partme.ai/wecom` 当前不内置 knowledge hooks。仅配置 `channels.wecom.knowledge.*` 不会启用 RAG，必须由知识库插件配置并由运行时接入。

### 完整 JSON

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
      "botId": "<你的_BOT_ID>",
      "secret": "<你的_BOT_SECRET>"
    }
  },
  "agents": {
    "defaults": {
      "model": "<你的模型名称>"
    }
  }
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `plugins.entries.knowledge.enabled` | 加载知识库插件。 |
| `plugins.entries.knowledge.config.embedding` | Embedding 服务与模型配置。 |
| `plugins.entries.knowledge.config.store` | 向量库或本地存储配置。 |
| `plugins.entries.knowledge.config.retrieval` | 检索策略、返回数量和分数阈值。 |
| `plugins.entries.knowledge.config.injection` | 控制检索内容注入位置与长度。 |
| `channels.wecom.*` | 仅负责企业微信通道配置，与知识库配置分离。 |

### 验证步骤

```bash
openclaw plugins install @partme.ai/openclaw-knowledge
openclaw gateway restart
openclaw run knowledge:stats
```

在企业微信中让助手记住一条测试事实，再用新消息询问该事实。回答应使用已配置的知识库插件。

## 10. 高级：dynamicAgents、出口代理、ASR、Bot Webhook 替代方案

### 何时使用

需要按用户或群隔离 Agent、为企业微信 API 固定出口 IP、处理 Agent 语音识别，或使用 HTTP Bot Webhook 替代 Bot WebSocket 时使用。

### 前置条件

- Bot 或 Agent 模式已可用。
- 出口代理需要准备企业网络允许的代理地址。
- ASR 需要腾讯云 ASR 凭据。
- Bot Webhook 需要 Gateway 能被企业微信访问。

### 完整 JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "webhook",
      "token": "<你的_BOT_WEBHOOK_TOKEN>",
      "encodingAESKey": "<你的_BOT_43位_ENCODING_AES_KEY>",
      "receiveId": "<你的_BOT_RECEIVE_ID>",
      "dynamicAgents": {
        "enabled": true,
        "dmCreateAgent": true,
        "groupEnabled": true,
        "adminUsers": ["<管理员用户_ID>"]
      },
      "network": {
        "egressProxyUrl": "http://<你的代理主机>:3128",
        "agentReplyTimeoutMs": 360000
      },
      "agent": {
        "corpId": "<你的_CORP_ID>",
        "corpSecret": "<你的_CORP_SECRET>",
        "agentId": "<你的_AGENT_ID>",
        "token": "<你的_AGENT回调_TOKEN>",
        "encodingAESKey": "<你的_AGENT_43位_ENCODING_AES_KEY>",
        "asr": {
          "appId": "<你的腾讯云ASR_APP_ID>",
          "secretId": "<你的腾讯云_SECRET_ID>",
          "secretKey": "<你的腾讯云_SECRET_KEY>",
          "engineType": "16k_zh",
          "voiceFormat": "amr"
        }
      }
    }
  }
}
```

Bot Webhook 回调地址：

```text
https://<你的_GATEWAY_HOST>/plugins/wecom/bot/default
```

这个示例把 4 类高级能力放在同一个可复制配置中，你可以按需单独使用：

- `dynamicAgents`：按私聊用户或群隔离 Agent / 会话。
- `network.egressProxyUrl`：固定出口 IP，处理企业微信 `60020` 错误。
- `agent.asr.*`：Agent 语音转文字。
- Bot Webhook：`connectionMode: "webhook"` 替代方案，不需要 `botId` / `secret`。

### 字段说明

| 字段 | 说明 |
|------|------|
| `connectionMode` | 设置为 `webhook` 时使用 Bot HTTP 回调，而不是 WebSocket。 |
| `token` | Bot Webhook 验证 Token。 |
| `encodingAESKey` | Bot Webhook AES 密钥。 |
| `receiveId` | 用于回调解密校验的 Bot 或接收方 ID。 |
| `dynamicAgents.enabled` | 启用动态 Agent 路由。 |
| `dynamicAgents.dmCreateAgent` | 为每个私聊用户创建隔离 Agent。 |
| `dynamicAgents.groupEnabled` | 为每个群启用隔离 Agent。 |
| `dynamicAgents.adminUsers` | 始终使用主 Agent 的管理员用户。 |
| `network.egressProxyUrl` | 固定出口 IP 使用的 HTTP 代理，可解决企业微信 `60020` 错误。 |
| `network.timeoutMs` | 规划 / 未接线的通用 HTTP 超时字段，目前不要依赖。 |
| `agent.asr.*` | Agent 语音转文字所需的腾讯云 ASR 配置。 |

`network.retries` 与 `network.retryDelayMs` 也是规划 / 未接线字段。目前运行时已接线的网络字段是 `network.agentReplyTimeoutMs` 与 `network.egressProxyUrl`。

### 验证步骤

1. 重启 Gateway。
2. 在企业微信后台保存 Bot Webhook 地址并发送私聊；没有 WebSocket 连接时也应能回复。
3. 两个用户分别私聊，确认日志中出现不同动态 Agent 或会话 ID。
4. 如曾出现 `60020 not allow to access from your ip`，确认配置代理后 Agent API 调用恢复。
5. 向自建应用发送语音，确认日志中先出现 ASR 文本，再进入模型处理。

## 11. Cron 定时推送

### 何时使用

需要 OpenClaw 定时向企业微信用户、部门、标签或群发送消息时使用。Cron 属于主动出站投递，必须配置 Agent 模式。

### 前置条件

- 场景 6 或场景 7 已可用。
- Agent 应用有权限向目标用户、部门、标签或群发送消息。
- Gateway 与调度器运行在预期时区。

### 完整 JSON

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "default",
      "agent": {
        "corpId": "<你的_CORP_ID>",
        "corpSecret": "<你的_CORP_SECRET>",
        "agentId": "<你的_AGENT_ID>",
        "token": "<你的回调_TOKEN>",
        "encodingAESKey": "<你的_43位_ENCODING_AES_KEY>"
      }
    }
  }
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `defaultAccount` | Cron 任务未指定 `--account` 时使用的账号。 |
| `agent.*` | 主动出站定时投递必需的自建应用配置。 |
| `--channel wecom` | 指定定时投递通道为企业微信。 |
| `--to user:<id>` | 发送给指定用户。 |
| `--to party:<id>` | 发送给部门。 |
| `--to tag:<id>` | 发送给标签。 |
| `--to group:<id>` 或 `--to chat:<id>` | 发送给群聊。 |

### 验证步骤

```bash
openclaw gateway restart
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

确认任务已注册，然后等待调度触发，或通过你的 OpenClaw Cron 工作流手动触发。消息应由配置的 Agent 账号发送。

常用验证命令：

```bash
openclaw channels status --probe
openclaw message send --channel wecom --account default --target user:<用户_ID> --message "Cron 目标烟测"
```

## 说明与排障

### Bot 与 Agent 选择

Bot WebSocket 适合交互式流式对话。Agent 模式用于主动推送、Cron 定时投递和完整出站文件支持。

### 出口错误 60020

如果企业微信返回 `60020 not allow to access from your ip`，请配置 `network.egressProxyUrl`，或把 Gateway 部署在企业微信后台允许的固定 IP 上。

### 配置源码

配置类型位于 `extensions/wecom/src/config/wecom-config.ts` 与 `extensions/wecom/src/types/config.ts`。

### Probe 语义

`openclaw channels status --probe` 会检查账号是否已配置，并报告 Bot WS 连接状态。它不能替代企业微信后台回调验证，也不能替代端到端消息测试。
