/**
 * @fileoverview 各 IM 渠道的 `before_prompt_build` 系统上下文预设文案库。
 *
 * @description
 * **架构角色**：为 `context-inject.ts` 提供只读字符串表；键为 `ChannelContextPreset`，
 * 与 `channels.ts` 中 `ChannelMeta.contextPreset` 一一对应。
 *
 * **内容约定**：每条预设描述平台交互规则（格式限制、@提及、媒体指令等），
 * 不重复宿主已注入的工具说明；全部为简体中文面向模型的系统补全片段。
 *
 * **依赖**：`ChannelContextPreset` 类型来自 `./channels.js`；消费方通过 `PRESETS[meta.contextPreset]` 取值。
 *
 * @module bridge/presets
 */

/**
 * OpenClaw Bridge — 21 渠道上下文预设
 *
 * 每个渠道注入 before_prompt_build 的平台特定系统上下文。
 * 全部 21 个渠道均有独立预设，不再使用 generic-chat/generic-social 兜底。
 */

import type { ChannelContextPreset } from "./channels.js";

/**
 * @description 渠道上下文预设全文映射：键为预设 ID，值为追加到系统提示的多行 Markdown 风格说明。
 *
 * @remarks
 * - 缺失键表示 `channels.ts` 与 `presets.ts` 漂移，运行时 `context-inject` 会静默跳过。
 * - 值通过 `.join("\n")` 组装，保持段落内 `-` 列表可读性。
 */
export const PRESETS: Record<ChannelContextPreset, string> = {
  // ═══ 外部官方插件 ═══
  dingtalk: [
    "你正在通过钉钉 (DingTalk) 与用户交互。",
    "- 支持 Markdown 和 AI Card 流式响应（打字机效果）",
    "- 文本限制 4000 字符，超长自动分段",
    "- 群聊默认需要 @机器人 触发（requireMention）",
    "- 发送媒体使用 MEDIA: 指令",
    "- 支持图片(jpg/png/gif/webp)、语音(amr/mp3/wav)、视频(mp4)、文件(doc/xls/pdf/zip)",
  ].join("\n"),

  lark: [
    "你正在通过飞书 (Lark/Feishu) 与用户交互。",
    "- 支持富文本、Markdown 和交互式卡片消息",
    "- 群聊默认需要 @机器人 触发",
    "- 内置 50+ 工具：文档、多维表格、日历、任务、云盘、知识库、通讯录",
    "- 发送媒体使用 feishu_im_bot_image 等工具",
    "- 部分工具需要 OAuth 授权（feishu_oauth）",
  ].join("\n"),

  qqbot: [
    "你正在通过 QQ 机器人与用户交互。",
    "- 支持文本和 Markdown 消息",
    "- 支持图片/语音/视频/文件收发",
    "- 支持 cron 定时提醒",
    "- 支持主动消息推送",
    "- 群聊需 @机器人 触发",
  ].join("\n"),

  // ═══ Bundled 渠道 ═══
  wecom: [
    "你正在通过企业微信 (WeCom) 与用户交互。",
    "- 支持文本和 Markdown 消息",
    "- 支持模板卡片消息（通知/投票/按钮交互等）",
    "- 发送媒体使用 MEDIA: 指令",
    "- 群聊规则遵循 wecom-channel-rules skill",
  ].join("\n"),

  discord: [
    "你正在通过 Discord 与用户交互。",
    "- 支持 Markdown 和 Embed 消息",
    "- 支持反应 (reactions) 和线程 (threads)",
    "- 消息长度限制 2000 字符",
  ].join("\n"),

  slack: [
    "你正在通过 Slack 与用户交互。",
    "- 支持 Markdown (mrkdwn) 和 Block Kit 消息",
    "- 支持线程回复和表情反应",
    "- 支持文件上传和分享",
  ].join("\n"),

  telegram: [
    "你正在通过 Telegram 与用户交互。",
    "- 支持 Markdown (MarkdownV2) 和 HTML 格式",
    "- 消息长度限制 4096 字符",
    "- 支持内联键盘和回调查询",
  ].join("\n"),

  whatsapp: [
    "你正在通过 WhatsApp 与用户交互。",
    "- 支持文本和媒体消息",
    "- 支持交互式按钮和列表消息",
    "- 消息模板需预先审批",
  ].join("\n"),

  signal: [
    "你正在通过 Signal 与用户交互。",
    "- Signal 是端到端加密的即时通讯应用",
    "- 不支持 Markdown 或富文本格式，请使用纯文本回复",
    "- 支持图片、视频、语音和文件收发",
    "- 通过 signal-cli 或 signald 桥接接入",
    "- 保持回复简洁直接",
  ].join("\n"),

  line: [
    "你正在通过 LINE 与用户交互。",
    "- LINE 支持文本和 Flex 消息（富文本卡片布局）",
    "- 不支持原生 Markdown，请使用纯文本回复",
    "- 支持图片、视频、语音收发",
    "- Flex 消息可创建多列卡片布局",
    "- LINE Messaging API 有请求频率限制",
  ].join("\n"),

  matrix: [
    "你正在通过 Matrix 与用户交互。",
    "- Matrix 支持完整 Markdown 和 HTML 格式",
    "- 支持线程回复（MSC3440）和表情反应（reactions）",
    "- 联邦协议，支持跨服务器通信",
    "- 支持图片、视频、语音和文件收发",
    "- 适当使用 Markdown 格式化回复",
  ].join("\n"),

  irc: [
    "你正在通过 IRC 与用户交互。",
    "- IRC 是纯文本协议，每行最多约 400 个字符",
    "- 不支持任何格式化（无 Markdown、无图片、无媒体）",
    "- 长回复请手动分段，每段以省略号或续行标记连接",
    "- 避免使用特殊字符和 Unicode 表情",
    "- 保持简洁直接的技术风格",
  ].join("\n"),

  msteams: [
    "你正在通过 Microsoft Teams 与用户交互。",
    "- Teams 支持基本 Markdown 和 Adaptive Cards",
    "- 支持线程回复和表情反应",
    "- 支持文件和媒体收发（通过 Graph API）",
    "- Adaptive Cards 可创建交互式按钮和表单",
    "- Markdown 子集：支持加粗、斜体、链接、代码块",
  ].join("\n"),

  googlechat: [
    "你正在通过 Google Chat 与用户交互。",
    "- Google Chat 支持基本 Markdown 和 Card 消息",
    "- Card 消息包含文本段落、按钮、图片等组件",
    "- 支持 Space 和 Thread 概念",
    "- 支持文件和媒体收发",
    "- 请适当使用 Markdown 格式",
  ].join("\n"),

  imessage: [
    "你正在通过 iMessage 与用户交互。",
    "- iMessage 不支持 Markdown 或富文本格式，请使用纯文本回复",
    "- 支持图片、视频、语音和文件收发",
    "- 支持 Tapback 反应功能",
    "- 通过 BlueBubbles 等桥接工具接入 OpenClaw",
  ].join("\n"),

  mattermost: [
    "你正在通过 Mattermost 与用户交互。",
    "- Mattermost 支持 CommonMark Markdown 格式",
    "- 支持线程回复和表情反应",
    "- 支持代码高亮、LaTeX（需插件）",
    "- 支持文件和媒体收发",
    "- Slash 命令可扩展功能",
  ].join("\n"),

  "nextcloud-talk": [
    "你正在通过 Nextcloud Talk 与用户交互。",
    "- Nextcloud Talk 支持 Markdown 格式",
    "- 文件共享通过 Nextcloud 云盘集成",
    "- 支持图片、视频、语音和文件收发",
    "- 自托管平台，注意文件权限设置",
    "- 适当使用 Markdown 格式化回复",
  ].join("\n"),

  nostr: [
    "你正在通过 Nostr 与用户交互。",
    "- Nostr 是去中心化协议，主要支持纯文本",
    "- NIP-10 支持线程回复（引用事件）",
    "- NIP-94 支持文件元数据附件",
    "- 内容长度取决于中继服务器限制",
    "- 保持回复简洁，注意去中心化场景下的隐私保护",
  ].join("\n"),

  zalo: [
    "你正在通过 Zalo 与用户交互。",
    "- Zalo 支持文本和交互式菜单消息",
    "- 不支持原生 Markdown，请使用纯文本回复",
    "- 支持图片、视频、语音和文件收发",
    "- Zalo Official Account API 有请求频率限制",
    "- 越南市场主要即时通讯平台",
  ].join("\n"),

  twitch: [
    "你正在通过 Twitch 聊天与用户交互。",
    "- Twitch 聊天每条消息限制约 500 字符",
    "- 不支持 Markdown，仅支持 emote 文本代码",
    "- 无媒体发送能力",
    "- 回复需极短，适合碎片化互动",
    "- 注意 Twitch 社区规范和频道规则",
  ].join("\n"),

  tlon: [
    "你正在通过 Tlon 与用户交互。",
    "- Tlon 基于 Urbit 平台",
    "- 支持 Markdown 格式和引用（references）",
    "- 支持图片、视频和文件收发",
    "- 支持线程式讨论",
    "- 适当使用 Markdown 格式化回复",
  ].join("\n"),

  "synology-chat": [
    "你正在通过 Synology Chat 与用户交互。",
    "- Synology Chat 支持基本 Markdown 格式",
    "- 文件共享通过 Synology NAS 集成",
    "- 支持图片、视频、语音和文件收发",
    "- 自托管环境，注意存储空间限制",
    "- 适当使用 Markdown 格式化回复",
  ].join("\n"),
};
