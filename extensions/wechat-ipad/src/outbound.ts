import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk/channel-contract";
import { outboundFromText } from "./dispatch/message-converter.js";
import { sendMessage } from "./transport/ipad-bridge.js";

function normalizeTarget(value: string): string {
  const target = value.replace(/^wechat-ipad:/i, "").trim();
  if (!target || target.length > 256 || /[\s/?#]/.test(target)) {
    throw new Error("wechat-ipad: invalid outbound target");
  }
  return target;
}

function resolveMessageId(data: unknown): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const value = record.messageId ?? record.msgId ?? record.id;
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return `wechat-ipad-${Date.now()}`;
}

/** OpenClaw 2026.7.1 direct outbound adapter. */
export const wechatIpadOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  textChunkLimit: 8_000,
  async sendText(ctx) {
    const target = normalizeTarget(ctx.to);
    const result = await sendMessage(outboundFromText(target, ctx.text));
    if (!result.ok) throw new Error(result.error ?? "wechat-ipad bridge send failed");
    return {
      channel: "wechat-ipad",
      messageId: resolveMessageId(result.data),
      timestamp: Date.now(),
    };
  },
};
