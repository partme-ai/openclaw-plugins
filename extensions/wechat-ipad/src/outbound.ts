/**
 * @fileoverview OpenClaw Agent 回复到外部 iPad 协议服务的出站适配器。
 *
 * 该层只接受文本出站，先规范化并限制 wxid 目标，再经活动 `WechatIpadBridge` 调用外部
 * `/api/send`。桥接服务返回的消息 ID 会被转换为 OpenClaw 标准发送结果。
 */
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

/** 从不同桥接服务常见响应字段中提取消息 ID，并提供只用于可观测性的兜底值。 */
function resolveMessageId(data: unknown): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const value = record.messageId ?? record.msgId ?? record.id;
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return `wechat-ipad-${Date.now()}`;
}

/** OpenClaw 2026.7.1 直接发送模式的微信 iPad 出站适配器。 */
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
