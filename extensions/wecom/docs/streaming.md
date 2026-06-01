# 流式输出配置

仅 **Bot WebSocket** 与 **Bot Webhook** 支持企业微信 `stream` / `replyStream` 流式载体；**Agent 自建应用入站对话不支持 Bot 式流式**，出站以 `sendMessage` 一次性 Markdown / 媒体为主。

## 配置速查

```bash
# 默认模式：状态栏过程 + 最终整包答案（推荐大多数业务 Bot）
openclaw config set channels.wecom.streaming false
openclaw config set channels.wecom.footer.status true
openclaw config set channels.wecom.footer.elapsed true

# 开启流式输出：状态进度 + 答案打字机
openclaw config set channels.wecom.streaming true
openclaw config set channels.wecom.streaming.status true
openclaw config set channels.wecom.streaming.content true

# 仅答案打字机：不刷中间状态行
openclaw config set channels.wecom.streaming true
openclaw config set channels.wecom.streaming.status false
openclaw config set channels.wecom.streaming.content true

# 关闭流式输出
openclaw config set channels.wecom.streaming false

# thinking 占位消息
openclaw config set channels.wecom.sendThinkingMessage true
```

JSON 等价写法：

```json
{
  "channels": {
    "wecom": {
      "streaming": { "status": true, "content": true },
      "footer": { "status": true, "elapsed": true },
      "sendThinkingMessage": true
    }
  }
}
```

## 配置形式

`channels.wecom.streaming` 支持布尔或对象：

| 写法 | 含义 |
|------|------|
| 省略 / `false` | **默认模式**：仅状态栏 + 关流时整包答案 |
| `true` | **流式模式**：中间 status 与 answer block 增量均开启 |
| `{ "status": false, "content": true }` | 仅答案增量，不刷状态行 |
| `{ "enabled": false }` | 显式关闭对象形式下的流式 |

`channels.wecom.footer`：

| 键 | 默认 | 说明 |
|----|------|------|
| `footer.status` | `true` | 是否在气泡中展示状态行 |
| `footer.elapsed` | `false` | 关流时是否附加耗时脚注 |

## 三种模式行为差异

| 能力 | Bot WebSocket | Bot Webhook | Agent |
|------|---------------|-------------|-------|
| 流式载体 | `replyStream` / `replyStreamNonBlocking` | HTTP `msgtype: stream` + `stream_refresh` 轮询 | 无 Bot stream |
| 首帧占位 | `sendThinkingReply` + `streamPlaceholderText` | `resolveWecomStreamPlaceholderText`，默认 `"1"` | 不适用 |
| 状态栏 | `footer.status` 或 `streaming.status` | 同左 | 不适用 |
| 媒体出站 | `aibot_send_msg` 主动发送 | `outbound/reply-deliver.ts` 写入 streamStore | Agent API 上传发送 |
| 关流文案 | `dispatch/finish-thinking.ts` | 同逻辑 + `applyWecomWebhookEmptyContentFallback` | 最终 API 消息 |

## 硬约束与降级

- **纯文本**：`replyStream` 内容不支持 Markdown
- **6 分钟窗口**：流式超过 6 分钟未更新，企微返回 errcode 846608。插件捕获后降级为 `sendMessage`
- **Agent 回复超时**：默认 `network.agentReplyTimeoutMs` = 360000 ms（6 分钟）
- **空白关流**：纯空白 content 无法 `finish=true`；插件用 `emptyReplyText` 兜底

## 推荐配置

**稳定非流式（默认）：**

```json
{ "channels": { "wecom": { "streaming": false, "footer": { "status": true, "elapsed": true } } } }
```

**打字机 + 工具进度：**

```json
{ "channels": { "wecom": { "streaming": true, "footer": { "status": true, "elapsed": true }, "sendThinkingMessage": true } } }
```

**仅状态栏：**

```json
{ "channels": { "wecom": { "streaming": { "status": true, "content": false } } } }
```
