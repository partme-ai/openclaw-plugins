# 企业微信渐进式配置示例

按能力层级递进的 `openclaw.json` 片段，可直接复制到 `~/.openclaw/openclaw.json`（或你的 Gateway 配置路径）。每级在上一级基础上**累加**字段。

> 配置结构为 **平铺** `channels.wecom.*`（非 `wecom-kf` 的 `bot:{}` 嵌套）。多账号时使用 `accounts`，账号级字段覆盖顶层同名字段。

**相关文档**：[配置指南](./OpenClaw-WeCom-Configuration.md) · [联调测试](./OpenClaw-WeCom-Testing.md) · [README](../../extensions/wecom/README.zh-CN.md)

---

## Level 1 — 最小 Bot WebSocket（私聊对话）

**解锁**：WebSocket 长连接收发明文私聊，无需公网 IP。

**前置**（企微管理后台）：

1. 安全与管理 → 管理工具 → **智能机器人** → 创建（**API 模式**）
2. 记录 **Bot ID**、**Secret**

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

**验证**：

```bash
openclaw gateway restart
openclaw channels status --probe
```

在企微客户端向 Bot 发送 `你好`，应收到 AI 回复。日志中可见 WebSocket 认证成功。

---

## Level 2 — 欢迎语与用户可见文案

**解锁**：进入会话欢迎语、思考/工具/超时等状态文案可定制。

**前置**：完成 Level 1。

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "welcomeText": "你好，我是企业 AI 助手，有什么可以帮你？",
      "thinkingText": "正在思考…",
      "toolStatusText": "正在调用 {toolName}…",
      "emptyReplyText": "抱歉，我暂时无法回答这个问题。",
      "timeoutText": "处理超时，请稍后再试。"
    }
  }
}
```

**验证**：

1. 重新打开 Bot 私聊窗口 → 应看到 `welcomeText` 欢迎语
2. 发送需推理的问题 → 流式气泡状态栏应显示自定义 `thinkingText`

完整 `*Text` 键见 `extensions/wecom/src/config/text-config.ts`。

---

## Level 3 — 流式输出、脚注与思考占位

**解锁**：打字机式增量回复、状态栏/耗时脚注、可关闭「思考中」占位。

**前置**：完成 Level 2。

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "welcomeText": "你好，我是企业 AI 助手。",
      "thinkingText": "正在思考…",
      "sendThinkingMessage": true,
      "streaming": {
        "enabled": true,
        "status": true,
        "content": true
      },
      "footer": {
        "status": true,
        "elapsed": true
      },
      "finishFooterText": "⏱ {elapsed}s · 已完成"
    }
  }
}
```

| 字段 | 说明 |
|------|------|
| `streaming: false` | 默认模式：状态栏 + 最终整包（非打字机） |
| `streaming: true` 或嵌套对象 | 中间状态 + 答案增量流式 |
| `sendThinkingMessage` | 是否发送思考占位（默认 `true`） |
| `streamPlaceholderText` | 协议层首帧占位，一般无需修改 |

**验证**：

```bash
openclaw config set channels.wecom.streaming true
openclaw gateway restart
```

发送长问题，观察回复是否逐字/逐段更新；关流后脚注含耗时。详见 [流式架构](./OpenClaw-WeCom-Streaming-Architecture.md)。

---

## Level 4 — 访问控制（私聊 / 群聊）

**解锁**：私聊配对/白名单、群聊白名单、群内发送者限制。

**前置**：完成 Level 3（或至少 Level 1）。

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "dmPolicy": "pairing",
      "allowFrom": ["zhangsan", "lisi"],
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["wr1234567890abcdef"],
      "groups": {
        "wr1234567890abcdef": {
          "allowFrom": ["zhangsan", "admin_userid"]
        }
      },
      "streaming": true,
      "welcomeText": "你好，已通过访问校验。"
    }
  }
}
```

| 策略 | 值 | 行为 |
|------|-----|------|
| 私聊 | `open` / `pairing` / `allowlist` / `disabled` | 默认 `open` |
| 群聊 | `open` / `allowlist` / `disabled` | 默认 `open` |

**验证**：

```bash
openclaw pairing list wecom
openclaw pairing approve wecom <CODE>
```

未授权用户私聊应收到配对码；授权用户正常对话。群内仅 `groups.<chatId>.allowFrom` 内成员消息被处理。

---

## Level 5 — 媒体收发与本地路径白名单

**解锁**：入站图片/语音/文件/视频解密；出站本地文件发送；可调大小上限。

**前置**：完成 Level 4（或 Level 1 + 媒体需求）。

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "mediaLocalRoots": [
        "~/Downloads",
        "~/Documents/reports"
      ],
      "media": {
        "maxBytes": 20971520
      },
      "mediaErrorNoAccessText": "无法访问该文件路径，请联系管理员配置 mediaLocalRoots。",
      "streaming": true
    }
  }
}
```

| 类型 | 限制 | 超出行为 |
|------|------|----------|
| 图片 | 10 MB | 降级为文件发送 |
| 视频 | 10 MB | 降级为文件发送 |
| 语音 | 2 MB（AMR） | 非 AMR 或超限 → 文件 |
| 文件 | 20 MB（可用 `media.maxBytes` 调整） | 拒绝 |

> **未实现（仅类型定义）**：`media.tempDir`、`media.retentionHours`、`media.cleanupOnStart` — 请勿依赖，见 `extensions/wecom/src/types/config.ts`。

**验证**：

1. 向 Bot 发送一张图片 → 应正常识别并回复
2. 让 Agent 回复含本地路径的文件（路径须在 `mediaLocalRoots` 下）→ 应成功发送

---

## Level 6 — Agent 模式（自建应用）

**解锁**：HTTP 回调收消息、**主动推送**、Cron 定时任务、大文件/全格式出站。

**前置**（企微管理后台）：

1. 应用管理 → **自建应用** → 创建
2. 记录 **CorpID**、**CorpSecret**、**AgentId**
3. 应用 → **API 接收消息** → 记录 **Token**、**EncodingAESKey**（43 位）
4. **先** 配置 Gateway 并重启，**再** 在后台保存回调 URL

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": 1000002,
        "token": "<YOUR_CALLBACK_TOKEN>",
        "encodingAESKey": "<YOUR_43_CHAR_AES_KEY>",
        "welcomeText": "欢迎使用企业应用助手。"
      },
      "network": {
        "agentReplyTimeoutMs": 360000
      }
    }
  }
}
```

回调 URL：`https://<gateway-host>/plugins/wecom/agent/default`

**验证**：

```bash
openclaw gateway restart
openclaw channels status --probe
```

在企微中打开自建应用发私聊；或：

```bash
openclaw message send --channel wecom --account default --target user:zhangsan --message "Agent 出站测试"
```

---

## Level 7 — 双模 Bot WebSocket + Agent（生产推荐）

**解锁**：Bot 负责流式对话；Agent 负责文件兜底、Cron、主动广播；Bot 不可用时自动回退 Agent HTTP。

**前置**：Level 1 Bot 凭据 + Level 6 Agent 凭据均已就绪。

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "streaming": true,
      "footer": { "status": true, "elapsed": true },
      "mediaLocalRoots": ["~/Downloads"],
      "media": { "maxBytes": 20971520 },
      "dmPolicy": "open",
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": 1000002,
        "token": "<YOUR_CALLBACK_TOKEN>",
        "encodingAESKey": "<YOUR_43_CHAR_AES_KEY>"
      },
      "network": {
        "agentReplyTimeoutMs": 360000,
        "egressProxyUrl": "http://proxy.company.local:3128"
      }
    }
  }
}
```

**验证**：

1. Bot 私聊流式回复正常
2. 在群内请求发送大文件 → 应私信文件并在群内提示
3. Cron 测试（需 Agent）：

```bash
openclaw cron add \
  --name "wecom-daily" \
  --agent main \
  --cron "0 9 * * 1-5" \
  --tz "Asia/Shanghai" \
  --message "今日简报" \
  --announce --channel wecom --to "party:1"
```

---

## Level 8 — 多账号

**解锁**：运维 Bot、销售 Bot 等独立凭据与策略；`defaultAccount` 指定默认出站账号。

**前置**：每个账号在企微后台分别创建智能机器人 / 自建应用。

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "ops",
      "dmPolicy": "open",
      "streaming": true,
      "accounts": {
        "ops": {
          "name": "运维助手",
          "botId": "<OPS_BOT_ID>",
          "secret": "<OPS_BOT_SECRET>",
          "agent": {
            "corpId": "ww1234567890abcdef",
            "corpSecret": "<OPS_CORP_SECRET>",
            "agentId": 1000002,
            "token": "<OPS_TOKEN>",
            "encodingAESKey": "<OPS_AES_KEY>"
          }
        },
        "sales": {
          "name": "销售助手",
          "dmPolicy": "allowlist",
          "allowFrom": ["zhangsan"],
          "botId": "<SALES_BOT_ID>",
          "secret": "<SALES_BOT_SECRET>"
        }
      }
    }
  }
}
```

**验证**：

```bash
openclaw channels list
openclaw message send --channel wecom --account sales --target zhangsan --message "销售 Bot 测试"
openclaw message send --channel wecom --account ops --target zhangsan --message "运维 Bot 测试"
```

日志账号前缀应为 `[sales]`、`[ops]`。

---

## Level 9 — 知识库 / RAG 集成

**解锁**：对话前自动检索知识库注入上下文；AI 可通过 `knowledge_*` 工具读写知识。

**前置**：

1. 完成 Level 7 或 8（WeCom 通道可用）
2. 安装独立知识库插件（`@partme.ai/wecom` **当前未内置** knowledge hooks，需单独安装）

```bash
openclaw plugins install @partme.ai/openclaw-knowledge
```

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
      "defaultAccount": "ops",
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": 1000002,
        "token": "<YOUR_TOKEN>",
        "encodingAESKey": "<YOUR_AES_KEY>"
      }
    }
  },
  "agents": {
    "defaults": {
      "model": "gpt-4o-mini"
    }
  }
}
```

**说明**：

|  topic | 说明 |
|--------|------|
| 独立插件配置 | 当前推荐 `plugins.entries.knowledge.config`（见 [knowledge INSTALL](../../extensions/knowledge/INSTALL.md)） |
| `channels.wecom.knowledge` | 渠道插件**内嵌** `registerKnowledgeHooks(api, 'channels.wecom.knowledge')` 时使用；`@partme.ai/wecom` 源码未内嵌，该路径仅在与 knowledge 库模式集成时生效 |
| 命名空间 | 运行时按 `{accountId}:{bot\|agent}` 隔离（如 `ops:bot`） |

**验证**：

```bash
openclaw gateway restart
openclaw run knowledge:stats
```

在企微对话：「请记住：公司报销流程见 wiki/报销.md」→ 再问「报销流程是什么？」应引用知识库内容。

**延伸阅读**：[Knowledge RAG 指南](../knowledge/OpenClaw-Knowledge-RAG-Guide_CN.md) · [集成文档](../knowledge/OpenClaw-Knowledge-RAG-Integration_CN.md)

---

## Level 10 — 高级：动态 Agent、代理、ASR、Webhook 替代

**解锁**：按用户/群隔离 Agent 实例；固定出口 IP；Agent 语音 ASR；无 WS 时用 HTTP Webhook Bot。

**前置**：熟悉 Level 7–9。

### 10a — 动态 Agent + 出口代理

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "dynamicAgents": {
        "enabled": true,
        "dmCreateAgent": true,
        "groupEnabled": true,
        "adminUsers": ["admin_userid"]
      },
      "network": {
        "egressProxyUrl": "http://proxy.company.local:3128",
        "agentReplyTimeoutMs": 360000,
        "timeoutMs": 15000
      },
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": 1000002,
        "token": "<YOUR_TOKEN>",
        "encodingAESKey": "<YOUR_AES_KEY>"
      }
    }
  }
}
```

动态 Agent ID 格式：`wecom-dm-<userid>`、`wecom-group-<chatid>`。`adminUsers` 始终走主 Agent。

> **未实现**：`network.retries`、`network.retryDelayMs`（类型已定义，运行时未读取）。`network.timeoutMs` 部分 HTTP 路径使用，非全局重试策略。

**验证**：两名用户分别私聊，日志中 `agentId` / session 应不同；若曾遇 `60020` IP 错误，配置代理后 Agent API 应恢复。

### 10b — Agent 语音 ASR（腾讯云 Flash）

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": 1000002,
        "token": "<YOUR_TOKEN>",
        "encodingAESKey": "<YOUR_AES_KEY>",
        "asr": {
          "appId": "<TENCENT_APP_ID>",
          "secretId": "<TENCENT_SECRET_ID>",
          "secretKey": "<TENCENT_SECRET_KEY>",
          "engineType": "16k_zh",
          "voiceFormat": "amr"
        }
      }
    }
  }
}
```

**验证**：通过自建应用私聊发送语音消息 → 日志应显示 ASR 文本并进入 Agent 推理。

### 10c — Bot Webhook 模式（替代 WebSocket）

适用：无法维持 WS 长连接、已有公网 URL 的场景。

**前置**：智能机器人回调 URL 指向 Gateway。

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "webhook",
      "token": "<WEBHOOK_TOKEN>",
      "encodingAESKey": "<YOUR_43_CHAR_AES_KEY>",
      "receiveId": "<BOT_OR_CORP_ID>",
      "welcomeText": "欢迎通过 Webhook 接入。",
      "streamPlaceholderText": "1",
      "streaming": true
    }
  }
}
```

回调 URL：`https://<gateway-host>/plugins/wecom/bot/default`

**验证**：企微后台保存 URL 后发送私聊；Gateway 日志出现 webhook 入站且无 WS 连接亦可回复。

---

## 未实现配置项速查

| 配置键 | 状态 |
|--------|------|
| `media.tempDir` | 已定义，未接线 |
| `media.retentionHours` | 已定义，未接线 |
| `media.cleanupOnStart` | 已定义，未接线 |
| `network.retries` | 已定义，未接线 |
| `network.retryDelayMs` | 已定义，未接线 |
| `channels.wecom.knowledge.*`（仅配置、无 knowledge 插件） | 不生效 |

---

## 配置来源（源码）

| 模块 | 路径 |
|------|------|
| 主配置类型 | `extensions/wecom/src/config/wecom-config.ts` |
| 文案 *Text | `extensions/wecom/src/config/text-config.ts` |
| 流式 / footer | `extensions/wecom/src/config/streaming-config.ts` |
| 多账号 | `extensions/wecom/src/config/accounts.ts` |
| 动态 Agent | `extensions/wecom/src/config/dynamic-routing.ts` |
