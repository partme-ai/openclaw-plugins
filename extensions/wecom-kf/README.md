<div align="center">

# WeCom KF

**WeChat Work Customer Service — 企微客服 · 智能转人工 · 事件消息**

> **范围声明**：本插件专注 **微信客服（KF）**，实现 KF 消息收发、转人工与 ICS 能力；**不含**企业微信客户联系 Bot/Agent（`wecom-cs`）主路径。Legacy Bot/Agent 可通过 `channels.wecom-kf.legacyWecomCsEnabled=true` 临时启用，Phase 2 将移除。

![Version](https://img.shields.io/badge/Version-0.1.0-blue) ![License](https://img.shields.io/badge/License-MIT-green)

</div>

[中文](README.zh-CN.md) | English

---

## OpenClaw 文档

- [Chat Channels](https://docs.openclaw.ai/channels) · [Plugins](https://docs.openclaw.ai/tools/plugin) · [Plugin Manifest](https://docs.openclaw.ai/plugins/manifest)
- [Skills](https://docs.openclaw.ai/tools/skills) · [Webhooks](https://docs.openclaw.ai/automation/webhook)
- 本仓库文档索引：[OPENCLAW_DOCS_INDEX.md](../../OPENCLAW_DOCS_INDEX.md)（在 monorepo 根目录）

**包名与插件 ID**：包名为 `@partme.ai/wecom_kf`，插件 ID 为 `wecom_kf`（原 `openclaw_wecom_kf` 已弃用）。若配置中曾使用 `plugins.entries.openclaw_wecom_kf`，请改为 `plugins.entries.wecom_kf`；渠道配置 `channels.wecom-kf` 不变。

---

## Overview

This plugin integrates OpenClaw with WeChat Work's customer service (微信客服) API, allowing AI agents to handle customer inquiries automatically while supporting seamless handoff to human agents when needed.

**Scope**: This plugin implements **only the 8 official KF docs** listed below (message receive/send, event messages, callback, servicer list, account list, contact-way link, session assignment). It does **not** include management features (e.g. add/delete/edit accounts or servicers, knowledge base, or customer-detail APIs).

### Key Features

- **Automatic Account Discovery**: Discovers and registers all customer service accounts on startup (94661)
- **Multi-Account Support**: Each `open_kfid` can be mapped to a different OpenClaw Agent
- **Intelligent Human Transfer**: Built-in skill for context-aware transfer to human agents (94669, 94645)
- **Configurable Event Messages**: Welcome, ending, and satisfaction survey (95122)
- **Process-while-chat**: Callback returns 200 immediately; message batch is processed with limited concurrency (97712, 94670)
- **WeChat Work API**: Only the 8 docs below (94670, 94677, 95122, 97712, 94645, 94661, 94665, 94669)

## Architecture

```
WeChat Work Platform                    OpenClaw Gateway
    │                                        │
    │  ┌─────────────────────────────────────┤
    │  │    wecom-kf Plugin                  │
    │  │  ┌─────────────────────────────┐    │
    ▼  │  │                             │    │
Callback ─┼──► callback.ts              │    │
(POST)    │  │     │                    │    │
          │  │     ▼                    │    │
          │  │ message-handler.ts ──────┼────┼──► OpenClaw Agent
          │  │     │                    │    │      (AI Reply)
          │  │     ▼                    │    │
          │  │ system-event-handler.ts  │    │
          │  │ (welcome/ending/survey)  │    │
          │  │     │                    │    │
          │  └─────┼────────────────────┘    │
          │        │                         │
          │        ▼                         │
          │   wecom-api.ts ──────────────────┼──► WeChat Work API
          │   (sync_msg, send_msg, etc.)     │
          └──────────────────────────────────┤
```

## Directory Structure

```
wecom-kf/
  index.ts                   # Plugin entry: KF core registration
  openclaw.plugin.json       # channels: ["wecom-kf"]; contracts = Control Tools only
  src/
    callback.ts              # KF HTTP callback (core)
    channel.ts               # wecom-kf channel + outbound
    kf/
      control-tools.ts       # wecom_kf_* Control Tools (core; API not in LLM context)
      call-context.ts        # Tool / dispatch CallContext 解析
    intelligence/            # 对话状态机、intent、prompt 注入（P3）
    ics/
      handlers/              # Optional ops REST API (icsEnabled=true)
      utils/                 # ICS file/config helpers
  agents/                    # Optional agent workspace templates (not imported by core)
  skills/                    # Optional skills (manual install; not in plugin manifest)
```

### Module layers (Phase 2C)

| Layer | Paths | Registration |
|-------|--------|----------------|
| **KF core** | `callback.ts`, `channel.ts`, `kf/control-tools.ts`, `kf/call-context.ts`, `dispatch.ts` | Always on |
| **Intelligence (L2)** | `src/intelligence/` — dialogue state, intent, `before_prompt_build` | Always on |
| **ICS ops (optional)** | `src/ics/handlers/`, `src/ics/utils/` | `channels.wecom-kf.icsEnabled: true` → `/ics/*` routes |
| **Agent templates (optional)** | `agents/` | Deploy separately; point `--workspace` at subdirs |
| **Skills (optional)** | `skills/` | Copy/symlink into agent workspace; not auto-loaded by plugin |

**Control Tools** (registered): `wecom_kf_list_servicers`, `wecom_kf_list_accounts`, `wecom_kf_get_account_link`, `wecom_kf_transfer_session` — API payloads go to audit log, not LLM transcript.

**Deprecated** (removed in Phase 3B): legacy `src/kf/tools.ts` and unused `src/kf/knowledge.ts` RAG stub.

Legacy directory layout (pre-Phase 2C):

```
wecom_kf/
  package.json
  tsconfig.json
  tsup.config.ts
  openclaw.plugin.json       # channels: ["wecom-kf"]
  src/
    index.ts                 # Entry: register channel + callback route
    types.ts                 # KfMessage, KfAccount, EventMessagesConfig
    channel.ts               # wecomKfChannel definition (outbound.sendText)
    callback.ts              # HTTP callback handler (/wecom/kefu)
    message-handler.ts       # Customer message → Agent reply pipeline
    system-event-handler.ts  # Welcome/ending messages, satisfaction survey
    wecom-api.ts             # WeChat Work API (8 docs only)
    account-manager.ts       # Account auto-discovery and caching
    crypto.ts                # WeChat callback encryption (AES-256-CBC)
    config.ts                # Event messages configuration reader
    cursor-store.ts          # next_cursor persistence
  skills/
    transfer-to-human/       # 转人工 skill（SKILL.md + references/kf-api.md）
  hooks/
    session-memory/          # Persist customer context on session reset
  templates/
    presale-agent/           # AGENTS.md, SOUL.md, IDENTITY.md, USER.md, TOOLS.md, HEARTBEAT.md
    support-agent/
    aftersale-agent/
```

## Callback URL（客服回调入口）

企微后台「接收消息服务器配置」中，回调 URL 填写：

**`https://你的域名/wecom/kefu`**（生产环境建议 HTTPS）

与 wecom 插件的 `/wecom`、`/wecom/bot`、`/wecom/agent` 同属 `/wecom` 前缀，便于统一入口。服务器需在 **5 秒内** 返回 HTTP 200，否则企微会重试。

## 开启客服委托（三步） / Enable KF delegation (3 steps)

要让本插件收到企微客服的消息与事件，必须在企业微信后台完成「客服委托」相关配置；否则回调不会推送。

### Step 1: Add app to「微信客服 - 可调用接口的应用」

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/)。
2. 进入 **客户联系 → 微信客服 → API 与回调**（或 **应用管理 → 自建应用 → 你的应用**）。
3. 在「**微信客服 - 可调用接口的应用**」中，将用于本插件的 **自建应用** 添加进去。

### Step 2: Configure callback URL and secrets

1. 在 **应用管理 → 自建应用 → 你的应用** 中，进入「**接收消息**」或「**接收消息服务器配置**」。
2. 填写：
   - **URL**：`https://你的公网域名/wecom/kefu`（与 OpenClaw Gateway 暴露的地址一致）。
   - **Token**：与 `openclaw.json` 中 `channels.wecom-kf.token` 一致。
   - **EncodingAESKey**：与 `channels.wecom-kf.encodingAESKey` 一致。
3. 保存后企微会发 GET 请求校验 URL，本插件会解密 `echostr` 并原样返回，通过即生效。

### Step 3: Authorize at least one KF account to the app

- 在「**微信客服 - 可调用接口的应用**」或客服账号管理中，为上述自建应用 **授权至少一个客服账号**。
- 官方说明：对自建应用，配置到「微信客服- 可调用接口的应用」且授权了至少一个客服账号后，**自动获得**「微信客服→管理账号、分配会话和收发消息」权限，并开始接收 **微信客服消息和事件**。

完成以上三步后，企微会向你的回调 URL 推送 `kf_msg_or_event` 等事件，本插件即可正常收发消息。若未配置或未授权，回调不会触发。

**参考**：[微信客服 - 回调通知](https://developer.work.weixin.qq.com/document/path/97712)、[接收消息和事件](https://developer.work.weixin.qq.com/document/path/94670)。

## Relationship with wecom plugin（与 wecom 插件的关系 / 自建应用如何配置）

**wecom-kf and [@partme.ai/wecom](https://www.npmjs.com/package/@partme.ai/wecom) are not the same system**: wecom-kf is for WeCom **微信客服** (customers from 公众号/miniprogram/video channels); wecom is for **客户联系** (Bot + Agent push). Different channels (`wecom-kf` vs `wecom`), so both can be installed; if you need both scenarios, use **two** 自建应用 with different callback URLs.

| 维度 | wecom (客户联系) | wecom-kf (微信客服) |
|------|------------------|---------------------|
| 典型用途 | Internal/customer chat with Bot, app push | External users via 微信客服, AI + human handoff |
| Callback path | `/plugins/wecom/bot/{accountId}`, `/plugins/wecom/agent/{accountId}` | `/wecom/kefu` |
| 后台配置 | 自建应用「接收消息」with above URL | Add app to「微信客服-可调用接口的应用」+ 接收消息 URL = `/wecom/kefu` |

One 自建应用 can have only **one** 接收消息 URL, so you cannot use a single app for both. Recommendation:

| 需求 | 安装 | 自建应用与 URL |
|------|------|----------------|
| 只要微信客服 | wecom-kf | 1 app → 微信客服-可调用接口的应用 → URL = `https://你的域名/wecom/kefu` |
| 只要客户联系 | wecom | 1 app → URL = `https://你的域名/plugins/wecom/agent/{accountId}` |
| 两个都要 | wecom + wecom-kf | 2 apps: one URL = `/wecom/kefu`, one URL = `/plugins/wecom/agent/xxx` |

## Official WeCom KF docs（微信客服官方文档索引）

| 分类 | 文档 |
|------|------|
| 概述 | [微信客服概述](https://developer.work.weixin.qq.com/document/path/94638) |
| 客服账号管理 | [添加](https://developer.work.weixin.qq.com/document/path/94662) / [删除](https://developer.work.weixin.qq.com/document/path/94663) / [修改](https://developer.work.weixin.qq.com/document/path/94664) / [列表](https://developer.work.weixin.qq.com/document/path/94661) / [获取客服链接](https://developer.work.weixin.qq.com/document/path/94665) |
| 接待人员管理 | [添加](https://developer.work.weixin.qq.com/document/path/94646) / [删除](https://developer.work.weixin.qq.com/document/path/94647) / [列表](https://developer.work.weixin.qq.com/document/path/94645) |
| 会话与消息 | [分配客服会话](https://developer.work.weixin.qq.com/document/path/94669)（含流程图与状态表，可作系统设计参考） / [接收消息和事件](https://developer.work.weixin.qq.com/document/path/94670) / [发送消息](https://developer.work.weixin.qq.com/document/path/94677) / [发送欢迎语等事件消息](https://developer.work.weixin.qq.com/document/path/95122) |
| 客户与统计 | [获取客户基础详情](https://developer.work.weixin.qq.com/document/path/95159) / [客户数据统计-企业汇总](https://developer.work.weixin.qq.com/document/path/95489) / [客户数据统计-接待人员明细](https://developer.work.weixin.qq.com/document/path/95490) |
| 机器人 | [知识库分组](https://developer.work.weixin.qq.com/document/path/95971) / [知识库问答](https://developer.work.weixin.qq.com/document/path/95972) |
| 回调 | [回调通知](https://developer.work.weixin.qq.com/document/path/97712) |

## WeChat Work API Coverage

| API | Endpoint | Usage |
|---|---|---|
| **Callback** | `/wecom/kefu` | Receive message/event notifications |
| **Sync Messages** | `kf/sync_msg` | Pull messages (within 3 days) |
| **Send Message** | `kf/send_msg` | AI reply to customer |
| **Event Message** | `kf/send_msg_on_event` | Welcome/ending messages with welcome_code |
| **Service State** | `kf/service_state/get` | Check current session state |
| **Transfer** | `kf/service_state/trans` | Transfer to human agent |
| **Account List** | `kf/account/list` | Discover all KF accounts (94661) |
| **Servicer List** | `kf/servicer/list` | Get available human agents (94645) |
| **Contact Way** | `kf/add_contact_way` | Get KF account link (94665) |

## Session Configuration (Recommended)

For correct session isolation per customer and per KF account, configure OpenClaw as follows (channel meta exposes `recommendedConfig`):

- **`session.dmScope`**: Use `per-account-channel-peer` so each customer × KF-account has a dedicated session.
- **`session.resetByChannel`**: For `wecom-kf`, use idle reset (e.g. `idleMinutes: 2880`) so sessions end after 48h of inactivity, matching WeChat reply window.

The plugin logs a startup warning if `dmScope` is not set to a per-peer mode.

## Hooks

| Hook | Trigger | Purpose |
|---|---|---|
| `session-memory` | `command:new` (on wecom-kf channel) | On session reset, persists customer context (nickname, KF account, last messages) to Agent workspace `memory/YYYY-MM-DD.md` for long-term memory |

## Auto-reply Command

| Command | Description |
|---|---|
| `/kf-status` | In chat, returns WeChat KF account connection status and online servicer count per account |

## Agent Workspace Templates

The plugin provides three ready-to-use agent templates under `templates/`:

| Template | Path | Use Case |
|---|---|---|
| Presale | `templates/presale-agent/` | Sales and pre-sales (AGENTS.md, SOUL.md, IDENTITY.md, USER.md, TOOLS.md, HEARTBEAT.md) |
| Support | `templates/support-agent/` | Technical support (includes exec tool, knowledge paths) |
| Aftersale | `templates/aftersale-agent/` | After-sales (policies, warranty, returns) |

Copy the desired template into your Agent workspace and adjust model refs and paths as needed.

## Message Flow

1. **Callback Reception**: WeChat Work sends POST to `/wecom/kefu`
2. **Decryption**: Plugin decrypts callback using AES-256-CBC
3. **Event Routing**:
   - `msg` events → `message-handler.ts` → OpenClaw Agent
   - `enter_session` → Send welcome message
   - `session_status_change` (end) → Send ending message + satisfaction survey
4. **AI Response**: Agent processes message, generates reply
5. **Reply Delivery**: Plugin calls `kf/send_msg` to deliver response

## Configuration

### Channel Configuration in `openclaw.json`

```json
{
  "channels": {
    "wecom-kf": {
      "corpId": "your_corp_id",
      "corpSecret": "your_corp_secret",
      "token": "callback_token",
      "encodingAESKey": "aes_key",
      "eventMessages": {
        "welcome": {
          "enabled": true,
          "msgtype": "text",
          "content": { "content": "您好！我是智能客服，有什么可以帮您？" }
        },
        "ending": {
          "enabled": true,
          "msgtype": "text",
          "content": { "content": "感谢您的咨询，再见！" }
        },
        "satisfaction": {
          "enabled": true,
          "head_content": "请对本次服务进行评价",
          "options": [
            { "id": "1", "content": "满意" },
            { "id": "2", "content": "一般" },
            { "id": "3", "content": "不满意" }
          ]
        }
      },
      "accounts": {
        "kf_xxx": {
          "agentId": "presale-agent",
          "eventMessages": { /* account-level override */ }
        }
      }
    }
  }
}
```

### Agent Binding

```json
{
  "bindings": [
    {
      "channel": "wecom-kf",
      "peer": "kf_presale_001",
      "agent": "presale-agent"
    },
    {
      "channel": "wecom-kf",
      "peer": "kf_support_001",
      "agent": "support-agent"
    }
  ]
}
```

## Intelligent Human Transfer Skill

Optional skills live under `skills/` (e.g. `skills/transfer-to-human/SKILL.md`). They are **not** loaded by the plugin manifest; copy or symlink into your agent workspace when needed. Structure follows the wecom plugin skill spec (frontmatter, sections, references).

```markdown
# Transfer to Human Skill

When the customer explicitly requests human service, or when you cannot
adequately answer the question, use this skill to transfer the conversation.

## Steps:
1. Check available human agents via servicer/list
2. If agents available, call service_state/trans
3. If no agents, inform customer of wait time or callback option
```

## Development

```bash
pnpm install
pnpm build
pnpm dev   # watch mode
```

## API Constraints (Important)

| Constraint | Value | Description |
|---|---|---|
| Reply window | 48 hours | Must reply within 48h of last customer message |
| Message limit | 5 messages | Max 5 replies per customer message |
| sync_msg validity | 3 days | Messages older than 3 days cannot be pulled |
| Token validity | 10 minutes | Access token expires in 10 min |
| welcome_code validity | 20 seconds | Must send welcome within 20s |

## Production checklist

- **Callback URL**: Use **HTTPS** and a stable public domain; respond within **5 seconds** with 200.
- **Enterprise trusted IPs**: If your gateway restricts by IP, allow [企业微信回调 IP 段](https://developer.work.weixin.qq.com/document/path/92521) so callbacks from WeCom can reach `/wecom/kefu`.
- **Config**: Ensure `corpId`, `corpSecret`, `token`, `encodingAESKey` match the WeCom app and callback config; plugin startup will discover KF accounts only when config is valid.

## Session State Reference

| State | Description |
|---|---|
| 0 | Unhandled (new session, auto-transitions to 1) |
| 1 | Handled by AI agent (smart customer service) |
| 2 | In queue (waiting for human agent) |
| 3 | Handled by human agent |
| 4 | Session ended |

## Key Types

| Type | Description |
|---|---|
| `KfMessage` | WeChat Work message structure (origin, msgtype, event, open_kfid, external_userid) |
| `KfAccount` | Customer service account (open_kfid, name, avatar, manage_privilege) |
| `EventMessagesConfig` | Welcome/ending message and satisfaction survey configuration |
| `wecomKfChannel` | Channel definition object (capabilities, config, outbound) |

## Plugin Configuration (configSchema)

| Option | Type | Default | Description |
|---|---|---|---|
| `corpId` | string | — | WeChat Work Corp ID |
| `corpSecret` | string | — | App secret for KF API |
| `token` | string | — | Callback verification token |
| `encodingAESKey` | string | — | AES encryption key for callbacks |
| `session.dmScope` | string | `per-account-channel-peer` | Session isolation level |
| `session.resetByChannel` | object | `{mode:"idle", idleMinutes:2880}` | Channel-specific session reset |
| `eventMessages.welcome` | object | — | Default welcome message config |
| `eventMessages.ending` | object | — | Default ending message config |
| `eventMessages.satisfaction` | object | — | Satisfaction survey config |
| `humanTransfer.waitTimeout` | number | 300 | Seconds to wait before fallback when no human agent |

## Related OpenClaw plugins

| Plugin | Description |
|--------|--------------|
| [openclaw-oauth2](https://github.com/partme-ai/openclaw-oauth2) | OAuth2 authentication |
| [openclaw-cluster](https://github.com/partme-ai/openclaw-cluster) | Cluster coordination (discovery, config sync, session store, proxy) |
| [openclaw-mqtt](https://github.com/partme-ai/openclaw-mqtt) | MQTT protocol adapter |
| [openclaw-prometheus](https://github.com/partme-ai/openclaw-prometheus) | Prometheus metrics exporter |
| [openclaw-stomp](https://github.com/partme-ai/openclaw-stomp) | STOMP server |
| [openclaw-tracing](https://github.com/partme-ai/openclaw-tracing) | Distributed tracing |
| [openclaw-web-mqtt](https://github.com/partme-ai/openclaw-web-mqtt) | WebSocket MQTT |
| [openclaw-web-stomp](https://github.com/partme-ai/openclaw-web-stomp) | WebSocket STOMP |
| [wecom_kf](https://github.com/partme-ai/openclaw_wecom_kf) | WeChat Work customer service channel |

## License

MIT
