# 企业微信（WeCom）联调与测试指南

本文档记录 `@partme.ai/wecom` 在本地 OpenClaw Gateway 上的**手工联调步骤**，重点说明已验证的**主动发消息**方法。单元测试见插件目录 `pnpm test`。

相关文档：[配置指南](./OpenClaw-WeCom-Configuration.md)

## 前置条件

| 项 | 说明 |
|----|------|
| OpenClaw | Gateway 已启动，例如 `openclaw gateway restart` |
| 插件 | `@partme.ai/wecom` 已安装并启用 |
| Bot 凭据 | 至少一个账号配置了 `botId` + `secret`，WebSocket 认证成功 |
| 测试用户 | 已知企微 **userid**（如 `WanDaLong`），且已向 Bot 发过私聊（建立会话） |
| CLI 权限 | 主动发消息需要 CLI 设备具备 `operator.write`（见下文「CLI 设备授权」） |

检查通道状态：

```bash
openclaw channels list
openclaw channels status --probe
```

日志路径（默认）：`/tmp/openclaw/openclaw-YYYY-MM-DD.log`

## 单元测试

在 monorepo 插件目录执行：

```bash
cd openclaw-plugins/extensions/wecom
pnpm test
pnpm typecheck
```

流式相关单元测试覆盖：`streaming-config.test.ts`（气泡合成、enter_chat 欢迎语解析、Webhook 空内容兜底）、`finish-thinking.test.ts`。

手工验证（可选）：

- **enter_chat 欢迎语**：配置 `channels.wecom.welcomeText`，打开 Bot 会话，确认 WS 模式收到欢迎文本。
- **状态栏 / compaction**：长对话触发上下文压缩时，stream 气泡状态行应短暂显示「📦 正在压缩上下文…」。

## 入站测试（用户 → Bot）

1. 在企业微信中向已配置的 Bot 发送私聊，例如：`测试`
2. 观察 Gateway 日志是否出现 `aibot_msg_callback`，且 `from.userid` 为预期用户
3. 确认 Bot 流式/文本回复正常

多 Bot 场景：分别向 **Bot1**、**Bot2** 发消息，日志中应出现对应账号前缀，例如 `[default]`、`[bot2]`。

## 出站测试（OpenClaw → 用户）

Bot 模式下，插件通过 WebSocket 的 `aibot_send_msg` **主动推送**。以下命令均在 Gateway 所在机器执行。

### 方法一：`openclaw message send`（推荐，直接出站）

```bash
# 单 Bot（default 账号）
openclaw message send \
  --channel wecom \
  --account default \
  --target WanDaLong \
  --message "【OpenClaw 主动测试】Bot1 出站消息 ✅"

# 多 Bot 第二个账号
openclaw message send \
  --channel wecom \
  --account bot2 \
  --target WanDaLong \
  --message "【OpenClaw 主动测试】Bot2 出站消息 ✅"
```

**成功标志：** 终端输出 `✅ Sent via gateway (wecom). Message ID: aibot_send_msg_...`，且企微客户端收到消息。

#### 目标格式（`--target`）

| 场景 | 正确示例 | 错误示例 | 说明 |
|------|----------|----------|------|
| Bot WebSocket 主动私聊 | `WanDaLong` | `user:WanDaLong` | Bot 出站走 `wsClient.sendMessage(chatid, …)`，`chatid` 须为**纯 userid**，带 `user:` 前缀会报 **93006 invalid chatid** |
| Cron / Agent HTTP 广播 | `user:zhangsan`、`party:1` | — | Cron 等走 `resolveWecomTarget`，支持显式前缀 |

> 插件 README 中 Cron 的 `user:<id>` 格式适用于 **Agent HTTP / Cron 投递**；**CLI `message send` + Bot WebSocket** 请使用纯 userid。

可选命名空间前缀（解析前会自动剥离）：`wecom:`、`qywx:`、`wework:` 等。

### 方法二：`openclaw agent --deliver`（智能体生成并投递）

由 Agent 生成回复内容，再投递到企微：

```bash
openclaw agent \
  --agent main \
  --message "请向用户发送一条简短的测试消息，说明这是 OpenClaw 智能体主动推送测试，并带上当前时间。" \
  --deliver \
  --reply-channel wecom \
  --reply-account default \
  --reply-to WanDaLong
```

参数说明：

| 参数 | 含义 |
|------|------|
| `--agent main` | 指定 Agent id |
| `--deliver` | 将 Agent 回复发送到通道 |
| `--reply-channel wecom` | 投递通道 |
| `--reply-account default` | 企微账号 id（多 Bot 时改为 `bot2` 等） |
| `--reply-to WanDaLong` | 目标 userid（Bot 出站同样使用纯 userid） |

**成功标志：** 命令结束且无报错，企微收到 Agent 生成的测试文案。

### 方法三：入站触发（被动回复，非主动推送）

用户向 Bot 发消息后，Agent 通过 `response_url` / 流式回复返回。用于验证完整对话链路，不属于「主动推送」。

## 多 Bot 联调清单

1. 配置第二个账号（示例）：

```bash
openclaw config set channels.wecom.accounts.bot2.name "测试机器人2"
openclaw config set channels.wecom.accounts.bot2.botId "<BOT2_ID>"
openclaw config set channels.wecom.accounts.bot2.secret "<BOT2_SECRET>"
openclaw config set channels.wecom.accounts.bot2.enabled true
openclaw gateway restart
```

2. `openclaw channels list` 确认两个账号均为 **configured, enabled**
3. 日志确认 `[default]`、`[bot2]` 均 **Authentication successful**
4. 分别执行「方法一」，`--account default` 与 `--account bot2` 各发一条
5. 用户侧确认两条消息来自不同 Bot

## CLI 设备授权

若出现：

```text
GatewayClientRequestError: scope upgrade pending approval
pairing required: device is asking for more scopes than currently approved
```

表示当前 CLI 设备仅有 `operator.read`，无法调用 `message send` / `agent --deliver`。

处理步骤：

```bash
# 查看待审批请求
openclaw devices list

# 批准最新请求（需已有 pairing 权限的设备或本地 fallback）
openclaw devices approve --latest
```

批准后重试发消息命令。设备与 scope 存储于 `~/.openclaw/devices/`。

## 常见问题

### errcode 93006 — invalid chatid

**现象：** `openclaw message send` 失败，日志 `invalid chatid`。

**原因：** `--target user:WanDaLong` 被原样传给 `aibot_send_msg` 的 `chatid` 字段。

**解决：** 改为 `--target WanDaLong`（纯 userid）。群聊使用群 id，例如 `wrxxxx` 或 `group:wrxxxx`（Cron/Agent 路径）。

### 插件安装安全扫描

本地安装若提示 `child_process` 等安全警告，可使用：

```bash
openclaw plugins install @partme.ai/wecom@latest --dangerously-force-unsafe-install
openclaw gateway restart
```

### 出站与模式说明

| 能力 | Bot WebSocket | Agent HTTP |
|------|:-------------:|:----------:|
| CLI `message send`（已连接 WS） | ✅ | WS 不可用时回退 |
| `agent --deliver` | ✅ | 同上 |
| Cron `--to party:1` 等 | ❌ | ✅ 需配置 Agent |

配置细节见 [OpenClaw-WeCom-Configuration.md](./OpenClaw-WeCom-Configuration.md)。

## 参考命令速查

```bash
# 安装 / 重启
openclaw plugins install @partme.ai/wecom@latest --dangerously-force-unsafe-install
openclaw gateway restart

# 状态
openclaw channels list
openclaw channels status --probe
openclaw plugins doctor

# 主动发消息（Bot WebSocket）
openclaw message send --channel wecom --account default --target <USERID> --message "测试"

# 智能体主动投递
openclaw agent --agent main --message "发测试消息" \
  --deliver --reply-channel wecom --reply-account default --reply-to <USERID>
```
