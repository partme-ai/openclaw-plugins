/**
 * OpenClaw Bridge — 渠道注册表
 *
 * 所有支持的 IM 渠道及其元数据。
 * 分为外部官方插件（需单独安装）和 bundled 插件（随 OpenClaw 内置）。
 */

export interface ChannelMeta {
  /** OpenClaw 渠道 ID */
  channelId: string;
  /** 平台名称 */
  label: string;
  /** 平台名称（中文） */
  labelCN: string;
  /** 来源 */
  source: "external-official" | "bundled";
  /** 官方 npm 包（外部渠道需要手动安装） */
  npmPackage?: string;
  /** 官方 GitHub 仓库 */
  repoUrl?: string;
  /** 上下文预设 key */
  contextPreset: ChannelContextPreset;
}

export type ChannelContextPreset =
  | "dingtalk"
  | "lark"
  | "qqbot"
  | "wecom"
  | "discord"
  | "slack"
  | "telegram"
  | "whatsapp"
  | "generic-chat"
  | "generic-social";

// ── 所有 21 个渠道注册表 ──

export const ALL_CHANNELS: ChannelMeta[] = [
  // ═══ 外部官方插件（需手动安装） ═══
  {
    channelId: "dingtalk-connector",
    label: "DingTalk",
    labelCN: "钉钉",
    source: "external-official",
    npmPackage: "@dingtalk-real-ai/dingtalk-connector",
    repoUrl: "https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector",
    contextPreset: "dingtalk",
  },
  {
    channelId: "openclaw-lark",
    label: "Feishu/Lark",
    labelCN: "飞书",
    source: "external-official",
    npmPackage: "@larksuite/openclaw-lark",
    repoUrl: "https://github.com/larksuite/openclaw-lark",
    contextPreset: "lark",
  },
  {
    channelId: "qqbot",
    label: "QQ Bot",
    labelCN: "QQ",
    source: "external-official",
    npmPackage: "@tencent-connect/openclaw-qqbot",
    repoUrl: "https://github.com/tencent-connect/openclaw-qqbot",
    contextPreset: "qqbot",
  },

  // ═══ Bundled 渠道（随 OpenClaw 内置，无需额外安装） ═══
  { channelId: "discord", label: "Discord", labelCN: "Discord", source: "bundled", contextPreset: "discord" },
  { channelId: "slack", label: "Slack", labelCN: "Slack", source: "bundled", contextPreset: "slack" },
  { channelId: "telegram", label: "Telegram", labelCN: "Telegram", source: "bundled", contextPreset: "telegram" },
  { channelId: "whatsapp", label: "WhatsApp", labelCN: "WhatsApp", source: "bundled", contextPreset: "whatsapp" },
  { channelId: "signal", label: "Signal", labelCN: "Signal", source: "bundled", contextPreset: "generic-chat" },
  { channelId: "line", label: "LINE", labelCN: "LINE", source: "bundled", contextPreset: "generic-chat" },
  { channelId: "matrix", label: "Matrix", labelCN: "Matrix", source: "bundled", contextPreset: "generic-chat" },
  { channelId: "irc", label: "IRC", labelCN: "IRC", source: "bundled", contextPreset: "generic-social" },
  { channelId: "msteams", label: "Microsoft Teams", labelCN: "Teams", source: "bundled", contextPreset: "generic-chat" },
  { channelId: "googlechat", label: "Google Chat", labelCN: "Google Chat", source: "bundled", contextPreset: "generic-chat" },
  { channelId: "imessage", label: "iMessage", labelCN: "iMessage", source: "bundled", contextPreset: "generic-chat" },
  { channelId: "mattermost", label: "Mattermost", labelCN: "Mattermost", source: "bundled", contextPreset: "generic-chat" },
  { channelId: "nextcloud-talk", label: "Nextcloud Talk", labelCN: "Nextcloud Talk", source: "bundled", contextPreset: "generic-chat" },
  { channelId: "nostr", label: "Nostr", labelCN: "Nostr", source: "bundled", contextPreset: "generic-social" },
  { channelId: "zalo", label: "Zalo", labelCN: "Zalo", source: "bundled", contextPreset: "generic-chat" },
  { channelId: "twitch", label: "Twitch", labelCN: "Twitch", source: "bundled", contextPreset: "generic-social" },
  { channelId: "tlon", label: "Tlon", labelCN: "Tlon", source: "bundled", contextPreset: "generic-chat" },
  { channelId: "synology-chat", label: "Synology Chat", labelCN: "Synology Chat", source: "bundled", contextPreset: "generic-chat" },
];

/** 按 channelId 查找渠道元数据 */
export function getChannelMeta(channelId: string): ChannelMeta | undefined {
  return ALL_CHANNELS.find((c) => c.channelId === channelId);
}

/** 获取所有外部官方渠道 */
export function getExternalChannels(): ChannelMeta[] {
  return ALL_CHANNELS.filter((c) => c.source === "external-official");
}

/** 获取所有 bundled 渠道 */
export function getBundledChannels(): ChannelMeta[] {
  return ALL_CHANNELS.filter((c) => c.source === "bundled");
}
