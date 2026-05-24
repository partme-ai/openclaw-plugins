/**
 * @fileoverview 各 IM 渠道的静态「能力矩阵」：`normalizeForChannel` 与控制面逻辑的参照源。
 *
 * @description
 * **架构角色**：声明每条渠道支持的文本/HTML/Markdown 变体、媒体收发集合、长度上限与溢出策略、
 * 线程/表情/群聊提及约束，以及出站转义方言。此为 **文档化常量数据**：不参与网络探测。
 *
 * **维护约定**：新增渠道时需同步补齐 `channels.ts` 与 `presets.ts`，否则将出现「已知渠道但无能力声明」空洞。
 *
 * @module bridge/capabilities
 */

/**
 * OpenClaw Bridge — 渠道能力声明
 *
 * 每个渠道的消息格式、媒体支持、文本限制、线程、反应等能力元数据。
 * 用于 outbound 消息规范化时查询渠道限制。
 */

/** @description 宿主文本载荷抽象类别（逻辑标注，不等同于 MIME）。 */
export type SupportedFormat = "text" | "markdown" | "html" | "rich-text" | "card";

/** @description Bridge 内部抽象的二进制附件大类（用于 inbound/outbound 能力勾选）。 */
export type MediaKind = "image" | "video" | "audio" | "document" | "sticker";

/** @description Markdown 出站方言：驱动 `normalize.ts` 中的转换管线分支。 */
export type MarkdownDialect = "none" | "basic" | "github" | "markdown-v2" | "mrkdwn" | "commonmark" | "html";

/** @description 超长文本的处理策略：`truncate` 截断、`split` 切段、`error`（预留语义）。 */
export type OverflowStrategy = "truncate" | "split" | "error";

/**
 * @description 单渠道的聚合能力快照（静态推断的工程近似，非实时 API 探测）。
 */
export interface ChannelCapabilities {
  /** @description 与该记录键一致的渠道 ID（便于日志与调试自描述）。 */
  channelId: string;
  /** @description 理论上可承载的内容格式集合（与具体 Bot API 子集可能仍有出入）。 */
  supportedFormats: SupportedFormat[];
  /** @description 媒体：入站/出站允许的 `MediaKind`、单文件大小字节上限。 */
  media: {
    inbound: MediaKind[];
    outbound: MediaKind[];
    maxFileSizeBytes: number;
  };
  /** @description 文本：单条气泡最大字符数建议值与溢出策略枚举。 */
  textLimits: {
    maxPerMessage: number;
    overflowStrategy: OverflowStrategy;
  };
  /** @description `supported` 是否具备线程语义；`firstClass` 是否原生一等线程模型（对比「引用消息」模拟）。 */
  threading: { supported: boolean; firstClass: boolean };
  /** @description 表情反应（emoji reacts）是否常见可用。 */
  reactions: { supported: boolean };
  /** @description 群聊能力及是否强依赖 @提及 才触发机器人。 */
  groupChat: { supported: boolean; requireMention: boolean };
  /** @description Markdown 方言：影响出站转义与裁剪策略。 */
  escaping: { markdownDialect: MarkdownDialect };
  /** @description 非标行为 / 运营提示（给人看的注意事项集合）。 */
  quirks: string[];
}

/** @description 通用「全媒体 excluding sticker」集合复用模板。 */
const MEDIA_FULL: MediaKind[] = ["image", "video", "audio", "document"];

/** @description Telegram 等支持 Stickers 的渠道使用的媒体超集。 */
const MEDIA_FULL_STICKER: MediaKind[] = ["image", "video", "audio", "document", "sticker"];

/** @description 不包含 document 的媒体集合（例：部分 Mobile IM 仅图片/音视频）。 */
const MEDIA_NO_DOC: MediaKind[] = ["image", "video", "audio"];

/** @description 仅限图片与视频（例如去中心化协议侧重轻媒体）。 */
const MEDIA_IMG_VID: MediaKind[] = ["image", "video"];

/** @description 明确不支持任何附件类的渠道占位。 */
const MEDIA_NONE: MediaKind[] = [];

/**
 * @description channelId → `ChannelCapabilities` 的全局只读注册表。
 *
 * @remarks 条目键 **必须** 与宿主路由层看到的 `channelId` 对齐；否则 `getChannelCapabilities` 将返回 `undefined`
 * 并导致规范化模块退化为恒等或默认 Markdown 行为。
 */
export const ALL_CAPABILITIES: Record<string, ChannelCapabilities> = {
  // ═══ 外部官方插件 ═══
  "dingtalk-connector": {
    channelId: "dingtalk-connector",
    supportedFormats: ["text", "markdown", "card"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 20 * 1024 * 1024 },
    textLimits: { maxPerMessage: 4000, overflowStrategy: "split" },
    threading: { supported: false, firstClass: false },
    reactions: { supported: false },
    groupChat: { supported: true, requireMention: true },
    escaping: { markdownDialect: "basic" },
    quirks: ["AI Card streaming supported", "MEDIA: directive for media", "amr/mp3/wav audio only"],
  },
  "openclaw-lark": {
    channelId: "openclaw-lark",
    supportedFormats: ["text", "markdown", "rich-text", "card"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 30 * 1024 * 1024 },
    textLimits: { maxPerMessage: 30000, overflowStrategy: "split" },
    threading: { supported: true, firstClass: true },
    reactions: { supported: true },
    groupChat: { supported: true, requireMention: true },
    escaping: { markdownDialect: "basic" },
    quirks: ["50+ built-in tools (docs,bitable,calendar)", "OAuth required for some tools", "feishu_im_bot_image for media"],
  },
  qqbot: {
    channelId: "qqbot",
    supportedFormats: ["text", "markdown"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 20 * 1024 * 1024 },
    textLimits: { maxPerMessage: 4000, overflowStrategy: "split" },
    threading: { supported: false, firstClass: false },
    reactions: { supported: false },
    groupChat: { supported: true, requireMention: true },
    escaping: { markdownDialect: "basic" },
    quirks: ["cron reminders supported", "proactive messages supported"],
  },

  // ═══ Bundled 渠道 ═══
  wecom: {
    channelId: "wecom",
    supportedFormats: ["text", "markdown", "card"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 20 * 1024 * 1024 },
    textLimits: { maxPerMessage: 2048, overflowStrategy: "split" },
    threading: { supported: false, firstClass: false },
    reactions: { supported: false },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "basic" },
    quirks: ["template card messages", "MEDIA: directive", "group rules via wecom-channel-rules skill"],
  },
  discord: {
    channelId: "discord",
    supportedFormats: ["text", "markdown"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 25 * 1024 * 1024 },
    textLimits: { maxPerMessage: 2000, overflowStrategy: "split" },
    threading: { supported: true, firstClass: true },
    reactions: { supported: true },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "basic" },
    quirks: ["Embed messages", "reactions and threads", "2000 char hard limit"],
  },
  slack: {
    channelId: "slack",
    supportedFormats: ["text", "markdown"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 1024 * 1024 * 1024 },
    textLimits: { maxPerMessage: 40000, overflowStrategy: "split" },
    threading: { supported: true, firstClass: true },
    reactions: { supported: true },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "mrkdwn" },
    quirks: ["Block Kit messages", "file uploads", "mrkdwn is Slack's subset of Markdown"],
  },
  telegram: {
    channelId: "telegram",
    supportedFormats: ["text", "markdown", "html"],
    media: { inbound: MEDIA_FULL_STICKER, outbound: MEDIA_FULL_STICKER, maxFileSizeBytes: 50 * 1024 * 1024 },
    textLimits: { maxPerMessage: 4096, overflowStrategy: "split" },
    threading: { supported: false, firstClass: false },
    reactions: { supported: true },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "markdown-v2" },
    quirks: ["MarkdownV2 and HTML format", "inline keyboards", "callback queries", "4096 char limit"],
  },
  whatsapp: {
    channelId: "whatsapp",
    supportedFormats: ["text"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 100 * 1024 * 1024 },
    textLimits: { maxPerMessage: 65536, overflowStrategy: "split" },
    threading: { supported: false, firstClass: false },
    reactions: { supported: false },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "none" },
    quirks: ["interactive buttons and list messages", "message templates need pre-approval", "WhatsApp Business API required"],
  },
  signal: {
    channelId: "signal",
    supportedFormats: ["text"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 100 * 1024 * 1024 },
    textLimits: { maxPerMessage: 65536, overflowStrategy: "split" },
    threading: { supported: false, firstClass: false },
    reactions: { supported: true },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "none" },
    quirks: ["end-to-end encrypted", "no rich formatting", "basic text only", "signal-cli or signald bridge"],
  },
  line: {
    channelId: "line",
    supportedFormats: ["text"],
    media: { inbound: MEDIA_NO_DOC, outbound: MEDIA_NO_DOC, maxFileSizeBytes: 50 * 1024 * 1024 },
    textLimits: { maxPerMessage: 5000, overflowStrategy: "split" },
    threading: { supported: false, firstClass: false },
    reactions: { supported: false },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "none" },
    quirks: ["Flex messages for rich content", "LINE Messaging API", "no native Markdown", "carousel/stack columns"],
  },
  matrix: {
    channelId: "matrix",
    supportedFormats: ["text", "markdown", "html"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 100 * 1024 * 1024 },
    textLimits: { maxPerMessage: 65536, overflowStrategy: "split" },
    threading: { supported: true, firstClass: true },
    reactions: { supported: true },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "commonmark" },
    quirks: ["Matrix spec supports full Markdown and HTML", "federated protocol", "threading via MSC3440"],
  },
  irc: {
    channelId: "irc",
    supportedFormats: ["text"],
    media: { inbound: MEDIA_NONE, outbound: MEDIA_NONE, maxFileSizeBytes: 0 },
    textLimits: { maxPerMessage: 400, overflowStrategy: "split" },
    threading: { supported: false, firstClass: false },
    reactions: { supported: false },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "none" },
    quirks: ["512 byte line limit (includes IRC protocol overhead)", "no media support", "no formatting", "UTF-8 depends on network"],
  },
  msteams: {
    channelId: "msteams",
    supportedFormats: ["text", "markdown", "html", "card"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 50 * 1024 * 1024 },
    textLimits: { maxPerMessage: 28000, overflowStrategy: "split" },
    threading: { supported: true, firstClass: true },
    reactions: { supported: true },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "basic" },
    quirks: ["Adaptive Cards", "Teams-specific Markdown subset", "threading via replyChainId", "Graph API for files"],
  },
  googlechat: {
    channelId: "googlechat",
    supportedFormats: ["text", "markdown", "card"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 50 * 1024 * 1024 },
    textLimits: { maxPerMessage: 4000, overflowStrategy: "split" },
    threading: { supported: true, firstClass: false },
    reactions: { supported: false },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "basic" },
    quirks: ["Card messages with widgets", "Google Chat API", "space/thread model"],
  },
  imessage: {
    channelId: "imessage",
    supportedFormats: ["text"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 100 * 1024 * 1024 },
    textLimits: { maxPerMessage: 65536, overflowStrategy: "split" },
    threading: { supported: false, firstClass: false },
    reactions: { supported: true },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "none" },
    quirks: ["no formatting support", "BlueBubbles or similar bridge needed", "tapback reactions", "no bot API (requires bridge)"],
  },
  mattermost: {
    channelId: "mattermost",
    supportedFormats: ["text", "markdown", "html"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 50 * 1024 * 1024 },
    textLimits: { maxPerMessage: 16383, overflowStrategy: "split" },
    threading: { supported: true, firstClass: true },
    reactions: { supported: true },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "commonmark" },
    quirks: ["Markdown support via CommonMark", "threaded replies", "slash commands", "open source Slack alternative"],
  },
  "nextcloud-talk": {
    channelId: "nextcloud-talk",
    supportedFormats: ["text", "markdown"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 50 * 1024 * 1024 },
    textLimits: { maxPerMessage: 32000, overflowStrategy: "split" },
    threading: { supported: false, firstClass: false },
    reactions: { supported: true },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "commonmark" },
    quirks: ["Nextcloud Talk API", "self-hosted", "file sharing via Nextcloud"],
  },
  nostr: {
    channelId: "nostr",
    supportedFormats: ["text"],
    media: { inbound: MEDIA_IMG_VID, outbound: MEDIA_IMG_VID, maxFileSizeBytes: 0 },
    textLimits: { maxPerMessage: 65536, overflowStrategy: "split" },
    threading: { supported: true, firstClass: false },
    reactions: { supported: true },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "none" },
    quirks: ["decentralized protocol", "NIP-10 threading", "NIP-94 file metadata", "no server-side limits", "content length varies by relay"],
  },
  zalo: {
    channelId: "zalo",
    supportedFormats: ["text"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 50 * 1024 * 1024 },
    textLimits: { maxPerMessage: 2000, overflowStrategy: "split" },
    threading: { supported: false, firstClass: false },
    reactions: { supported: false },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "none" },
    quirks: ["Zalo Official Account API", "Vietnam market", "interactive menus", "no native Markdown"],
  },
  twitch: {
    channelId: "twitch",
    supportedFormats: ["text"],
    media: { inbound: MEDIA_NONE, outbound: MEDIA_NONE, maxFileSizeBytes: 0 },
    textLimits: { maxPerMessage: 500, overflowStrategy: "truncate" },
    threading: { supported: false, firstClass: false },
    reactions: { supported: false },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "none" },
    quirks: ["500 character limit in chat", "no media in chat", "emotes via text codes", "rate limited by moderator status", "bits and subscriptions"],
  },
  tlon: {
    channelId: "tlon",
    supportedFormats: ["text", "markdown"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 50 * 1024 * 1024 },
    textLimits: { maxPerMessage: 65536, overflowStrategy: "split" },
    threading: { supported: true, firstClass: false },
    reactions: { supported: true },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "commonmark" },
    quirks: ["Urbit-based platform", "Hark references", "Grafitti extensions", "Markdown via references"],
  },
  "synology-chat": {
    channelId: "synology-chat",
    supportedFormats: ["text", "markdown"],
    media: { inbound: MEDIA_FULL, outbound: MEDIA_FULL, maxFileSizeBytes: 50 * 1024 * 1024 },
    textLimits: { maxPerMessage: 4000, overflowStrategy: "split" },
    threading: { supported: false, firstClass: false },
    reactions: { supported: false },
    groupChat: { supported: true, requireMention: false },
    escaping: { markdownDialect: "basic" },
    quirks: ["Synology Chat API", "self-hosted NAS", "file sharing via Synology", "basic Markdown support"],
  },
};

/**
 * @description 通过 `channelId` 检索预置能力记录。
 * @param channelId - 与 `ALL_CAPABILITIES` 键一致的主机侧渠道标识。
 * @returns 命中的能力对象；未知渠道返回 `undefined`。
 * @throws 不抛出。
 */
export function getChannelCapabilities(channelId: string): ChannelCapabilities | undefined {
  return ALL_CAPABILITIES[channelId];
}
