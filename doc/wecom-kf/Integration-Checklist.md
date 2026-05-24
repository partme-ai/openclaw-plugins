# 企业微信客服（WeCom KF）真实联调 Checklist

> 面向 `@partme.ai/wecom-kf` 在**真实企微环境**下的 KF 回调、sync_msg、多账号、媒体、Control Tools 与 ICS 可选模块联调。  
> 单元测试见 `extensions/wecom-kf` 内 `pnpm test`；路线图 Phase 状态见 [OpenClaw-WeCom-KF-Roadmap.md](./OpenClaw-WeCom-KF-Roadmap.md)。

**关联文档**：[主架构](./OpenClaw-WeCom-KF-Master-Architecture.md) · [Tools 架构](./OpenClaw-WeCom-KF-Tools-Architecture.md) · [wecom 联调 Checklist](../wecom/OpenClaw-WeCom-Integration-Checklist.md)（客户联系 Bot/Agent 对照）

---

## 0. 联调前通用准备

### 0.1 环境与版本

- [ ] OpenClaw Gateway 已启动：`openclaw gateway restart`
- [ ] 插件已安装：`openclaw plugins install @partme.ai/wecom-kf@latest --dangerously-force-unsafe-install`
- [ ] 依赖版本对齐（monorepo 当前）：
  - `@partme.ai/wecom-kf`：与 workspace 同步
  - `@partme.ai/openclaw-message-sdk`：workspace 版本
  - `openclaw` peer：`>=2026.4.12`
- [ ] 本地自检：

```bash
cd openclaw-plugins/extensions/wecom-kf
pnpm test && pnpm typecheck && pnpm build
```

### 0.2 通道状态

```bash
openclaw channels list
openclaw channels status wecom-kf
openclaw plugins doctor
```

- [ ] 目标渠道显示 **configured, enabled**
- [ ] 日志路径可访问：`/tmp/openclaw/openclaw-YYYY-MM-DD.log`

### 0.3 测试客户与客服账号

- [ ] 已知测试 **external_userid**（微信客户，从客服入口进线后可在 sync_msg 日志或企微后台查看）
- [ ] 已知至少一个 **open_kfid**（客服账号 ID，94661 列表或后台）
- [ ] 已知至少一名在线 **servicer_userid**（接待人员，94645 列表）
- [ ] 测试客户已向该 `open_kfid` 发起过会话（建立 48h 回复窗口）

---

## 1. 企微管理后台（回调前置）

> 对应企微文档 [97712 回调通知](https://developer.work.weixin.qq.com/document/path/97712)、[94670 接收消息和事件](https://developer.work.weixin.qq.com/document/path/94670)。

### 1.1 应用与客服委托

- [ ] 登录 [企业微信管理后台](https://work.weixin.qq.com/)
- [ ] **客户联系 → 微信客服 → API 与回调**：自建应用已加入「**微信客服 - 可调用接口的应用**」
- [ ] 该应用已 **授权至少一个客服账号**（`open_kfid`）
- [ ] 应用可见范围包含测试用接待人员

### 1.2 接收消息服务器配置

- [ ] **URL**：`https://<公网域名><webhookPath>`
  - 默认路径：`/wecom-kf` 或兼容别名 `/wecom/kefu`、`/plugins/wecom-kf`（见 `collectWecomKfRoutePaths`）
  - 账号级可覆盖：`channels.wecom-kf.accounts.<key>.webhookPath`
- [ ] **Token**：与 `channels.wecom-kf.token`（或账号级 `token`）一致
- [ ] **EncodingAESKey**：与 `channels.wecom-kf.encodingAESKey` 一致
- [ ] 保存时 GET 验签通过（企微后台显示「验证成功」）
- [ ] 生产环境使用 **HTTPS**；Gateway **5 秒内** 返回 HTTP 200

### 1.3 凭证与 openclaw.json

```json
{
  "channels": {
    "wecom-kf": {
      "corpId": "<CORP_ID>",
      "corpSecret": "<KF_APP_SECRET>",
      "token": "<CALLBACK_TOKEN>",
      "encodingAESKey": "<43_CHAR_AES_KEY>",
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "openKfId": "<OPEN_KFID>",
          "corpId": "<CORP_ID>",
          "corpSecret": "<KF_APP_SECRET>"
        }
      }
    }
  }
}
```

- [ ] `corpId`、`corpSecret` 与 KF 自建应用一致
- [ ] `openKfId` 与后台客服账号 ID 一致
- [ ] （可选）`apiBaseUrl` 私有化部署时指向内网代理

---

## 2. 回调与 sync_msg

> 运行时路径：`webhook/callback.ts` → `syncKfMessages` → origin 分发。

### 2.1 GET 验签

- [ ] 企微后台保存 URL 时 GET 成功
- [ ] 日志无 `signature verify failed`
- [ ] 返回解密后的 `echostr` 明文

### 2.2 POST 回调与快速 200

- [ ] 客户发消息后企微 POST `kf_msg_or_event`
- [ ] Gateway **先返回 200**，再异步 `sync_msg`
- [ ] 日志含 `[wecom_kf]` 或 `[wecom-kf]` 前缀的 sync 循环

### 2.3 sync_msg 与 cursor

- [ ] 首次启动或新 `open_kfid` 时执行 cursor prime（日志 `Priming cursor`）
- [ ] cursor 持久化至 state 目录（`cursor-store.ts`）
- [ ] 同一 `msgid` 重复推送被 dedup 跳过（`kf-inbound-dedup`）
- [ ] `has_more=true` 时循环拉取直至结束

**日志 grep**

```bash
grep -E '\[wecom_kf\]|\[wecom-kf\]|sync_msg|Priming cursor|duplicate msgid|next_cursor' /tmp/openclaw/openclaw-*.log
```

### 2.4 origin 分发矩阵（摘要）

| origin | 含义 | 预期行为 |
|:------:|------|----------|
| 3 | 微信客户消息 | → `dispatchKfMessage` → Agent → `send_msg` |
| 4 | 系统事件 | → `handleSystemEvent`（欢迎语等） |
| 5 | 接待人员消息 | Phase 4 ✅：不 dispatch Agent，仅审计日志（`webhook/callback.ts`） |

- [ ] origin=3 文本消息触发 Agent 回复
- [ ] origin=4 `enter_session` 触发欢迎语（§5.4）

---

## 3. 媒体与出站

### 3.1 入站消息类型

| 类型 | 操作 | 验证点 | Phase |
|------|------|--------|:-----:|
| 文本 | 客户发送「你好」 | Agent 收到 body；`send_msg` 回复 | 1 ✅ |
| 图片 | 客户发送图片 | Agent 收到路径或描述 | 2 实施中 |
| 文件 | 客户发送文件 | 媒体落盘；Agent 可读 | 2 实施中 |
| 语音 | 客户发送语音 | 转写或路径（若启用 transcode） | 2 可选 |

- [ ] 至少文本 round-trip 通过
- [ ] （Phase 2）图片/文件各测一条

### 3.2 API 约束（发送侧）

| 约束 | 值 |
|------|-----|
| 回复窗口 | 客户最后一条消息后 **48 小时** |
| 条数限制 | 每条客户消息最多回复 **5 条** |
| sync_msg 有效期 | **3 天** |
| welcome_code 有效期 | **20 秒**（欢迎语须及时发送） |

### 3.3 出站文本与分片

- [ ] Agent 长回复自动分片（≤2048 字节/条，KF 限制）
- [ ] Markdown 降级为纯文本（`markdown-strip`）
- [ ] 超 5 条限制时有日志或截断策略

### 3.4 出站 MEDIA:

- [ ] `before_prompt_build` 已注入 MEDIA 使用说明（`index.ts`）
- [ ] Agent 回复含 `MEDIA: /path/to/file` 时走 KF 媒体上传
- [ ] 超限文件（图片 10MB / 文件 20MB 等）有降级或错误提示

### 3.5 dm policy 与 command-auth

- [ ] `dm.policy=open`：任意客户可聊
- [ ] `dm.policy=allowlist` + `allowFrom`：非白名单被拒，日志含 policy blocked
- [ ] 未授权斜杠命令：中文权限提示（`shared/command-auth.ts`）

---

## 4. 多 open_kfid 与 bindings

> 一 `open_kfid` → 一 Agent；`bindings.accountId` 建议使用 `open_kfid`。

### 4.1 多账号配置

```json
{
  "channels": {
    "wecom-kf": {
      "accounts": {
        "presale": { "openKfId": "wkAAA...", "corpSecret": "..." },
        "support": { "openKfId": "wkBBB...", "corpSecret": "..." }
      }
    }
  },
  "bindings": [
    { "channel": "wecom-kf", "accountId": "wkAAA...", "agent": "presale-agent" },
    { "channel": "wecom-kf", "accountId": "wkBBB...", "agent": "support-agent" }
  ]
}
```

- [ ] 两个不同 `open_kfid` 进线路由到不同 Agent
- [ ] 未知 `open_kfid` fail-closed（日志警告，不串会话）
- [ ] `session.dmScope` 推荐 `per-account-channel-peer`
- [ ] 各账号可独立 `webhookPath`（若配置）

### 4.2 会话隔离

- [ ] 同一客户 × 不同 `open_kfid` → 独立 session key
- [ ] `openclaw channels status wecom-kf` 列出各账号状态

---

## 5. Control Tools 与转人工（Phase 3）

> Control Tools API 原始 JSON **不进** LLM transcript；见 [Tools 架构](./OpenClaw-WeCom-KF-Tools-Architecture.md)。

### 5.1 已注册 Tools

| Tool | 企微 API | 状态 |
|------|----------|:----:|
| `wecom_kf_list_servicers` | 94645 | ✅ |
| `wecom_kf_list_accounts` | 94661 | ✅ |
| `wecom_kf_get_account_link` | 94665 | ✅ |
| `wecom_kf_transfer_session` | 94669 | 部分完成 |

- [ ] Agent allowlist 包含上述 `wecom_kf_*`（非 legacy `wecom_kf_servicer_list`）
- [ ] Tool 执行后 transcript **无** servicer_list JSON、**无**完整客服链接 URL

### 5.2 转人工（service_state=3）

**手动 / Agent 触发：**

- [ ] Agent 调用 `wecom_kf_transfer_session`，参数 `service_state: 3`，`servicer_userid` 必填（或自动选在线坐席）
- [ ] 企微侧会话状态变为 **3（人工接待）**
- [ ] audit 日志含 `[wecom_kf:audit] action=transfer`（不进 LLM）
- [x] `details.hasMsgCode=true` 当 trans 返回 `msg_code`；SideEffectStore 消费排队/结束语

**已实现（P3-01）：**

- [x] `KfSessionSideEffectStore` 持久化 `msg_code`（`kf/session-side-effect-store.ts`）
- [x] `kf/transfer-policy.ts` 自动选择在线 servicer

### 5.3 session_status_change（P3-02 · ✅ 代码已落地，联调待验）

- [ ] sync_msg 收到 `event_type=session_status_change`（真实环境）
- [x] 当 `service_state=3`：Agent **停止**自动回复（`dispatch.ts` + `session-service-state.ts`）
- [x] 当会话结束（state=4）：触发结束语/满意度流程（与 §5.5 联动）

### 5.4 欢迎语（enter_session）

- [ ] 配置 `eventMessages.welcome` 或账号 `welcomeText`
- [ ] 客户进入会话：origin=4 · `enter_session` + `welcome_code`
- [ ] 20 秒内调用 `send_msg_on_event` 发送欢迎语
- [ ] 用户侧收到配置文案

### 5.5 排队 / 结束语 / 满意度（P3-03 · ✅ 代码已落地，联调待验）

- [x] `service_state=2`（待接入池）时发送排队提示（`event-message-dispatch` + `eventMessages.queue`）
- [x] 会话结束：发送 `eventMessages.ending` + 满意度菜单
- [ ] ICS REST `/ics/config/event-messages` 可管理配置（仅 `icsEnabled=true` 时；真实环境）

### 5.6 transcript 卫生

- [ ] 对话历史中 **无** 94645 完整 servicer 列表
- [ ] **无** 94665 完整 URL 明文
- [ ] **无** 94669 trans 原始响应 JSON

**日志 grep（Control Tools）**

```bash
grep -E '\[wecom_kf:audit\]|transfer|enter_session|session_status|send_msg_on_event|Welcome send' /tmp/openclaw/openclaw-*.log
```

---

## 6. ICS 可选模块（icsEnabled）

> 默认 **`icsEnabled: false`** — KF 核心（回调 + sync + send + Control Tools）独立运行。

### 6.1 关闭 ICS（默认）

```json
{
  "channels": {
    "wecom-kf": {
      "icsEnabled": false
    }
  }
}
```

- [ ] 插件正常启动；无 `/ics/*` 路由
- [ ] KF 文字 round-trip 仍可用
- [ ] `pnpm test index.test.ts` 中「不注册 ICS routes」用例通过

### 6.2 开启 ICS（运营后台）

```json
{
  "channels": {
    "wecom-kf": {
      "icsEnabled": true
    }
  }
}
```

- [ ] 注册路由：
  - `GET/PUT /ics/config/event-messages`
  - `GET/PUT /ics/config/bindings`
  - `GET/PUT /ics/agents`（知识库）
  - `GET /ics/stats/overview`
- [ ] 修改 event-messages 后热重载生效（`ics-utils/config-reload`）
- [ ] ICS **不**替代 KF 核心回调路径

### 6.3 ICS 与 KF 核心边界

| 能力 | KF 核心 | ICS（可选） |
|------|---------|-------------|
| 收发消息 | ✅ callback + sync + send | — |
| 欢迎语发送 | ✅ `system-event.ts` | 配置管理 REST |
| Control Tools | ✅ `wecom_kf_*` | — |
| 知识库 / 统计 | — | ✅ `ics-handlers/*` |
| Agent 模板 | — | `agents/` 独立部署 |

---

## 7. 对话状态机（Phase 3 · P3-04 ✅）

- [ ] `before_prompt_build` 对 `wecom-kf` 渠道注入状态标签
- [ ] session extension namespace：`wecom-kf-dialogue`
- [ ] 状态含 `handing_off`、`closed` 等（见 `kf/dialogue-state.ts`）
- [ ] 转人工意图 `human_request` 可触发 `handing_off` 转换

---

## 8. 安全与生产清单

- [ ] **HTTPS** 公网回调；企微 IP 白名单（若启用）
- [ ] **Token / Secret** 勿提交仓库；使用环境变量或加密配置
- [ ] **dm allowlist**：生产环境收紧 `allowFrom`
- [ ] **mediaLocalRoots**：本地 `MEDIA:` 路径白名单
- [ ] **legacyWecomCsEnabled**：保持 `false`；勿注册 Legacy Bot/Agent 路由（主路径 `/wecom-kf/bot`；旧 `/wecom-cs*` 仅在 legacy 开关开启时作别名，见 README）
- [ ] **48h / 5 条** 限制：监控 `msg_send_fail`（`fail_type` 日志）

---

## 9. 发布前 Smoke Test 顺序

约 **20–40 分钟**（按 Phase 2–3 完成度勾选）：

1. [ ] **doctor + channels list**：无 ERROR
2. [ ] **GET 验签**：企微后台 URL 验证通过
3. [ ] **文字 round-trip**：客户发「测试」→ Agent 回复
4. [ ] **cursor prime**：重启 Gateway 不重放历史
5. [ ] **欢迎语**：新会话 `enter_session`
6. [ ] **多账号**（若有）：两 `open_kfid` → 两 Agent
7. [ ] **Control Tools 转人工**：state=3（§5.2）
8. [ ] **icsEnabled=false**：确认 §6.1
9. [ ] **（可选）icsEnabled=true**：§6.2 REST 读写
10. [ ] **transcript 卫生**：§5.6
11. [ ] **回归**：`pnpm test` ≥120 passed
12. [ ] **grep 日志**：无未处理 exception

---

## 10. 快速交叉引用

| 主题 | 文档 |
|------|------|
| Phase 任务状态 | [OpenClaw-WeCom-KF-Roadmap.md](./OpenClaw-WeCom-KF-Roadmap.md) |
| 事件矩阵 / origin | [OpenClaw-WeCom-KF-Master-Architecture.md §5](./OpenClaw-WeCom-KF-Master-Architecture.md) |
| Control Tools 设计 | [OpenClaw-WeCom-KF-Tools-Architecture.md](./OpenClaw-WeCom-KF-Tools-Architecture.md) |
| 插件 README | `extensions/wecom-kf/README.md` |
| wecom 客户联系（非 KF） | [OpenClaw-WeCom-Integration-Checklist.md](../wecom/OpenClaw-WeCom-Integration-Checklist.md) |
| Preflight Skill | `extensions/wecom-kf/skills/wecom-kf-preflight/SKILL.md` |

---

**最后更新**：与 `@partme.ai/wecom-kf` Phase 3 文档同步（2026-05-24）。标注 **实施中** 的条目在代码合并后改为可勾选验收项。
