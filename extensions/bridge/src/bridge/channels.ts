/**
 * @fileoverview OpenClaw Bridge 所识别 IM 渠道的注册表与查询工具。
 *
 * @description
 * **架构角色**：为本插件其它层（上下文预设、能力矩阵、MQ 桥接闸门）提供「渠道是否存在 /
 * 是否官方扩展包 / UI 文案」等只读真相来源。运行时逻辑应优先查表而非魔法字符串。
 *
 * **数据来源语义**：区分 OpenClaw 2026.9.6 bundled、当前仓库插件与外部连接器。
 *
 * @module bridge/channels
 */

/**
 * OpenClaw Bridge — 渠道注册表
 *
 * 所有可被 Bridge 识别的来源渠道及其元数据。
 * 分为外部连接器、OpenClaw stock 渠道和当前仓库渠道；静态存在只代表配置与预设可识别，
 * 不代表插件已经安装、运行或完成真实环境验收。
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
  /** @description 渠道来源：OpenClaw stock、当前仓库或外部连接器。 */
  source: "external" | "openclaw-stock" | "repository";
  /** @description （可选）外部渠道在安装时需对齐的官方 npm 包名。 */
  npmPackage?: string;
  /** @description 宿主插件 ID 与消息渠道 ID 不同时使用。 */
  hostPluginId?: string;
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
  | "synology-chat"
  | "wechat"
  | "wechat-ipad"
  | "wecom-kf"
  | "douyin"
  | "mqtt";

// ── 所有渠道静态清单 ──

/**
 * @description 全渠道常量数组（先列外部/重点入口，再列仓库扩展与 OpenClaw stock 渠道）。
 *
 * @remarks 条目数为宿主宣传的 Bridge 覆盖范围之数据来源。
 */
export const ALL_CHANNELS: ChannelMeta[] = [
  // ═══ 外部连接器与 OpenClaw stock 的重点入口 ═══
  {
    channelId: "dingtalk-connector",
    label: "DingTalk",
    labelCN: "钉钉",
    source: "external",
    npmPackage: "@dingtalk-real-ai/dingtalk-connector",
    repoUrl: "https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector",
    contextPreset: "dingtalk",
  },
  {
    channelId: "feishu",
    label: "Feishu/Lark",
    labelCN: "飞书",
    source: "openclaw-stock",
    contextPreset: "lark",
  },
  {
    channelId: "qqbot",
    label: "QQ Bot",
    labelCN: "QQ",
    source: "external",
    npmPackage: "@tencent-connect/openclaw-qqbot",
    hostPluginId: "openclaw-qqbot",
    repoUrl: "https://github.com/tencent-connect/openclaw-qqbot",
    contextPreset: "qqbot",
  },

  // ═══ 当前仓库渠道与其余 OpenClaw stock 渠道 ═══
  { channelId: "wecom", label: "WeCom", labelCN: "企业微信", source: "repository", npmPackage: "@partme.ai/wecom", repoUrl: "https://github.com/partme-ai/openclaw-plugins", contextPreset: "wecom" },
  { channelId: "openclaw-weixin", label: "WeChat", labelCN: "微信", source: "repository", npmPackage: "@partme.ai/weixin", repoUrl: "https://github.com/partme-ai/openclaw-plugins", contextPreset: "wechat" },
  { channelId: "wechat-ipad", label: "WeChat iPad Bridge", labelCN: "微信 iPad 外部桥接", source: "repository", npmPackage: "@partme.ai/wechat-ipad", repoUrl: "https://github.com/partme-ai/openclaw-plugins", contextPreset: "wechat-ipad" },
  { channelId: "wecom-kf", label: "WeCom Customer Service", labelCN: "微信客服", source: "repository", npmPackage: "@partme.ai/wecom-kf", repoUrl: "https://github.com/partme-ai/openclaw-plugins", contextPreset: "wecom-kf" },
  { channelId: "douyin", label: "Douyin", labelCN: "抖音", source: "repository", npmPackage: "@partme.ai/openclaw-douyin", repoUrl: "https://github.com/partme-ai/openclaw-plugins", contextPreset: "douyin" },
  { channelId: "mqtt", label: "MQTT", labelCN: "MQTT 消息通道", source: "repository", npmPackage: "@partme.ai/openclaw-mqtt", repoUrl: "https://github.com/partme-ai/openclaw-plugins", contextPreset: "mqtt" },
  { channelId: "discord", label: "Discord", labelCN: "Discord", source: "openclaw-stock", contextPreset: "discord" },
  { channelId: "slack", label: "Slack", labelCN: "Slack", source: "openclaw-stock", contextPreset: "slack" },
  { channelId: "telegram", label: "Telegram", labelCN: "Telegram", source: "openclaw-stock", contextPreset: "telegram" },
  { channelId: "whatsapp", label: "WhatsApp", labelCN: "WhatsApp", source: "openclaw-stock", contextPreset: "whatsapp" },
  { channelId: "signal", label: "Signal", labelCN: "Signal", source: "openclaw-stock", contextPreset: "signal" },
  { channelId: "line", label: "LINE", labelCN: "LINE", source: "openclaw-stock", contextPreset: "line" },
  { channelId: "matrix", label: "Matrix", labelCN: "Matrix", source: "openclaw-stock", contextPreset: "matrix" },
  { channelId: "irc", label: "IRC", labelCN: "IRC", source: "openclaw-stock", contextPreset: "irc" },
  { channelId: "msteams", label: "Microsoft Teams", labelCN: "Teams", source: "openclaw-stock", contextPreset: "msteams" },
  { channelId: "googlechat", label: "Google Chat", labelCN: "Google Chat", source: "openclaw-stock", contextPreset: "googlechat" },
  { channelId: "imessage", label: "iMessage", labelCN: "iMessage", source: "openclaw-stock", contextPreset: "imessage" },
  { channelId: "mattermost", label: "Mattermost", labelCN: "Mattermost", source: "openclaw-stock", contextPreset: "mattermost" },
  { channelId: "nextcloud-talk", label: "Nextcloud Talk", labelCN: "Nextcloud Talk", source: "openclaw-stock", contextPreset: "nextcloud-talk" },
  { channelId: "nostr", label: "Nostr", labelCN: "Nostr", source: "openclaw-stock", contextPreset: "nostr" },
  { channelId: "zalo", label: "Zalo", labelCN: "Zalo", source: "openclaw-stock", contextPreset: "zalo" },
  { channelId: "twitch", label: "Twitch", labelCN: "Twitch", source: "openclaw-stock", contextPreset: "twitch" },
  { channelId: "tlon", label: "Tlon", labelCN: "Tlon", source: "openclaw-stock", contextPreset: "tlon" },
  { channelId: "synology-chat", label: "Synology Chat", labelCN: "Synology Chat", source: "openclaw-stock", contextPreset: "synology-chat" },
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
 * @description 列出所有非 OpenClaw stock 渠道（需额外安装插件）。
 * @returns `ChannelMeta[]` 快照（新数组实例）。
 * @throws 不抛出。
 */
export function getExternalChannels(): ChannelMeta[] {
  return ALL_CHANNELS.filter((c) => c.source !== "openclaw-stock");
}

/**
 * @description 列出 OpenClaw 2026.9.6 bundled 渠道。
 * @returns `ChannelMeta[]` 快照（新数组实例）。
 * @throws 不抛出。
 */
export function getBundledChannels(): ChannelMeta[] {
  return ALL_CHANNELS.filter((c) => c.source === "openclaw-stock");
}

/** 宿主显式提供的三项事实。缺失值表示 unknown，不能从目录或 Bridge 配置推断。 */
export interface ChannelRuntimeFacts {
  installed?: boolean;
  enabled?: boolean;
  ready?: boolean;
}

/** 将静态识别和宿主事实分开解析；unavailableFacts 仅列未知事实。 */
export function resolveChannelAvailability(meta: ChannelMeta | undefined, runtimeFacts?: ChannelRuntimeFacts): {
  known: boolean;
  installed: boolean;
  enabled: boolean;
  ready: boolean;
  unavailableFacts?: string[];
} {
  if (!meta || !getChannelMeta(meta.channelId)) {
    return { known: false, installed: false, enabled: false, ready: false };
  }
  const unavailableFacts = (["installed", "enabled", "ready"] as const)
    .filter((key) => typeof runtimeFacts?.[key] !== "boolean");
  return {
    known: true,
    installed: runtimeFacts?.installed === true,
    enabled: runtimeFacts?.installed === true && runtimeFacts.enabled === true,
    ready: runtimeFacts?.installed === true && runtimeFacts.enabled === true && runtimeFacts.ready === true,
    ...(unavailableFacts.length > 0 ? { unavailableFacts } : {}),
  };
}

/**
 * 消费已获 operator.read 授权的 OpenClaw 2026.9.6 plugins.list/channels.status 响应。
 * Bridge 本身不查询 Gateway；宿主必须按同一 Gateway 实例提供两个快照。
 * 来源：OpenClaw src/gateway/server-methods/plugins.ts#plugins.list、channels.ts#channels.status。
 */
export function adaptGatewayChannelFacts(
  meta: ChannelMeta,
  pluginsList: { partial?: boolean; plugins?: Array<{ id?: string; installed?: boolean; enabled?: boolean; runtime?: { state?: string } }> } | undefined,
  channelsStatus: { partial?: boolean; channelAccounts?: Record<string, Array<{
    enabled?: boolean; configured?: boolean; running?: boolean; connected?: boolean;
    lifecycle?: string; lastError?: string | null;
  }>> } | undefined,
): ChannelRuntimeFacts {
  const canonical = getChannelMeta(meta.channelId);
  if (!canonical) return {};
  if (pluginsList?.partial === true) return {};
  const plugin = pluginsList?.plugins?.find((entry) => entry.id === (canonical.hostPluginId ?? canonical.channelId));
  const accountRows = channelsStatus?.partial === true ? undefined : channelsStatus?.channelAccounts?.[canonical.channelId];
  const facts: ChannelRuntimeFacts = {};
  if (typeof plugin?.installed === "boolean") facts.installed = plugin.installed;
  if (typeof plugin?.enabled === "boolean") facts.enabled = plugin.enabled;
  if (plugin?.runtime?.state === "disabled") facts.enabled = false;
  if (Array.isArray(accountRows) && accountRows.length > 0) {
    if (accountRows.every((account) => account.enabled === false)) facts.enabled = false;
    const activeRows = accountRows.filter((account) => account.enabled === true);
    if (activeRows.length > 0) {
      // MQTT is an inbound listener: running is its published transport fact.
      // Other channels need explicit connected or ready lifecycle evidence.
      const states = activeRows.map((account) => {
        if (account.configured === false || account.running === false || account.connected === false ||
          account.lifecycle === "blocked" || account.lifecycle === "stopped" || account.lastError) return false;
        if (account.running === true && (account.connected === true || account.lifecycle === "ready" || canonical.channelId === "mqtt")) return true;
        return undefined;
      });
      if (states.includes(true)) facts.ready = true;
      else if (states.every((state) => state === false)) facts.ready = false;
    } else if (accountRows.every((account) => account.enabled === false)) facts.ready = false;
  }
  if (plugin?.runtime?.state === "service-failed" || plugin?.runtime?.state === "disabled" || plugin?.runtime?.state === "unloaded") facts.ready = false;
  return facts;
}

export { getChannelCapabilities } from "./capabilities.js";
