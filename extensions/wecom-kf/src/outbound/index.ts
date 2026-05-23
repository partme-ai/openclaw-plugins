/**
 * WeCom KF 出站适配器：KF send_msg 路径。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";

import { getWecomRuntime } from "../runtime/index.js";
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
