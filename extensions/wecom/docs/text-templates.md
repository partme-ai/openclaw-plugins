# 用户可见文案模板

所有 `*Text` 字段平铺在 `channels.wecom`（或账号级覆盖），由 `config/text-config.ts` 映射到内部模板，默认值见 `config/templates.ts` 的 `WECOM_DEFAULT_TEMPLATES`。阶段分类常量见 `config/text-stages.ts`。

## 阶段说明

| 阶段 | 何时展示 | 文案长度建议 | 说明 |
|------|----------|--------------|------|
| **welcome** | enter_chat / subscribe | 可较长 | 一次性欢迎，不属于流式 typing |
| **protocol** | Bot 流式首帧 `finish=false` | 极短（如 `"1"`） | `streamPlaceholderText`，占住协议通道，非状态栏 |
| **typing** | 处理过程中 `finish=false` | **宜短**（emoji + 短句，约 ≤24 字） | 状态栏/排队提示，会频繁刷新 |
| **failed** | 关流 `finish=true` 或等价最终兜底 | 可较长 | 超时、dispatch 失败、空回复、媒体错误等；**不要**用于中间状态 |
| **finalSuccess** | 成功关流时的最终提示 | 中等 | 卡片已发、媒体已投递、会话重置等；**不是** failed |

`emptyReplyText` 属于 **failed**：仅在 Agent 未产出可展示正文、关流时需要兜底时使用，**不会**作为 typing 状态栏文案。

## welcome 与 protocol

| 配置键 | 内部键 | 默认文案 | 典型使用场景 |
|--------|--------|----------|--------------|
| `welcomeText` | welcome | （空） | enter_chat / subscribe 欢迎语 |
| `streamPlaceholderText` | — | 见下方说明 | Bot 流式**协议首帧**占位，非欢迎语、非 thinking 状态栏 |

## typing（`finish=false` 状态栏）

宜短、轻量，适合频繁更新（如 `🤔 正在思考…`）。在 WS 上通过 `statusLine` + `finish=false` 推送；Webhook 合并排队占位亦使用此类文案。

| 配置键 | 内部键 | 默认文案 | 典型使用场景 |
|--------|--------|----------|--------------|
| `thinkingText` | thinking | 🤔 正在思考… | Agent 开始推理 |
| `receivedText` | received | 📩 已收到… | WS：policy 通过后、Agent 开始前 |
| `toolStatusText` | tool | 🧩 正在调用 {toolName}… | 工具调用中（可含 `{toolName}`） |
| `readingText` | reading | 📎 正在阅读附件… | 阅读入站附件 |
| `generatingText` | generating | ✍️ 正在输入… | 生成答案 block |
| `compactionText` | compaction | 📦 正在压缩… | 上下文压缩 |
| `queuedText` | queued | ⏳ 排队中… | 同会话排队（WS 状态栏 / Webhook 占位） |
| `mergedQueuedText` | mergedQueued | ⏳ 已合并排队… | 合并排队回执 |

## failed（最终兜底 / 错误，仅关流阶段）

长文案仅在此阶段有意义；dispatch 超时/失败时写入 `dispatchErrorSummary`，由 `resolveThinkingFinishText` / `applyWecomWebhookStreamFinishContent` 在 **关流前** 合成最终 content，不在 typing 中间帧刷屏。

| 配置键 | 内部键 | 默认文案 | 典型使用场景 |
|--------|--------|----------|--------------|
| `emptyReplyText` | emptyReply | ⚠️ 未能生成可展示的回复… | **最终**空回复兜底（无正文关流） |
| `timeoutText` | timeout | ⚠️ 处理超时（约 {minutes} 分钟）… | Agent 回复超时（默认 6 分钟） |
| `dispatchErrorText` | dispatchError | ⚠️ 回复生成失败（{kind}）：{detail} | OpenClaw dispatch 错误 |
| `mediaParseFailedText` | mediaParseFailed | ⚠️ 未能解析该媒体…{emptyReply} | 入站媒体解析失败（关流时注入 `{emptyReply}`） |
| `mediaErrorNoAccessText` | mediaErrorNoAccess | ⚠️ 文件发送失败：没有权限访问路径 {mediaUrl}… | 本地路径不在 `mediaLocalRoots` |
| `mediaErrorReasonText` | mediaErrorReason | ⚠️ 文件发送失败：{reason} | 媒体发送被拒 |
| `mediaErrorGenericText` | mediaErrorGeneric | ⚠️ 文件发送失败：无法处理文件 {mediaUrl}… | 其他媒体错误 |

## finalSuccess（成功关流提示，非 typing、非 failed）

| 配置键 | 内部键 | 默认文案 | 典型使用场景 |
|--------|--------|----------|--------------|
| `finishFooterText` | finishFooter | ⏱ {elapsed}s · 已完成 | 关流耗时脚注（附加在正文后） |
| `cardSentText` | cardSent | 📋 卡片消息已发送。 | 模板卡片已投递 |
| `mediaSentText` | mediaSent | 📎 文件已发送，请查收。 | 媒体发送成功（finish 帧） |
| `mediaDeliveredText` | mediaDelivered | ✅ 文件已发送。 | Webhook 关流前媒体已单独投递 |
| `processedCompleteText` | processedComplete | ✅ 已处理完成。 | Webhook 空 content 成功关流兜底 |
| `mergedDoneText` | mergedDone | ✅ 已合并处理完成，请查看上一条回复。 | 合并处理完成（`finish=true`） |
| `sessionResetText` | sessionReset | ✅ 已重置会话。 | `/reset` 等会话重置命令 |
| `sessionNewText` | sessionNew | ✅ 已开启新会话。 | `/new` 新会话命令 |

## 占位符

下列占位符由 `formatWecomTemplate` / message-sdk 在运行时替换；未列出的 `*Text` 键为**静态文案**（不含 `{…}`）。

| 占位符 | 适用配置键 | 含义 |
|--------|------------|------|
| `{toolName}` | `toolStatusText` | 当前工具名；模板含此占位符且传入工具名时替换，否则使用整段静态文案 |
| `{elapsed}` | `finishFooterText` | 关流耗时秒数（至少 1s，见 `formatWecomElapsedFooter`） |
| `{minutes}` | `timeoutText` | Agent 回复超时阈值分钟数（`timeoutMs / 60000` 取整） |
| `{kind}` | `dispatchErrorText` | OpenClaw dispatch 错误类别标识 |
| `{detail}` | `dispatchErrorText` | 截断后的错误详情（默认最长 200 字符） |
| `{emptyReply}` | `mediaParseFailedText` | 运行时注入已解析的 `emptyReplyText` 全文 |
| `{mediaUrl}` | `mediaErrorNoAccessText`、`mediaErrorGenericText` | 媒体本地路径或 URL |
| `{reason}` | `mediaErrorReasonText` | 媒体发送被拒原因（`rejectReason` 或 `error`） |

## 完整示例（全部 25 个 `*Text` 键）

JSON 不支持注释；下方按职责分组排列：**欢迎与流式协议** → **状态栏** → **关流与兜底** → **卡片/媒体** → **错误** → **排队与会话命令**。可按需删除未使用的键，未配置项使用 `WECOM_DEFAULT_TEMPLATES` 默认值。

```json
{
  "channels": {
    "wecom": {
      "welcomeText": "您好！我是智能助手，发送消息即可开始对话。",
      "streamPlaceholderText": "1",
      "thinkingText": "🤔 正在思考…",
      "receivedText": "📩 已收到…",
      "toolStatusText": "🧩 正在调用 {toolName}…",
      "readingText": "📎 正在阅读附件…",
      "generatingText": "✍️ 正在输入…",
      "compactionText": "📦 正在压缩…",
      "emptyReplyText": "⚠️ 未能生成可展示的回复，请稍后重试或发送文字消息。",
      "finishFooterText": "⏱ {elapsed}s · 已完成",
      "cardSentText": "📋 卡片消息已发送。",
      "mediaSentText": "📎 文件已发送，请查收。",
      "mediaParseFailedText": "⚠️ 未能解析该媒体并生成回复。{emptyReply}",
      "mediaDeliveredText": "✅ 文件已发送。",
      "processedCompleteText": "✅ 已处理完成。",
      "timeoutText": "⚠️ 处理超时（约 {minutes} 分钟），请稍后重试或发送文字消息。",
      "dispatchErrorText": "⚠️ 回复生成失败（{kind}）：{detail}",
      "mediaErrorNoAccessText": "⚠️ 文件发送失败：没有权限访问路径 {mediaUrl}\n请在 openclaw.json 的 mediaLocalRoots 中添加该路径的父目录后重启生效。",
      "mediaErrorReasonText": "⚠️ 文件发送失败：{reason}",
      "mediaErrorGenericText": "⚠️ 文件发送失败：无法处理文件 {mediaUrl}，请稍后再试。",
      "queuedText": "⏳ 排队中…",
      "mergedQueuedText": "⏳ 已合并排队…",
      "mergedDoneText": "✅ 已合并处理完成，请查看上一条回复。",
      "sessionResetText": "✅ 已重置会话。",
      "sessionNewText": "✅ 已开启新会话。"
    }
  }
}
```

## 逐项命令设置

全局默认文案使用 `channels.wecom.<key>`。多账号场景下，账号级覆盖可将前缀替换为 `channels.wecom.accounts.<accountId>.<key>`，例如 `channels.wecom.accounts.cs-assistant.thinkingText`。自建应用当前仅支持独立覆盖欢迎语：`channels.wecom.agent.welcomeText`；其他运行中文案仍使用全局或账号级平铺 `*Text` 字段。

下面命令可直接复制执行；包含 `{toolName}`、`{elapsed}`、`{minutes}`、`{kind}`、`{detail}`、`{mediaUrl}`、`{reason}`、`{emptyReply}` 的占位符需要原样保留，由运行时替换。以下命令按五类阶段分组：**welcome**（欢迎）、**protocol**（流式协议占位）、**typing**（处理中状态栏）、**failed**（关流兜底/错误）、**finalSuccess**（成功关流提示）。

```bash
# welcome（进入会话/订阅欢迎）
openclaw config set channels.wecom.welcomeText "您好！我是智能助手，发送消息即可开始对话。"

# protocol（Bot 流式协议首帧占位，finish=false）
openclaw config set channels.wecom.streamPlaceholderText "1"

# typing（finish=false 期间的状态栏/占位）
openclaw config set channels.wecom.thinkingText "🤔 正在思考…"
openclaw config set channels.wecom.receivedText "📩 已收到…"
openclaw config set channels.wecom.toolStatusText "🧩 正在调用 {toolName}…"
openclaw config set channels.wecom.readingText "📎 正在阅读附件…"
openclaw config set channels.wecom.generatingText "✍️ 正在输入…"
openclaw config set channels.wecom.compactionText "📦 正在压缩…"
openclaw config set channels.wecom.queuedText "⏳ 排队中…"
openclaw config set channels.wecom.mergedQueuedText "⏳ 已合并排队…"

# failed（最终兜底 / 错误，仅关流阶段）
openclaw config set channels.wecom.emptyReplyText "⚠️ 未能生成可展示的回复，请稍后重试或发送文字消息。"
openclaw config set channels.wecom.timeoutText "⚠️ 处理超时（约 {minutes} 分钟），请稍后重试或发送文字消息。"
openclaw config set channels.wecom.dispatchErrorText "⚠️ 回复生成失败（{kind}）：{detail}"
openclaw config set channels.wecom.mediaErrorNoAccessText $'⚠️ 文件发送失败：没有权限访问路径 {mediaUrl}\n请在 openclaw.json 的 mediaLocalRoots 中添加该路径的父目录后重启生效。'
openclaw config set channels.wecom.mediaErrorReasonText "⚠️ 文件发送失败：{reason}"
openclaw config set channels.wecom.mediaErrorGenericText "⚠️ 文件发送失败：无法处理文件 {mediaUrl}，请稍后再试。"
openclaw config set channels.wecom.mediaParseFailedText "⚠️ 未能解析该媒体并生成回复。{emptyReply}"

# finalSuccess（成功关流时的最终提示）
openclaw config set channels.wecom.finishFooterText "⏱ {elapsed}s · 已完成"
openclaw config set channels.wecom.cardSentText "📋 卡片消息已发送。"
openclaw config set channels.wecom.mediaSentText "📎 文件已发送，请查收。"
openclaw config set channels.wecom.mediaDeliveredText "✅ 文件已发送。"
openclaw config set channels.wecom.processedCompleteText "✅ 已处理完成。"
openclaw config set channels.wecom.mergedDoneText "✅ 已合并处理完成，请查看上一条回复。"
openclaw config set channels.wecom.sessionResetText "✅ 已重置会话。"
openclaw config set channels.wecom.sessionNewText "✅ 已开启新会话。"

openclaw gateway restart
```

`mediaErrorNoAccessText` 含换行，zsh/bash 推荐使用上面的 ANSI-C quoting（`$'...\n...'`）。如果你的 shell 不支持该写法，请改用 JSON/文件方式写入配置，避免把 `\n` 写成普通文本。

自建应用欢迎语可单独覆盖：

```bash
openclaw config set channels.wecom.agent.welcomeText "欢迎使用自建应用，我会尽快回复您。"
```
