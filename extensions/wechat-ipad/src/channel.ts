/**
 * @fileoverview 微信 iPad 外部桥接的 OpenClaw Channel 契约。
 *
 * 本文件声明渠道元数据、配置解析、能力矩阵、目标地址规范和运行状态快照。它不建立网络
 * 连接，也不处理消息正文；实际连接由 `WechatIpadBridge` 管理，收发分别由 inbound/outbound
 * 模块完成。
 */
import type {
  ChannelAccountSnapshot,
  ChannelGatewayContext,
} from "openclaw/plugin-sdk";
import type {
  ChannelPlugin,
  OpenClawConfig,
} from "openclaw/plugin-sdk/core";
import {
  getWechatIpadSection,
  resolveWechatIpadConfig,
  WECHAT_IPAD_CONFIG_JSON_SCHEMA,
} from "./config.js";
import { wechatIpadOutbound } from "./outbound.js";
import {
  clearRecentWechatIpadMessages,
  configureWechatIpadProcessedMessageStore,
  registerWechatIpadEventHandlers,
} from "./inbound.js";
import { resolveWechatIpadProcessedMessagesPath } from "./storage/processed-messages.js";
import {
  WechatIpadBridge,
  clearActiveBridge,
  getBridgeStatusSummary,
  setActiveBridge,
} from "./transport/ipad-bridge.js";
import type { PluginLogger, WechatIpadConfig } from "./types.js";

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

/** 保持 Channel 生命周期存活，直到 OpenClaw 通过 AbortSignal 请求停止账户。 */
function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

/** 把 OpenClaw Channel 日志接口收窄为 transport 所需的四个级别。 */
function channelLogger(ctx: ChannelGatewayContext<ResolvedWechatIpadAccount>): PluginLogger {
  return {
    debug: (message) => ctx.log?.debug?.(message),
    info: (message) => ctx.log?.info?.(message),
    warn: (message) => ctx.log?.warn?.(message),
    error: (message) => ctx.log?.error?.(message),
  };
}

/**
 * 使用 OpenClaw 2026.7.1 标准 Channel 生命周期管理桥接器。
 *
 * 连接不能只放在 `registerService`：健康监控只认识 `gateway.startAccount` 更新的账户快照，
 * 否则 Socket 已连接但 `/readyz` 仍会把渠道判定为失败。
 */
async function monitorWechatIpad(
  ctx: ChannelGatewayContext<ResolvedWechatIpadAccount>,
): Promise<void> {
  const logger = channelLogger(ctx);
  const bridge = new WechatIpadBridge(ctx.account.config, logger);
  configureWechatIpadProcessedMessageStore(resolveWechatIpadProcessedMessagesPath());
  setActiveBridge(bridge);
  const disposeHandlers = registerWechatIpadEventHandlers(bridge, ctx.account.config, logger);
  try {
    await bridge.start();
    ctx.setStatus({
      accountId: ctx.account.accountId,
      configured: true,
      running: true,
      lastStartAt: Date.now(),
      lastError: null,
    } as ChannelAccountSnapshot);
    await waitForAbort(ctx.abortSignal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.setStatus({
      accountId: ctx.account.accountId,
      configured: true,
      running: false,
      lastError: message,
    } as ChannelAccountSnapshot);
    if (ctx.account.config.required) throw error;
    logger.warn(`[wechat-ipad] initial connection failed; reconnecting in background: ${message}`);
    await waitForAbort(ctx.abortSignal);
  } finally {
    disposeHandlers();
    await bridge.stop();
    // 只有仍持有活动实例的生命周期才清理全局去重状态，避免热重载的旧 finally 破坏新实例。
    if (clearActiveBridge(bridge)) clearRecentWechatIpadMessages();
    ctx.setStatus({
      accountId: ctx.account.accountId,
      running: false,
      lastStopAt: Date.now(),
    } as ChannelAccountSnapshot);
  }
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
    probeAccount: async () => {
      const state = getBridgeStatusSummary().state;
      // Socket 打开不等于微信账号可收发；只有外部服务确认 logged_in 才算业务就绪。
      return { ok: state === "logged_in" };
    },
    buildAccountSnapshot: ({ account, runtime }) => ({
      ...runtime,
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      ...getBridgeStatusSummary(),
    }),
  },
  gateway: {
    startAccount: monitorWechatIpad,
    // 真正关闭由 startAccount 的 finally 完成；显式 stop 只等待 AbortSignal 驱动同一清理路径。
    stopAccount: async () => {},
  },
};
