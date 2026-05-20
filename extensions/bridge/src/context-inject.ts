/**
 * OpenClaw Bridge — 上下文注入
 *
 * 根据渠道预设 key 注入对应的系统上下文。
 * 渠道自带工具的不需要重复注入工具说明，只注入平台交互规则。
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { getChannelMeta, type ChannelContextPreset } from "./channels.js";

// ── 预设上下文模板 ──

const PRESETS: Record<ChannelContextPreset, string> = {
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

  "generic-chat": [
    "你正在通过即时通讯平台与用户交互。",
    "- 保持回复简洁、友好",
    "- 适当使用 Markdown 格式",
    "- 遵守该平台的社区规范",
  ].join("\n"),

  "generic-social": [
    "你正在通过社交平台与用户交互。",
    "- 保持轻松、互动的语调",
    "- 适应平台的交流风格",
    "- 注意内容安全和合规性",
  ].join("\n"),
};

// ── 注册 ──

interface ChannelCfg {
  enabled?: boolean;
  contextInjection?: boolean;
}

interface BridgeConfig {
  channels?: Record<string, ChannelCfg>;
}

export function registerContextInjection(api: OpenClawPluginApi): void {
  const cfg = (api.pluginConfig ?? {}) as BridgeConfig;

  api.on("before_prompt_build", (_event, ctx) => {
    const channelId = ctx?.channelId;
    if (!channelId) return;

    // 检查是否有此渠道的配置
    const channelCfg = cfg.channels?.[channelId];
    if (!channelCfg || channelCfg.enabled === false) return;
    if (channelCfg.contextInjection === false) return;

    const meta = getChannelMeta(channelId);
    // 只对已知渠道注入上下文
    if (!meta) return;

    const preset = PRESETS[meta.contextPreset];
    if (!preset) return;

    return { appendSystemContext: preset };
  });

  api.logger.info("[openclaw-bridge] Context injection registered");
}
