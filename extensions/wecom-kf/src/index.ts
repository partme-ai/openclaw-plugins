/**
 * @partme.ai/wecom_kf 插件入口
 *
 * 企业微信客服渠道插件 — 对接企微微信客服 API，
 * 让 OpenClaw Agent 伪装为客服坐席，实现 7x24 智能客服。
 *
 * 核心流程：
 * 1. 注册 wecom-kf 渠道（outbound.sendText → kf/send_msg）
 * 2. 注册 HTTP 回调端点（/wecom/kefu）
 * 3. 注册 /kf-status 自动回复命令
 * 4. 插件就绪后自动发现客服账号 + 验证 Session 配置
 *
 * 消息流：
 *   企微回调 → callback → sync_msg → 分发
 *     ├── origin=3 → handleCustomerMessage → reply 管线 → kf/send_msg
 *     ├── origin=4 → handleSystemEvent → 欢迎语/满意度/状态变更
 *     └── origin=5 → 忽略（接待人员消息）
 */

import type { PluginApi, WecomAccountConfig } from "./types/index.js";
import { wecomKfChannel } from "./channel.js";
import { createKfCallbackHandler } from "./callback.js";
import { setWecomKfRuntime } from "./runtime.js";
import {
  initializeKfAccounts,
  getAllKfAccountIds,
  getAccountMapping,
  getCachedServicers,
  loadCustomAgentMappings,
} from "./config/index.js";

/**
 * 推荐的 dmScope 值列表
 */
const VALID_DM_SCOPES = [
  "per-peer",
  "per-channel-peer",
  "per-account-channel-peer",
];

/**
 * 插件注册入口
 * 由 OpenClaw Gateway 在加载插件时调用
 *
 * @param api - Gateway 注入的插件 API
 */
export default function register(api: PluginApi): void {
  api.registerChannel({ plugin: wecomKfChannel });

  setWecomKfRuntime(api.runtime);

  const callbackHandler = createKfCallbackHandler((openKfId) => {
    return resolveAccountConfig(api.runtime.config, openKfId);
  });
  api.registerHttpRoute({
    path: "/wecom/kefu",
    handler: callbackHandler,
  });

  api.registerCommand({
    name: "kf-status",
    description: "查看企微客服账号连接状态和坐席信息",
    handler: () => {
      const accounts = getAllKfAccountIds();

      if (accounts.length === 0) {
        return { text: "WeChat KF Status: No accounts registered" };
      }

      const lines = accounts.map((id) => {
        const mapping = getAccountMapping(id);
        const servicers = getCachedServicers(id);
        const online = servicers?.filter((s) => s.status === 0).length ?? 0;
        const total = servicers?.length ?? 0;
        return `- ${mapping?.name ?? id} (${id}): ${mapping ? "connected" : "disconnected"}, ${online}/${total} servicers online`;
      });

      return {
        text: `WeChat KF Status:\n${lines.join("\n")}`,
      };
    },
  });

  api.onReady(async () => {
    console.log("[wecom_kf] Plugin ready, initializing...");

    validateSessionConfig(api.runtime.config);

    const channelConfig = getWecomKfChannelConfig(api.runtime.config);
    if (channelConfig) {
      loadCustomAgentMappings(channelConfig);
      await initializeKfAccounts(channelConfig);
    } else {
      console.warn(
        "[wecom_kf] No wecom-kf channel config found. " +
          "Optional: configure channels.wecom-kf in openclaw.json to enable WeCom KF."
      );
    }
  });

  console.log("[wecom_kf] Plugin registered — WeChat KF channel + /kf-status command ready");
}

/**
 * 验证 Session 配置是否合理
 */
function validateSessionConfig(config: Record<string, unknown>): void {
  const session = config.session as Record<string, unknown> | undefined;
  const dmScope = session?.dmScope as string | undefined;

  if (dmScope && !VALID_DM_SCOPES.includes(dmScope)) {
    console.warn(
      `[wecom_kf] WARNING: session.dmScope is "${dmScope}". ` +
        `For WeChat KF, it is strongly recommended to use "per-account-channel-peer".`
    );
  }

  if (!dmScope) {
    console.warn(
      `[wecom_kf] NOTICE: session.dmScope is not configured. ` +
        `Recommended: "per-account-channel-peer" for WeChat KF.`
    );
  }

  const resetByChannel = session?.resetByChannel as Record<string, unknown> | undefined;
  if (!resetByChannel?.["wecom-kf"]) {
    console.info(
      `[wecom_kf] TIP: Consider adding session.resetByChannel["wecom-kf"] ` +
        `= { mode: "idle", idleMinutes: 2880 } to auto-reset idle KF sessions.`
    );
  }
}

/**
 * 获取 wecom-kf 渠道配置
 */
function getWecomKfChannelConfig(
  config: Record<string, unknown>
): Record<string, unknown> | undefined {
  const channels = config.channels as
    | Record<string, Record<string, unknown>>
    | undefined;
  return channels?.["wecom-kf"];
}

/**
 * 根据 openKfId 解析账号配置
 * 优先匹配 openKfId，回退到 default
 */
function resolveAccountConfig(
  config: Record<string, unknown>,
  openKfId?: string
): WecomAccountConfig | undefined {
  const channelConfig = getWecomKfChannelConfig(config);
  if (!channelConfig) return undefined;

  const accounts = channelConfig.accounts as
    | Record<string, WecomAccountConfig>
    | undefined;
  if (!accounts) return undefined;

  if (openKfId) {
    for (const accountConfig of Object.values(accounts)) {
      if (accountConfig.openKfId === openKfId) {
        return accountConfig;
      }
    }
  }

  return accounts.default;
}
