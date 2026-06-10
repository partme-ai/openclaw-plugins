/**
 * @fileoverview OpenClaw Bridge 所识别 IM 渠道的注册表与查询工具。
 *
 * @description
 * **架构角色**：为本插件其它层（上下文预设、能力矩阵、MQ 桥接闸门）提供「渠道是否存在 /
 * 是否官方扩展包 / UI 文案」等只读真相来源。运行时逻辑应优先查表而非魔法字符串。
 *
 * **数据来源语义**：`source=bundled` 表示随宿主分发；`external-official` 需在宿主侧额外安装 npm 包。
 *
 * @module bridge/channels
 */

/**
 * OpenClaw Bridge — 渠道注册表
 *
 * 所有支持的 IM 渠道及其元数据。
 * 分为外部官方插件（需单独安装）和 bundled 插件（随 OpenClaw 内置）。
 */

/**
 * @description 单个渠道的静态描述信息（不涉及运行时连接状态）。
 */
export interface ChannelMeta {
  /** @description OpenClaw / Router 使用的逻辑渠道 ID（与配置文件里的键一致）。 */
  channelId: string;
  /** @description 面向英语的简短标签（控制台/UI）。 */
  label: string;
  /** @description 面向简体中文的渠道名称（控制台/UI）。 */
  labelCN: string;
  /** @description 渠道分发类别：`bundled` 或第三方官方连接器 `external-official`。 */
  source: "external-official" | "bundled";
  /** @description （可选）外部渠道在安装时需对齐的官方 npm 包名。 */
  npmPackage?: string;
  /** @description （可选）上游源代码仓库地址（人机可读溯源）。 */
  repoUrl?: string;
  /** @description `PRESETS` 中与该平台话术模版相对应的预设键（可与 channelId 不同语义但更常为对齐别名）。 */
  contextPreset: ChannelContextPreset;
}

/**
 * @description 渠道上下文预设索引：`PRESETS` 记录与各渠道的系统性 Prompt 片段相关联。
 */
export type ChannelContextPreset =
  | "dingtalk"
  | "lark"
  | "qqbot"
  | "wecom"
  | "discord"
  | "slack"
  | "telegram"
  | "whatsapp"
  | "signal"
  | "line"
  | "matrix"
  | "irc"
  | "msteams"
  | "googlechat"
  | "imessage"
  | "mattermost"
  | "nextcloud-talk"
  | "nostr"
  | "zalo"
  | "twitch"
  | "tlon"
  | "synology-chat";

// ── 所有渠道静态清单 ──

/**
 * @description 全渠道常量数组（顺序为人类阅读习惯分组：**外部官方**先于 **bundled**）。
 *
 * @remarks 条目数为宿主宣传的 Bridge 覆盖范围之数据来源。
 */
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
  { channelId: "wecom", label: "WeCom", labelCN: "企业微信", source: "bundled", contextPreset: "wecom" },
  { channelId: "discord", label: "Discord", labelCN: "Discord", source: "bundled", contextPreset: "discord" },
  { channelId: "slack", label: "Slack", labelCN: "Slack", source: "bundled", contextPreset: "slack" },
  { channelId: "telegram", label: "Telegram", labelCN: "Telegram", source: "bundled", contextPreset: "telegram" },
  { channelId: "whatsapp", label: "WhatsApp", labelCN: "WhatsApp", source: "bundled", contextPreset: "whatsapp" },
  { channelId: "signal", label: "Signal", labelCN: "Signal", source: "bundled", contextPreset: "signal" },
  { channelId: "line", label: "LINE", labelCN: "LINE", source: "bundled", contextPreset: "line" },
  { channelId: "matrix", label: "Matrix", labelCN: "Matrix", source: "bundled", contextPreset: "matrix" },
  { channelId: "irc", label: "IRC", labelCN: "IRC", source: "bundled", contextPreset: "irc" },
  { channelId: "msteams", label: "Microsoft Teams", labelCN: "Teams", source: "bundled", contextPreset: "msteams" },
  { channelId: "googlechat", label: "Google Chat", labelCN: "Google Chat", source: "bundled", contextPreset: "googlechat" },
  { channelId: "imessage", label: "iMessage", labelCN: "iMessage", source: "bundled", contextPreset: "imessage" },
  { channelId: "mattermost", label: "Mattermost", labelCN: "Mattermost", source: "bundled", contextPreset: "mattermost" },
  { channelId: "nextcloud-talk", label: "Nextcloud Talk", labelCN: "Nextcloud Talk", source: "bundled", contextPreset: "nextcloud-talk" },
  { channelId: "nostr", label: "Nostr", labelCN: "Nostr", source: "bundled", contextPreset: "nostr" },
  { channelId: "zalo", label: "Zalo", labelCN: "Zalo", source: "bundled", contextPreset: "zalo" },
  { channelId: "twitch", label: "Twitch", labelCN: "Twitch", source: "bundled", contextPreset: "twitch" },
  { channelId: "tlon", label: "Tlon", labelCN: "Tlon", source: "bundled", contextPreset: "tlon" },
  { channelId: "synology-chat", label: "Synology Chat", labelCN: "Synology Chat", source: "bundled", contextPreset: "synology-chat" },
];

/**
 * @description 线性查找 `channelId` 对应的静态元数据。
 * @param channelId - 宿主上下文中提供的渠道标识。
 * @returns 命中的 `ChannelMeta`；未知渠道返回 `undefined`。
 * @throws 不抛出。
 */
export function getChannelMeta(channelId: string): ChannelMeta | undefined {
  return ALL_CHANNELS.find((c) => c.channelId === channelId);
}

/**
 * @description 列出所有 `source === "external-official"` 的渠道（需额外安装官方 npm 包）。
 * @returns `ChannelMeta[]` 快照（新数组实例）。
 * @throws 不抛出。
 */
export function getExternalChannels(): ChannelMeta[] {
  return ALL_CHANNELS.filter((c) => c.source === "external-official");
}

/**
 * @description 列出所有 `source === "bundled"` 的内置渠道。
 * @returns `ChannelMeta[]` 快照（新数组实例）。
 * @throws 不抛出。
 */
export function getBundledChannels(): ChannelMeta[] {
  return ALL_CHANNELS.filter((c) => c.source === "bundled");
}

export { getChannelCapabilities } from "./capabilities.js";
