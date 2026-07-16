/**
 * @fileoverview 微信 iPad 外部桥接的 OpenClaw Channel 契约。
 *
 * 本文件声明渠道元数据、配置解析、能力矩阵、目标地址规范和运行状态快照。它不建立网络
 * 连接，也不处理消息正文；实际连接由 `WechatIpadBridge` 管理，收发分别由 inbound/outbound
 * 模块完成。
 */
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

/**
 * 将单实例插件配置转换为 OpenClaw 的账户模型。
 * 只有同时启用插件并确认非官方协议风险，账户才会被标记为已配置。
 */
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

/** OpenClaw 2026.7.1 使用的微信 iPad Channel 描述和适配器集合。 */
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
