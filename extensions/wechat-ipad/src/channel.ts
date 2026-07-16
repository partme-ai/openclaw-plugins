import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk/core";
import {
  getWechatIpadSection,
  resolveWechatIpadConfig,
  WECHAT_IPAD_CONFIG_JSON_SCHEMA,
} from "./config.js";
import { wechatIpadOutbound } from "./outbound.js";
import { getBridgeStatusSummary } from "./transport/ipad-bridge.js";
import type { WechatIpadConfig } from "./types.js";

type ResolvedWechatIpadAccount = {
  accountId: "default";
  name: string;
  enabled: boolean;
  configured: boolean;
  config: WechatIpadConfig;
};

function resolveAccount(cfg: OpenClawConfig): ResolvedWechatIpadAccount {
  const config = resolveWechatIpadConfig(
    getWechatIpadSection(cfg as unknown as Record<string, unknown>),
  );
  return {
    accountId: "default",
    name: "External WeChat iPad bridge",
    enabled: config.enabled,
    configured: config.enabled && config.acknowledgeUnofficialProtocolRisk,
    config,
  };
}

export const wechatIpadChannel: ChannelPlugin<ResolvedWechatIpadAccount> = {
  id: "wechat-ipad",
  meta: {
    id: "wechat-ipad",
    label: "微信 iPad 外部桥接",
    selectionLabel: "WeChat iPad (unofficial external bridge)",
    docsPath: "/channels/wechat-ipad",
    docsLabel: "wechat-ipad",
    blurb: "Opt-in bridge to a separately operated, unofficial WeChat iPad protocol service.",
    aliases: ["wechat-ipad", "wx-ipad"],
    order: 150,
  },
  reload: { configPrefixes: ["channels.wechat-ipad", "plugins.entries.wechat-ipad"] },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: false,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  configSchema: {
    schema: WECHAT_IPAD_CONFIG_JSON_SCHEMA,
  },
  config: {
    listAccountIds: () => ["default"],
    defaultAccountId: () => "default",
    resolveAccount: (cfg) => resolveAccount(cfg),
    isConfigured: (account) => account.configured,
    unconfiguredReason: () =>
      "Set enabled=true and acknowledgeUnofficialProtocolRisk=true after reviewing the bridge risk.",
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
    }),
  },
  messaging: {
    normalizeTarget: (raw) => raw.replace(/^wechat-ipad:/i, "").trim() || undefined,
    targetResolver: { looksLikeId: (raw) => Boolean(raw.trim()), hint: "<wxid>" },
  },
  groups: { resolveRequireMention: () => false },
  threading: { resolveReplyToMode: () => "off" },
  outbound: wechatIpadOutbound,
  status: {
    defaultRuntime: { accountId: "default", running: false, lastError: null },
    buildChannelSummary: () => getBridgeStatusSummary(),
    buildAccountSnapshot: ({ account, runtime }) => ({
      ...runtime,
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      ...getBridgeStatusSummary(),
    }),
  },
};
