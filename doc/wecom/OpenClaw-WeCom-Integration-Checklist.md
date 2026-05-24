# 企业微信（WeCom）真实联调 Checklist

> 面向 `@partme.ai/wecom` 在**真实企微环境**下的 Bot WS / Webhook Bot / Agent 三路径联调。
> 单元测试见 `extensions/wecom` 内 `pnpm test`；CLI 出站示例见 [OpenClaw-WeCom-Testing.md](./OpenClaw-WeCom-Testing.md)。

**关联文档**：[配置指南](./OpenClaw-WeCom-Configuration.md) · [架构设计](./OpenClaw-WeCom-Architecture.md) · [流式架构](./OpenClaw-WeCom-Streaming-Architecture.md)

**适用人群**：准备在真实企业微信租户中验收 Bot WS、Bot Webhook 或 Agent 的开发者 / 运维。
**预计耗时**：最小 Bot WS 15–30 分钟；三路径全量验收约 60–90 分钟，取决于企业微信后台权限与公网回调准备情况。

---

## 0. 联调前通用准备

### 0.1 环境与版本

- [ ] OpenClaw Gateway 已启动：`openclaw gateway restart`
- [ ] 插件已安装：`openclaw plugins install @partme.ai/wecom@latest --dangerously-force-unsafe-install`
- [ ] 依赖版本对齐（monorepo 当前）：
  - `@partme.ai/wecom`：`2026.5.25`
  - `@partme.ai/openclaw-message-sdk`：`2026.5.24`（workspace）
  - `openclaw` peer：`>=2026.4.12`
- [ ] 本地自检：`cd extensions/wecom && pnpm test && pnpm typecheck`（当前约 330 个测试用例，数量会随源码变化）

### 0.2 通道状态

```bash
openclaw channels list
openclaw channels status --probe
openclaw plugins doctor
```

- [ ] 目标账号显示 **configured, enabled**
- [ ] 日志路径可访问：`/tmp/openclaw/openclaw-YYYY-MM-DD.log`

### 0.3 测试账号与用户

- [ ] 已知测试用户 **userid**（如 `WanDaLong`），且已向 Bot 发过私聊（建立会话）
- [ ] 群聊测试：已知 **chatid**（群 id），Bot 已加入且可 @
- [ ] CLI 主动出站需 `operator.write` scope（见 Testing 文档「CLI 设备授权」）

---

## 1. Bot WebSocket 模式

> 默认连接方式：`connectionMode: "websocket"`（或未设置）。凭证：`botId` + `secret`。

### 1.1 前置条件

**企微管理后台**

- [ ] 安全与管理 → 管理工具 → **智能机器人** → 创建（API 模式）
- [ ] 记录 **Bot ID**、**Secret**

**OpenClaw 配置**

- [ ] `channels.wecom.enabled: true`
- [ ] `channels.wecom.connectionMode: "websocket"`（或省略，默认 websocket）
- [ ] 账号级 `botId`、`secret` 已填写
- [ ] （可选）`dmPolicy` / `groupPolicy` / `allowFrom` / `groupAllowFrom` 按预期设置
- [ ] （可选）`*Text` 文案已配置（见 §4.1）

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.accounts.default.botId "<BOT_ID>"
openclaw config set channels.wecom.accounts.default.secret "<SECRET>"
openclaw gateway restart
```

### 1.2 连接与认证

- [ ] 日志出现：`[<accountId>] WebSocket connected`
- [ ] 日志出现：`[<accountId>] Authentication successful`
- [ ] `openclaw channels status --probe` 显示 WS 运行中
- [ ] 无重复 Gateway / 重复账号实例（见 §1.6 kicked）

### 1.3 私聊（DM）

- [ ] 发送纯文本「测试 WS 私聊」
- [ ] 日志：`aibot_callback`，`from.userid` 正确
- [ ] Bot 回复正常（流式气泡或整包，取决于 `streaming` 配置）
- [ ] `dmPolicy=open`：任意用户可聊
- [ ] `dmPolicy=allowlist`：非白名单用户被拦截，日志含 `dm policy blocked`
- [ ] `dmPolicy=disabled`：私聊被拦截

### 1.4 群聊

- [ ] 在已授权群内 @Bot 发送消息
- [ ] 日志 `chattype=group`，`chatid` 正确
- [ ] `groupPolicy=open`：任意群可触发
- [ ] `groupPolicy=allowlist`：非白名单群被拦截，日志含 `group policy blocked`
- [ ] 未 @Bot 的消息不触发回复（若企微侧要求 @）

### 1.5 消息类型

| 类型 | 操作 | 验证点 |
|------|------|--------|
| 文本 | 发送「你好」 | 正常回复；日志有 dispatch |
| 图片 | 发送图片 | 入站媒体落盘；`readingText` 状态栏（若启用 footer） |
| 语音 | 发送语音 | 媒体下载成功；Agent 侧 ASR 不在 WS 路径 |
| 文件 | 发送文件 | 媒体路径写入 InboundContext |
| 引用 | 引用消息后 @Bot | 引用内容作为 body |

- [ ] 以上至少各测一条

### 1.6 流式与降级

**默认（`streaming: false`）**

- [ ] 气泡显示 `thinkingText` 等状态栏（`footer.status: true`）
- [ ] 最终一次出完整答案

**流式（`streaming: true`）**

- [ ] 中间帧增量更新（`streaming.content: true`）
- [ ] 工具调用时显示 `toolStatusText`（含 `{toolName}` 占位符）
- [ ] 首帧占位来自 `streamPlaceholderText`（默认 WS 回退 `<think></think>`）

**846608 降级（6 分钟窗口）**

- [ ] 超长推理或人工延迟后，若 stream 过期，日志含 `846608` 或 `stream expired`
- [ ] 用户仍收到最终内容（降级为 `sendMessage` 主动发送）
- [ ] 不出现「气泡假死、无最终回复」

### 1.7 welcomeText / enter_chat

- [ ] 配置 `channels.wecom.welcomeText "你好，我是助手"`
- [ ] 打开 Bot 会话（触发 `enter_chat`）
- [ ] 日志：`ws-event: sent enter_chat welcome` 或等价
- [ ] 用户收到欢迎语（**非** `streamPlaceholderText`）

### 1.8 command-auth 与 pairing

**命令授权（斜杠命令等）**

- [ ] 未授权用户发送命令，收到中文权限提示（非静默忽略）
- [ ] 日志：`authz: ... commandAuthorized=false`
- [ ] 管理员按提示配置 `allowFrom` 或 `dmPolicy` 后命令可用

**pairing（`dmPolicy: "pairing"`）**

- [ ] 新用户私聊，收到 pairing 码
- [ ] `openclaw pairing list wecom` 可见待审批
- [ ] `openclaw pairing approve wecom <CODE>` 后该用户可正常对话

### 1.9 出站主动推送（WS）

```bash
openclaw message send \
  --channel wecom \
  --account default \
  --target <USERID> \
  --message "【WS 主动测试】"
```

- [ ] 成功：`Sent via gateway (wecom). Message ID: aibot_send_msg_...`
- [ ] **勿**使用 `user:<USERID>` 作为 `--target`（会 93006 invalid chatid）

### 1.10 常见失败与排查

| 现象 | 可能原因 | 排查 |
|------|----------|------|
| `Authentication successful` 不出现 | botId/secret 错误 | 核对后台凭证；grep `auth` / `Authentication` |
| `Kicked by server: a new connection was established elsewhere` | 重复实例互踢 | 只保留一个 Gateway；插件会避免立即自动重启，防止互踢循环 |
| 连接后无入站 | dm/group policy 拦截 | grep `policy blocked` |
| `93006 invalid chatid` | CLI target 带 `user:` 前缀 | 改用纯 userid |
| `60020 not allow to access from your ip` | 出口 IP 不在企微可信名单 | 配置 `channels.wecom.network.egressProxyUrl` |
| 消息无回复、无错误 | Agent 超时 | grep `Agent reply timed out`；调 `network.agentReplyTimeoutMs` |

**日志 grep 关键词（WS）**

```bash
grep -E 'Authentication successful|aibot_callback|Kicked by server|846608|policy blocked|authz:|enter_chat welcome|Agent reply timed out' /tmp/openclaw/openclaw-*.log
```

---

## 2. Webhook Bot 模式

> `connectionMode: "webhook"`。凭证：`token` + `encodingAESKey`；需公网 HTTPS 回调。

### 2.1 前置条件

**企微管理后台**

- [ ] 智能机器人 → API 模式 → 配置 **接收消息服务器 URL**
- [ ] URL 示例：`https://<公网域名>/plugins/wecom/bot/<accountId>`
- [ ] 记录 **Token**、**EncodingAESKey**
- [ ] 保存时 GET 验签通过（企微后台「验证成功」）

**OpenClaw 配置**

- [ ] `connectionMode: "webhook"`
- [ ] `token`、`encodingAESKey` 与后台一致
- [ ] 纯 Webhook 模式不要配置 `botId` + `secret`；`aibotid`、`botIds` 不作为主要运行时配置
- [ ] `dmPolicy` / `groupPolicy` 与 WS 相同语义

```bash
openclaw config set channels.wecom.connectionMode webhook
openclaw config set channels.wecom.accounts.default.token "<TOKEN>"
openclaw config set channels.wecom.accounts.default.encodingAESKey "<AES_KEY_43_CHARS>"
openclaw gateway restart
```

### 2.2 POST 验签与解密

- [ ] GET Challenge 返回解密 echostr（后台验证通过）
- [ ] POST 用户消息：日志无 `signature verify failed`
- [ ] 解密后 JSON 含 `msgid`、`from.userid`（或群 `chatid`）
- [ ] 发送者为 `sys` 的消息被丢弃（日志 `system_sender`）

### 2.3 Stream 首帧与 refresh

- [ ] 用户发消息后，**首次 HTTP 响应**为 `msgtype: stream`（占位内容）
- [ ] 占位文案来自 `streamPlaceholderText`（未配置时 Webhook 默认 `"1"`）
- [ ] 企微侧 `stream_refresh` 轮询时，气泡内容递增更新
- [ ] 处理完成后 `finish: true`，用户看到最终答案
- [ ] 6 分钟内无更新 → 846608 时，`active-reply` 主动推送兜底

### 2.4 Debounce 合并

- [ ] 500ms 内连发多条消息（默认 `DEFAULT_DEBOUNCE_MS=500`，可配 `debounceMs`）
- [ ] 日志出现 merged / queued 相关文案（`mergedQueuedText` / `mergedDoneText`）
- [ ] Agent 侧只 dispatch **一次**，body 为合并内容

### 2.5 持久化 dedup

- [ ] 同一 `msgid` 重复 POST（企微重试）：第二次被跳过
- [ ] 日志：`duplicate msgId` 或 dedup 未再次 dispatch
- [ ] 持久化目录：`~/.openclaw/state/wecom/dedup/<accountId>.json`（warmup 日志 `[wecom-dedup] warmup`）

### 2.6 access-policy（DM / Group / pairing）

- [ ] 群策略拦截：日志 `[webhook] group policy blocked`
- [ ] DM 策略拦截：日志 `[webhook] dm policy blocked`
- [ ] `dmPolicy=pairing`：pairing 码经 **`response_url` / stream 主动推送**（非 WS 私信）
- [ ] command-auth：未授权命令有中文提示，scope 为 `bot`

### 2.7 response_url 与 enter_chat

- [ ] `enter_chat` 事件：配置 `welcomeText` 后用户收到欢迎
- [ ] 日志：`[webhook] enter_chat (userId=...)`

### 2.8 本地媒体 path guard

- [ ] 配置 `channels.wecom.mediaLocalRoots`（如 `["/data/shared"]`）
- [ ] Agent 回复含本地路径媒体时，路径在 allowlist 内可发送
- [ ] 路径不在 allowlist：用户看到 `mediaErrorNoAccessText` 类提示
- [ ] 未配置 `mediaLocalRoots` 时，本地路径发送失败（安全默认）

### 2.9 Webhook 验证点汇总

| 步骤 | 预期 |
|------|------|
| GET 验证 | 200 + 明文 echostr |
| 首条 POST | 立即返回 stream 占位 |
| stream_refresh | content 随生成更新 |
| 完成 | finish=true，内容非空 |
| 重试 msgid | 不重复回复 |
| 策略拦截 | 200 但不 dispatch |

**日志 grep（Webhook）**

```bash
grep -E '\[webhook\]|stream_refresh|duplicate msgId|wecom-dedup|policy blocked|authz:|enter_chat|846608|active-reply' /tmp/openclaw/openclaw-*.log
```

---

## 3. Agent 模式（自建应用）

> XML 加密回调 + API 主动发送。凭证：`corpId`、`corpSecret`、`agentId`、`token`、`encodingAESKey`。

### 3.1 前置条件

**企微管理后台**

- [ ] 应用管理 → 自建应用 → 创建
- [ ] **设置 API 接收**：URL `https://<域名>/plugins/wecom/agent/<accountId>`
- [ ] 记录 CorpID、Secret、AgentId、Token、EncodingAESKey
- [ ] 应用可见范围包含测试用户

**OpenClaw 配置**

```bash
openclaw config set channels.wecom.accounts.default.agent.corpId "<CORP_ID>"
openclaw config set channels.wecom.accounts.default.agent.corpSecret "<SECRET>"
openclaw config set channels.wecom.accounts.default.agent.agentId 1000002
openclaw config set channels.wecom.accounts.default.agent.token "<TOKEN>"
openclaw config set channels.wecom.accounts.default.agent.encodingAESKey "<AES_KEY>"
openclaw gateway restart
```

- [ ] Agent 与 Bot 可同账号并存（Bot 对话 + Agent 推送兜底）

### 3.2 入站解密

- [ ] GET Challenge 验证通过
- [ ] POST XML 解密成功：日志 `[wecom-agent] inbound: decryptedBytes=...`
- [ ] `msgType`、`fromUser`、`msgId` 解析正确
- [ ] HTTP **立即** 返回 `success`（Agent 用 API 异步回复，非被动 XML 回复）

### 3.3 持久化 dedup

- [ ] 相同 `msgId` 重试：日志 `duplicate msgId=... skipped`，不二次回复
- [ ] 与 Webhook Bot 共用 dedup 存储机制（`claimWecomAgentInboundMsgid`）

### 3.4 DM / Group policy

- [ ] Agent **仅私聊**入站（群聊不走 Agent XML 路径）
- [ ] `dmPolicy` 拦截：日志 `[wecom-agent] dm policy blocked`
- [ ] pairing：经 **应用 API 私信** 下发 pairing 码（非 response_url）

### 3.5 消息类型与回复

| 类型 | 验证点 |
|------|--------|
| 文本 | `message/send` Markdown/文本到达 |
| 图片/文件 | 媒体下载 + 上传 + 发送 |
| 语音 | ASR 转写后进 Agent |
| enter_chat / subscribe | `agent.welcomeText` 或共用 `welcomeText` |

- [ ] **无 Bot 式 replyStream**；回复为一次性 API 发送
- [ ] 出站文件超限时错误文案可读

### 3.6 流式 / 非流式与超时

- [ ] Agent 路径不支持企微 Bot 流式协议
- [ ] `network.agentReplyTimeoutMs` 超时：用户收到 `timeoutText` 类降级，日志 `Agent reply timed out`
- [ ] Cron / `openclaw message send` 在 WS 不可用时回退 Agent API

### 3.7 command-auth

- [ ] 未授权命令：中文提示，scope 为 `agent`
- [ ] 配置路径提示使用 `channels.wecom.agent.*`（见 `buildWecomUnauthorizedCommandPrompt`）

### 3.8 Agent 验证点汇总

| 步骤 | 预期 |
|------|------|
| 验签解密 | 200 success，后台无重试风暴 |
| 文本私聊 | 一条 API 回复 |
| 重复 msgId | skipped |
| 超时 | 降级文案 + 无挂死 |
| welcome | enter_chat 欢迎语 |

**日志 grep（Agent）**

```bash
grep -E '\[wecom-agent\]|duplicate msgId|dm policy blocked|media saved|welcome message|Agent reply timed out|gettoken|message/send' /tmp/openclaw/openclaw-*.log
```

---

## 4. 通用配置与安全

### 4.1 OpenClaw 配置片段（*Text 平铺）

> 用户可见文案使用 **平铺 `*Text` 字段**，不使用 `templates.*` 嵌套。

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "main",
      "connectionMode": "websocket",
      "streaming": false,
      "footer": { "status": true, "elapsed": false },
      "dmPolicy": "open",
      "groupPolicy": "open",
      "welcomeText": "你好，我是 OpenClaw 助手",
      "thinkingText": "正在思考…",
      "toolStatusText": "正在调用 {toolName}…",
      "readingText": "正在阅读附件…",
      "generatingText": "正在输入…",
      "streamPlaceholderText": "1",
      "finishFooterText": "⏱ {elapsed}s · 已完成",
      "timeoutText": "处理超时，请稍后再试",
      "mediaLocalRoots": ["/data/wecom-media"],
      "media": {
        "maxBytes": 20971520
      },
      "network": {
        "agentReplyTimeoutMs": 360000,
        "egressProxyUrl": "http://proxy.company.local:3128"
      },
      "accounts": {
        "main": {
          "botId": "<BOT_ID>",
          "secret": "<BOT_SECRET>",
          "token": "<WEBHOOK_TOKEN>",
          "encodingAESKey": "<AES_KEY>",
          "agent": {
            "corpId": "<CORP_ID>",
            "corpSecret": "<SECRET>",
            "agentId": 1000002,
            "token": "<AGENT_TOKEN>",
            "encodingAESKey": "<AGENT_AES_KEY>",
            "welcomeText": "欢迎使用自建应用"
          }
        }
      }
    }
  }
}
```

- [ ] `streamPlaceholderText` 仅用于 Bot 流式**首帧协议占位**，不作为欢迎语
- [ ] 完整键名见 `extensions/wecom/src/text-config.ts`（`WECOM_TEXT_KEY_MAPPING`）

### 4.2 message-sdk 依赖

| 包 | 用途 |
|----|------|
| `@partme.ai/openclaw-message-sdk` | ingress command-auth、dedup、transcript 流式、keyed queue、config merge |
| 版本 | 与 `@partme.ai/wecom` 同 monorepo 发布，当前 `2026.5.25` |

### 4.3 未接线 / 规划字段

以下字段存在于类型或规划中，但不要作为当前运行时能力验收：

| 字段 | 状态 |
|------|------|
| `media.tempDir`、`media.retentionHours`、`media.cleanupOnStart` | 规划中的临时文件清理配置，当前不作为运行时清理开关 |
| `network.timeoutMs`、`network.retries`、`network.retryDelayMs` | 规划中的通用 HTTP 重试配置，当前不要依赖 |

### 4.4 安全清单

- [ ] **allowlist**：生产环境 `dmPolicy` / `groupPolicy` 不用 `open`（按需收紧）
- [ ] **allowFrom / groupAllowFrom**：白名单 userid / chatid 最小化
- [ ] **media.maxBytes**：默认 20MB（`20971520`），与 `const.ts` 一致
- [ ] **mediaLocalRoots**：本地文件发送路径白名单；未配置则拒绝本地路径
- [ ] **path guard**：出站读取本地媒体前 `assertLocalMediaAllowed`；错误走 `mediaErrorNoAccessText`
- [ ] **Webhook 请求体上限**：1MB（`MAX_REQUEST_BODY_SIZE`）
- [ ] **Token / Secret**：仅环境变量或加密配置，勿提交仓库
- [ ] **公网回调**：HTTPS + 企微 IP 白名单（若启用）

### 4.5 日志 grep 速查（全模式）

```bash
LOG=/tmp/openclaw/openclaw-$(date +%Y-%m-%d).log

# 连接与认证
grep -E 'Authentication successful|WebSocket connected|Kicked by server|\[webhook\]' "$LOG"

# 入站与策略
grep -E 'aibot_callback|policy blocked|authz:|duplicate msgId' "$LOG"

# 流式与降级
grep -E '846608|stream expired|stream_refresh|finalizeWsWecomReply|active-reply' "$LOG"

# Agent
grep -E '\[wecom-agent\]|gettoken|60020|93006' "$LOG"

# 去重与队列
grep -E 'wecom-dedup|debounce|merged|queued' "$LOG"
```

### 4.6 发布前 Smoke Test 顺序

按依赖从底到顶，**约 15–30 分钟**：

1. [ ] **配置与 doctor**：`openclaw plugins doctor` + `channels list` 无 ERROR
2. [ ] **Bot WS 连接**：Authentication successful
3. [ ] **Bot WS 私聊文本**：一问一答
4. [ ] **Bot WS 图片**：入站 + 回复
5. [ ] **enter_chat welcomeText**：开新会话可见
6. [ ] **CLI 主动出站**：`message send` 纯 userid 成功
7. [ ] **（若启用 Webhook）** GET 验签 + POST 文本 + stream 完成
8. [ ] **（若启用 Webhook）** 连发 2 条验证 debounce
9. [ ] **（若启用 Agent）** 私聊文本 + API 回复
10. [ ] **（若启用 Agent）** Cron 或 `agent --deliver` 出站
11. [ ] **pairing 或 allowlist**（若生产策略）：拦截 + 审批链路
12. [ ] **command-auth**：未授权命令有提示
13. [ ] **grep 日志**：无未处理 exception、无 kicked 循环
14. [ ] **多账号**（若有）：账号前缀 `[default]` / `[bot2]` 隔离正确

---

## 5. 快速交叉引用

| 主题 | 文档 |
|------|------|
| 安装与双模配置 | [OpenClaw-WeCom-Configuration.md](./OpenClaw-WeCom-Configuration.md) |
| 三路径架构 | [OpenClaw-WeCom-Architecture.md](./OpenClaw-WeCom-Architecture.md) |
| 846608 / 6 分钟窗口 | [OpenClaw-WeCom-Streaming-Architecture.md](./OpenClaw-WeCom-Streaming-Architecture.md) |
| CLI 出站 / 93006 | [OpenClaw-WeCom-Testing.md](./OpenClaw-WeCom-Testing.md) |

---

**最后更新**：与 `@partme.ai/wecom@2026.5.25` 及 `openclaw-message-sdk@2026.5.24` 源码对齐。
