/**
 * WeCom KF 出站适配器：默认 KF send_msg；legacy wecom-cs 在开关开启时委托 legacy 模块。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";

import { isLegacyWecomCsEnabled } from "../config/kf-routes.js";
import { resolveWecomAccount, resolveWecomAccounts } from "../config/index.js";
import { getWecomRuntime } from "../runtime.js";
import { sendKfOutboundMedia, sendKfOutboundText } from "./kf-send.js";

type OutboundDeliveryResult = {
  channel: string;
  messageId: string;
  timestamp?: number;
};

type ChannelOutboundContext = {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  mediaUrl?: string;
  accountId?: string | null;
};

type ChannelOutboundAdapter = {
  deliveryMode: "direct";
  chunkerMode?: "text";
  textChunkLimit?: number;
  chunker?: (text: string, limit: number) => string[];
  sendText(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult>;
  sendMedia?(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult>;
};

/**
 * 是否应走 legacy wecom-cs Bot/Agent 出站。
 */
function shouldUseLegacyOutbound(cfg: OpenClawConfig, accountId?: string | null): boolean {
  if (!isLegacyWecomCsEnabled(cfg)) return false;
  const requestedId = accountId?.trim();
  if (requestedId) {
    const resolved = resolveWecomAccounts(cfg);
    const known = resolved.accounts[requestedId];
    if (known?.bot?.configured || known?.agent?.configured) {
      return true;
    }
    // 显式未知 accountId 仍走 legacy，由 legacy 模块抛出 not-found
    if (!known) return true;
  }
  const account = resolveWecomAccount({ cfg, accountId });
  return Boolean(account.bot?.configured || account.agent?.configured);
}

/**
 * 懒加载 legacy 出站实现。
 */
async function getLegacyOutbound(): Promise<ChannelOutboundAdapter> {
  const mod = await import("../legacy/outbound-wecom-cs.js");
  return mod.wecomLegacyOutbound;
}

export const wecomOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunkerMode: "text",
  textChunkLimit: 20480,
  chunker: (text, limit) => {
    try {
      return getWecomRuntime().channel.text.chunkText(text, limit);
    } catch {
      return [text];
    }
  },
  sendText: async (ctx) => {
    if (shouldUseLegacyOutbound(ctx.cfg, ctx.accountId)) {
      const legacy = await getLegacyOutbound();
      return legacy.sendText(ctx);
    }

    const result = await sendKfOutboundText(ctx);
    if (!result.ok) {
      throw new Error(result.error ?? "KF outbound send failed");
    }
    return {
      channel: "wecom-kf",
      messageId: result.messageId,
      timestamp: Date.now(),
    };
  },
  sendMedia: async (ctx) => {
    if (shouldUseLegacyOutbound(ctx.cfg, ctx.accountId)) {
      const legacy = await getLegacyOutbound();
      if (!legacy.sendMedia) {
        throw new Error("Legacy outbound sendMedia unavailable");
      }
      return legacy.sendMedia(ctx);
    }

    const result = await sendKfOutboundMedia(ctx);
    if (!result.ok) {
      throw new Error(result.error ?? "KF outbound media send failed");
    }
    return {
      channel: "wecom-kf",
      messageId: result.messageId,
      timestamp: Date.now(),
    };
  },
};
