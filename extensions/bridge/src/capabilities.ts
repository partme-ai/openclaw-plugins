/**
 * OpenClaw Bridge — 渠道能力声明
 *
 * 每个渠道的消息格式、媒体支持、文本限制、线程、反应等能力元数据。
 * 用于 outbound 消息规范化时查询渠道限制。
 */

export type SupportedFormat = "text" | "markdown" | "html" | "rich-text" | "card";
export type MediaKind = "image" | "video" | "audio" | "document" | "sticker";
export type MarkdownDialect = "none" | "basic" | "github" | "markdown-v2" | "mrkdwn" | "commonmark" | "html";
export type OverflowStrategy = "truncate" | "split" | "error";

export interface ChannelCapabilities {
  channelId: string;
  supportedFormats: SupportedFormat[];
  media: {
    inbound: MediaKind[];
    outbound: MediaKind[];
    maxFileSizeBytes: number;
  };
  textLimits: {
    maxPerMessage: number;
    overflowStrategy: OverflowStrategy;
  };
  threading: { supported: boolean; firstClass: boolean };
  reactions: { supported: boolean };
  groupChat: { supported: boolean; requireMention: boolean };
  escaping: { markdownDialect: MarkdownDialect };
  quirks: string[];
}

const MEDIA_FULL: MediaKind[] = ["image", "video", "audio", "document"];
const MEDIA_FULL_STICKER: MediaKind[] = ["image", "video", "audio", "document", "sticker"];
const MEDIA_NO_DOC: MediaKind[] = ["image", "video", "audio"];
const MEDIA_IMG_VID: MediaKind[] = ["image", "video"];
const MEDIA_NONE: MediaKind[] = [];

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

/** 按 channelId 查找渠道能力 */
export function getChannelCapabilities(channelId: string): ChannelCapabilities | undefined {
  return ALL_CAPABILITIES[channelId];
}
