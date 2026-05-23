<div align="center">

# WeCom KF

**企业微信客服渠道 — 企微客服 · 智能转人工 · 事件消息**

![Version](https://img.shields.io/badge/Version-0.1.0-blue) ![License](https://img.shields.io/badge/License-MIT-green)

</div>

中文 | [English](README.md)

---

## 概述

本插件将 OpenClaw 与企业微信的微信客服 API 集成，使 AI Agent 能够自动处理客户咨询，同时在需要时无缝转接人工客服。

**范围**：本插件**仅实现下述 8 个官方文档**能力（接收/发送消息、事件消息、回调、接待人员列表、客服账号列表、客服链接、分配会话），**不含**管理功能（如客服账号/接待人员增删改、知识库、统计、客户详情等接口）。

### 核心功能

- **自动账号发现**：启动时自动发现并注册所有客服账号（94661）
- **多账号支持**：每个 `open_kfid` 可映射到不同的 OpenClaw Agent
- **智能转人工**：内置技能支持上下文感知的人工转接（94669、94645）
- **可配置事件消息**：欢迎语、结束语、满意度评价（95122）
- **边聊边处理**：回调先返回 200，同批消息有限并发处理（97712、94670）
- **企微 API**：仅上述 8 个文档（94670、94677、95122、97712、94645、94661、94665、94669）

## 架构

```
企业微信平台                          OpenClaw Gateway
    │                                        │
    │  ┌─────────────────────────────────────┤
    │  │    wecom-kf 插件                    │
    │  │  ┌─────────────────────────────┐    │
    ▼  │  │                             │    │
回调接口 ─┼──► webhook/callback.ts      │    │
(POST)    │  │     │ sync_msg          │    │
          │  │     ▼                    │    │
          │  │ dispatch.ts ────────────┼────┼──► OpenClaw Agent
          │  │     │                    │    │      (AI 回复)
          │  │     ▼                    │    │
          │  │ agent/system-event.ts    │    │
          │  │ (欢迎语 / 系统事件)       │    │
          │  │     │                    │    │
          │  │ kf/control-tools.ts      │    │
          │  │ (转人工 · 不进 transcript)│    │
          │  └─────┼────────────────────┘    │
          │        │                         │
          │        ▼                         │
          │   agent/api-client.ts ─────────┼──► 企微客服 API
          │   (sync_msg, send_msg 等)       │
          └──────────────────────────────────┤
```

## Directory Structure

```
wecom-kf/
  index.ts                   # 插件入口：KF 核心 + Control Tools + 可选 ICS
  openclaw.plugin.json       # channels: ["wecom-kf"]；contracts 仅 Control Tools
  src/
    webhook/callback.ts      # KF HTTP 回调（验签 → sync_msg → 分发）
    dispatch.ts              # 客户消息 → Agent → send_msg
    channel.ts               # wecom-kf 渠道 + 出站
    agent/
      api-client.ts          # 企微 KF API（sync / send / trans 等）
      system-event.ts        # origin=4 系统事件（欢迎语等）
    kf/
      control-tools.ts       # wecom_kf_* 控制面 Tools（核心）
      call-context.ts        # Tool / dispatch CallContext
    intelligence/            # 对话状态机、intent、before_prompt_build（Phase 3B）
    ics/
      handlers/              # 可选运营 REST API（icsEnabled=true）
      utils/                 # ICS 专用文件读写
  agents/                    # 可选智能体 workspace 模板（核心不 import）
  skills/                    # 可选技能（需手动安装；不在 plugin manifest）
```

### 模块分层

| 层级 | 路径 | 注册方式 | Phase |
|------|------|----------|:-----:|
| **KF 核心** | `webhook/callback.ts`、`dispatch.ts`、`channel.ts`、`kf/control-tools.ts`、`kf/call-context.ts` | 默认启用 | 1 ✅ |
| **媒体与策略** | `dm-policy.ts`、`media/`、`outbound/kf-send.ts` | 默认启用 | 2 实施中 |
| **会话状态与智能化** | `src/intelligence/`、`dispatch.ts` dialogue 闭环、`agent/system-event.ts` | 默认启用 | 3 **当前** |
| **ICS 运营（可选）** | `src/ics/handlers/`、`src/ics/utils/` | `channels.wecom-kf.icsEnabled: true` → 注册 `/ics/*` | 3 ✅（开关） |
| **智能体模板（可选）** | `agents/` | 独立部署；`--workspace` 指向子目录 | — |
| **Skills（可选）** | `skills/` | 复制/软链到 agent workspace；插件不自动加载 | — |
| **Legacy Bot/Agent** | `legacy/monitor.ts` 等 | `legacyWecomCsEnabled: true`（默认 **false**，Phase 2 移除中） | 废弃 |

### Phase 3 模块说明（会话状态与智能化）

| 模块 | 职责 | 状态 |
|------|------|:----:|
| **`wecom_kf_transfer_session`** | 94669 转人工/排队/结束；API 结果 audit 日志，不进 LLM | 部分完成 |
| **`KfSessionSideEffectStore`** | 持久化 trans 返回的 `msg_code`，供事件消息发送 | 实施中 |
| **`kf/transfer-policy.ts`** | 按在线 servicer 自动选席 | 实施中 |
| **`session_status_change`** | state=3 停止 Agent 自动回复 | 实施中 |
| **`send_msg_on_event`** | 欢迎语（✅）、排队/结束语/满意度（实施中） | 部分完成 |
| **`src/intelligence/*` + prompt 注入** | 多轮状态机；dispatch 写入 + `before_prompt_build` 读取 | ✅ |
| **`servicerCache`** | `config/accounts.ts` 缓存接待人员，与 Tools 对齐 | 部分完成 |
| **`icsEnabled`** | 默认 `false`；ICS REST 与 KF 核心解耦 | ✅ |

**Control Tools**（已注册）：`wecom_kf_list_servicers`、`wecom_kf_list_accounts`、`wecom_kf_get_account_link`、`wecom_kf_transfer_session`。

**已废弃**（Phase 3B 已删除）：旧版 `src/kf/tools.ts` 与未接入的 `src/kf/knowledge.ts` RAG stub。

**联调文档**：[Integration-Checklist.md](../../doc/wecom-kf/Integration-Checklist.md) · [Roadmap Phase 3](../../doc/wecom-kf/OpenClaw-WeCom-KF-Roadmap.md#phase-3--会话状态与智能化当前)

旧版目录说明：

```
wecom_kf/
  package.json
  tsconfig.json
  tsup.config.ts
  openclaw.plugin.json       # channels: ["wecom-kf"]
  src/
    index.ts                 # 入口：注册渠道 + 回调路由
    types.ts                 # KfMessage, KfAccount, EventMessagesConfig
    channel.ts               # wecomKfChannel 渠道定义 (outbound.sendText)
    callback.ts              # HTTP 回调处理 (/wecom/kefu)
    message-handler.ts       # 客户消息 → Agent 回复管线
    system-event-handler.ts  # 欢迎语/结束语/满意度
    wecom-api.ts             # 企微 API（仅 8 个文档）
    account-manager.ts       # 账号自动发现与缓存
    crypto.ts                # 企微回调加解密 (AES-256-CBC)
    config.ts                # 事件消息配置读取
    cursor-store.ts          # next_cursor 持久化
  skills/
    transfer-to-human/       # 转人工 skill（SKILL.md + references/kf-api.md）
  hooks/
    session-memory/          # 会话重置时持久化客户上下文
  templates/
    presale-agent/           # AGENTS.md, SOUL.md, IDENTITY.md, USER.md, TOOLS.md, HEARTBEAT.md
    support-agent/
    aftersale-agent/
```

## 客服回调入口

企微后台「接收消息服务器配置」中，回调 URL 填写：

**`https://你的域名/wecom/kefu`**（生产环境建议 HTTPS）

与 wecom 插件的 `/wecom`、`/wecom/bot`、`/wecom/agent` 同属 `/wecom` 前缀，便于统一入口。服务器需在 **5 秒内** 返回 HTTP 200，否则企微会重试。

## 开启客服委托（三步）

要让本插件收到企微客服的消息与事件，必须在企业微信后台完成「客服委托」相关配置；否则回调不会推送。

### 第一步：将自建应用加入「微信客服 - 可调用接口的应用」

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/)。
2. 进入 **客户联系 → 微信客服 → API 与回调**（或 **应用管理 → 自建应用 → 你的应用**）。
3. 在「**微信客服 - 可调用接口的应用**」中，将用于本插件的 **自建应用** 添加进去。

### 第二步：配置回调 URL 与密钥

1. 在 **应用管理 → 自建应用 → 你的应用** 中，进入「**接收消息**」或「**接收消息服务器配置**」。
2. 填写：
   - **URL**：`https://你的公网域名/wecom/kefu`（与 OpenClaw Gateway 暴露的地址一致）。
   - **Token**：与 `openclaw.json` 中 `channels.wecom-kf.token` 一致。
   - **EncodingAESKey**：与 `channels.wecom-kf.encodingAESKey` 一致。
3. 保存后企微会发 GET 请求校验 URL，本插件会解密 `echostr` 并原样返回，通过即生效。

### 第三步：为应用授权至少一个客服账号

- 在「**微信客服 - 可调用接口的应用**」或客服账号管理中，为上述自建应用 **授权至少一个客服账号**。
- 官方说明：对自建应用，配置到「微信客服 - 可调用接口的应用」且授权了至少一个客服账号后，**自动获得**「微信客服→管理账号、分配会话和收发消息」权限，并开始接收 **微信客服消息和事件**。

完成以上三步后，企微会向你的回调 URL 推送 `kf_msg_or_event` 等事件，本插件即可正常收发消息。若未配置或未授权，回调不会触发。

**参考**：[微信客服 - 回调通知](https://developer.work.weixin.qq.com/document/path/97712)、[接收消息和事件](https://developer.work.weixin.qq.com/document/path/94670)。

## 与 wecom 插件的关系（自建应用如何配置）

**wecom-kf 与 [@partme.ai/wecom](https://www.npmjs.com/package/@partme.ai/wecom) 不是同一套体系**：前者对应企微「**微信客服**」（公众号/小程序/视频号用户进线），后者对应企微「**客户联系**」（智能机器人 + 自建应用 Bot/推送）。两者 channel 不同（`wecom-kf` vs `wecom`），可同时安装；若两种场景都要，需用**两个自建应用**分别配置。

| 维度 | wecom（客户联系） | wecom-kf（微信客服） |
|------|-------------------|----------------------|
| 典型用途 | 内部/客户与机器人聊天、自建应用发消息 | 外部用户从「微信客服」进线，AI + 转人工 |
| 回调路径 | `/plugins/wecom/bot/{accountId}`、`/plugins/wecom/agent/{accountId}` | `/wecom/kefu` |
| 后台配置 | 自建应用「接收消息」填上述 URL | 自建应用加入「微信客服-可调用接口的应用」+ 接收消息 URL = `/wecom/kefu` |

一个自建应用只能填**一个**接收消息 URL，因此不能用一个应用同时接客户联系和微信客服。推荐：

| 需求 | 安装 | 自建应用与 URL |
|------|------|----------------|
| 只要微信客服进线 | wecom-kf | 1 个自建应用 → 加入「微信客服-可调用接口的应用」→ 接收消息 URL = `https://你的域名/wecom/kefu` |
| 只要客户联系 Bot/应用 | wecom | 1 个自建应用 → 接收消息 URL = `https://你的域名/plugins/wecom/agent/{accountId}` |
| 微信客服 + 客户联系都要 | wecom + wecom-kf | 2 个自建应用：一个 URL = `/wecom/kefu`，一个 URL = `/plugins/wecom/agent/xxx` |

## 微信客服官方文档索引

| 分类 | 文档 |
|------|------|
| 概述 | [微信客服概述](https://developer.work.weixin.qq.com/document/path/94638) |
| 客服账号管理 | [添加](https://developer.work.weixin.qq.com/document/path/94662) / [删除](https://developer.work.weixin.qq.com/document/path/94663) / [修改](https://developer.work.weixin.qq.com/document/path/94664) / [列表](https://developer.work.weixin.qq.com/document/path/94661) / [获取客服链接](https://developer.work.weixin.qq.com/document/path/94665) |
| 接待人员管理 | [添加](https://developer.work.weixin.qq.com/document/path/94646) / [删除](https://developer.work.weixin.qq.com/document/path/94647) / [列表](https://developer.work.weixin.qq.com/document/path/94645) |
| 会话与消息 | [分配客服会话](https://developer.work.weixin.qq.com/document/path/94669)（含流程图与状态表，可作系统设计参考） / [接收消息和事件](https://developer.work.weixin.qq.com/document/path/94670) / [发送消息](https://developer.work.weixin.qq.com/document/path/94677) / [发送欢迎语等事件消息](https://developer.work.weixin.qq.com/document/path/95122) |
| 客户与统计 | [获取客户基础详情](https://developer.work.weixin.qq.com/document/path/95159) / [客户数据统计-企业汇总](https://developer.work.weixin.qq.com/document/path/95489) / [客户数据统计-接待人员明细](https://developer.work.weixin.qq.com/document/path/95490) |
| 机器人 | [知识库分组](https://developer.work.weixin.qq.com/document/path/95971) / [知识库问答](https://developer.work.weixin.qq.com/document/path/95972) |
| 回调 | [回调通知](https://developer.work.weixin.qq.com/document/path/97712) |

## 企微 API 覆盖

| API | 端点 | 用途 |
|---|---|---|
| **回调接收** | `/wecom/kefu` | 接收消息/事件通知 |
| **同步消息** | `kf/sync_msg` | 拉取消息（3 天内） |
| **发送消息** | `kf/send_msg` | AI 回复客户 |
| **事件消息** | `kf/send_msg_on_event` | 欢迎语/结束语（带 welcome_code） |
| **会话状态** | `kf/service_state/get` | 查询当前会话状态 |
| **转接** | `kf/service_state/trans` | 转接人工客服 |
| **账号列表** | `kf/account/list` | 发现所有客服账号 |
| **客服列表** | `kf/servicer/list` | 获取可用人工客服（94645） |
| **接入链接** | `kf/add_contact_way` | 获取客服账号链接（94665） |

## 会话配置（推荐）

为保证按客户和客服账号正确隔离会话，建议在 OpenClaw 中做如下配置（渠道 meta 提供 `recommendedConfig`）：

- **`session.dmScope`**：使用 `per-account-channel-peer`，使每个客户 × 客服账号拥有独立会话。
- **`session.resetByChannel`**：对 `wecom-kf` 使用空闲重置（如 `idleMinutes: 2880`），48 小时无活动后结束会话，与企微 48 小时回复窗口一致。

若未设置为 per-peer 模式，插件启动时会打印警告。

## 钩子

| 钩子 | 触发事件 | 用途 |
|---|---|---|
| `session-memory` | `command:new`（wecom-kf 渠道） | 会话重置时，将客户上下文（昵称、客服账号、最近消息）写入 Agent 工作区 `memory/YYYY-MM-DD.md`，供长期记忆使用 |

## 自动回复命令

| 命令 | 说明 |
|---|---|
| `/kf-status` | 在会话中返回企微客服账号连接状态及各账号在线客服数 |

## Agent 工作区模板

插件在 `templates/` 下提供三种即用型 Agent 模板：

| 模板 | 路径 | 适用场景 |
|---|---|---|
| 售前 | `templates/presale-agent/` | 售前与销售（AGENTS.md、SOUL.md、IDENTITY.md、USER.md、TOOLS.md、HEARTBEAT.md） |
| 支持 | `templates/support-agent/` | 技术支持（含 exec 工具、知识库路径） |
| 售后 | `templates/aftersale-agent/` | 售后服务（政策、保修、退换货） |

将所需模板复制到 Agent 工作区后，按需调整模型引用和路径即可。

## 消息流程

1. **回调接收**：企微向 `/wecom/kefu` 发送 POST
2. **解密**：插件使用 AES-256-CBC 解密回调
3. **事件路由**：
   - `msg` 事件 → `message-handler.ts` → OpenClaw Agent
   - `enter_session` → 发送欢迎语
   - `session_status_change`（结束）→ 发送结束语 + 满意度评价
4. **AI 回复**：Agent 处理消息，生成回复
5. **消息下发**：插件调用 `kf/send_msg` 发送回复

## 配置

### openclaw.json 中的渠道配置

```json
{
  "channels": {
    "wecom-kf": {
      "corpId": "企业ID",
      "corpSecret": "应用密钥",
      "token": "回调Token",
      "encodingAESKey": "AES密钥",
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
          "eventMessages": { /* 账号级覆盖 */ }
        }
      }
    }
  }
}
```

### Agent 绑定

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

## 智能转人工技能

可选技能位于 `skills/`（如 `skills/transfer-to-human/SKILL.md`），**不会**由插件 manifest 自动加载；需要时复制或软链到 agent workspace。规范与 wecom 插件 skills 一致（frontmatter、分节、references）。Agent 可据此判断何时转接人工：

```markdown
# 转人工技能

当客户明确要求转人工，或当你无法充分回答问题时，
使用此技能将会话转接给人工客服。

## 步骤：
1. 通过 servicer/list 检查可用人工客服
2. 如有可用客服，调用 service_state/trans
3. 如无可用客服，告知客户等待时间或回拨选项
```

## 测试

```bash
pnpm test            # 运行单元测试
pnpm test:watch      # 监听模式
pnpm test:coverage   # 覆盖率报告
```

测试覆盖：
- `account-manager.test.ts` — 自定义 Agent 映射 + 缓存（9 个测试）
- `message-handler.test.ts` — 多模态消息提取（11 个测试）

## 开发

```bash
pnpm install
pnpm build
pnpm dev   # watch 模式
```

## API 约束（重要）

| 约束 | 值 | 说明 |
|---|---|---|
| 回复窗口 | 48 小时 | 必须在客户最后一条消息后 48 小时内回复 |
| 消息限制 | 5 条 | 每条客户消息最多回复 5 条 |
| sync_msg 有效期 | 3 天 | 超过 3 天的消息无法拉取 |
| Token 有效期 | 10 分钟 | Access Token 10 分钟过期 |
| welcome_code 有效期 | 20 秒 | 必须在 20 秒内发送欢迎语 |

## 生产环境清单

- **回调 URL**：使用 **HTTPS** 与稳定公网域名；**5 秒内** 返回 200。
- **企业可信 IP**：若网关按 IP 限制访问，需放行 [企业微信回调 IP 段](https://developer.work.weixin.qq.com/document/path/92521)，保证企微可访问 `/wecom/kefu`。
- **配置**：确保 `corpId`、`corpSecret`、`token`、`encodingAESKey` 与企微应用及回调配置一致；插件启动时仅在配置有效时发现客服账号。

## 会话状态说明

| 状态值 | 说明 |
|---|---|
| 0 | 未处理（新会话进入，自动变为 1） |
| 1 | 由智能客服接待（AI Agent） |
| 2 | 待接入池（等待人工接待） |
| 3 | 由人工客服接待 |
| 4 | 已结束 |

## 关键类型

| 类型 | 说明 |
|---|---|
| `KfMessage` | 企微消息结构（origin、msgtype、event、open_kfid、external_userid） |
| `KfAccount` | 客服账号（open_kfid、name、avatar、manage_privilege） |
| `EventMessagesConfig` | 欢迎语/结束语/满意度评价配置 |
| `wecomKfChannel` | 渠道定义对象（capabilities、config、outbound） |

## 插件配置（configSchema）

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `corpId` | string | — | 企业微信 Corp ID |
| `corpSecret` | string | — | 客服应用密钥 |
| `token` | string | — | 回调验证 Token |
| `encodingAESKey` | string | — | 回调加解密 AES Key |
| `session.dmScope` | string | `per-account-channel-peer` | 会话隔离级别 |
| `session.resetByChannel` | object | `{mode:"idle", idleMinutes:2880}` | 渠道会话重置策略 |
| `eventMessages.welcome` | object | — | 默认欢迎语配置 |
| `eventMessages.ending` | object | — | 默认结束语配置 |
| `eventMessages.satisfaction` | object | — | 满意度评价配置 |
| `humanTransfer.waitTimeout` | number | 300 | 无人工客服时等待超时（秒） |
| `icsEnabled` | boolean | `false` | 为 `true` 时注册 `/ics/*` 运营 REST API；KF 核心不依赖此项 |

## 文档

| 文档 | 说明 |
|------|------|
| [Roadmap Phase 3](../../doc/wecom-kf/OpenClaw-WeCom-KF-Roadmap.md) | 任务状态与验收命令 |
| [联调 Checklist](../../doc/wecom-kf/Integration-Checklist.md) | 回调、sync、多账号、媒体、Control Tools、icsEnabled |
| [主架构](../../doc/wecom-kf/OpenClaw-WeCom-KF-Master-Architecture.md) | 事件矩阵与模块边界 |
| [Tools 架构](../../doc/wecom-kf/OpenClaw-WeCom-KF-Tools-Architecture.md) | Control Tools 与 transcript 隔离 |

## OpenClaw 生态插件

| 插件 | 说明 |
|------|------|
| [openclaw-oauth2](https://github.com/partme-ai/openclaw-oauth2) | OAuth2 认证 |
| [openclaw-cluster](https://github.com/partme-ai/openclaw-cluster) | 集群协调（发现 / 配置同步 / 会话存储 / 代理） |
| [openclaw-mqtt](https://github.com/partme-ai/openclaw-mqtt) | MQTT 协议接入 |
| [openclaw-prometheus](https://github.com/partme-ai/openclaw-prometheus) | Prometheus 指标导出 |
| [openclaw-stomp](https://github.com/partme-ai/openclaw-stomp) | STOMP 服务端 |
| [openclaw-tracing](https://github.com/partme-ai/openclaw-tracing) | 链路追踪 |
| [openclaw-web-mqtt](https://github.com/partme-ai/openclaw-web-mqtt) | WebSocket MQTT |
| [openclaw-web-stomp](https://github.com/partme-ai/openclaw-web-stomp) | WebSocket STOMP |
| [wecom_kf](https://github.com/partme-ai/openclaw_wecom_kf) | 企微客服渠道 |

## 许可证

MIT
