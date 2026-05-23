/**
 * WeCom KF DM 策略薄封装（委托 message-sdk checkChannelDmPolicy）。
 */

import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import {
  checkChannelDmPolicy,
  type DmPolicyCheckResult,
} from "@partme.ai/openclaw-message-sdk/ingress";

import { WECOM_KF_CHANNEL_ID } from "./config/accounts.js";
import { sendKfTextMessage } from "./agent/api-client.js";
import { resolveKfAgentAccount } from "./kf/call-context.js";
import type { WecomAccountConfig } from "./types/index.js";

export type { DmPolicyCheckResult };

/**
 * 解析 KF 账号 DM 策略与 allowFrom（agent.dm 优先，兼容 bot.dm）。
 */
function resolveKfDmConfig(accountConfig: WecomAccountConfig): {
  dmPolicy?: "open" | "pairing" | "allowlist" | "disabled";
  allowFrom?: Array<string | number>;
} {
  const dm = accountConfig.agent?.dm ?? accountConfig.bot?.dm;
  return {
    dmPolicy: dm?.policy,
    allowFrom: dm?.allowFrom,
  };
}

/**
 * 检查 KF 私聊 DM 策略；pairing 模式下通过 KF API 下发配对码。
 */
export async function checkKfDmPolicy(params: {
  core: PluginRuntime;
  cfg: OpenClawConfig;
  accountConfig: WecomAccountConfig;
  openKfId: string;
  senderId: string;
  log?: (message: string) => void;
  error?: (message: string) => void;
}): Promise<DmPolicyCheckResult> {
  const { core, cfg, accountConfig, openKfId, senderId } = params;
  const { dmPolicy, allowFrom } = resolveKfDmConfig(accountConfig);
  const runtime = {
    log: params.log ? (...args: unknown[]) => params.log!(String(args[0] ?? "")) : undefined,
    error: params.error ? (...args: unknown[]) => params.error!(String(args[0] ?? "")) : undefined,
  };

  return checkChannelDmPolicy({
    channelId: WECOM_KF_CHANNEL_ID,
    senderId,
    isGroup: false,
    accountId: openKfId,
    dmPolicy,
    configAllowFrom: allowFrom,
    runtime,
    logPrefix: "[wecom-kf]",
    readPairingAllowFrom: async ({ channelId, accountId }) => {
      const readLegacyAllowFrom = core.channel.pairing.readAllowFromStore as (
        channelOrParams: string | { channel: string; accountId?: string },
        env?: unknown,
        legacyAccountId?: string,
      ) => Promise<string[]>;
      const oldStoreAllowFrom = await readLegacyAllowFrom(
        "wecom-kf",
        undefined,
        accountId,
      ).catch(() => []);
      const newStoreAllowFrom = await readLegacyAllowFrom({
        channel: channelId,
        accountId,
      }).catch(() => []);
      return [...oldStoreAllowFrom, ...newStoreAllowFrom];
    },
    upsertPairingRequest: async ({ channelId, senderId: id, accountId }) => {
      const { code, created } = await core.channel.pairing.upsertPairingRequest({
        channel: channelId,
        id,
        accountId,
        meta: { name: id },
      });
      return { code, created };
    },
    sendPairingReply: async ({ senderId: id, code }) => {
      const agent = resolveKfAgentAccount(cfg, openKfId);
      if (!agent) {
        params.error?.(`[wecom-kf] Cannot send pairing reply: missing corp credentials open_kfid=${openKfId}`);
        return;
      }
      const text = core.channel.pairing.buildPairingReply({
        channel: WECOM_KF_CHANNEL_ID,
        idLine: `您的微信客服用户 ID: ${id}`,
        code,
      });
      await sendKfTextMessage({
        agent,
        externalUserId: id,
        text,
        openKfId,
      });
    },
  });
}
