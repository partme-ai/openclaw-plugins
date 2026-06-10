/**
 * @module bridge/reply-bridge
 *
 * 出站桥接：Agent deliver → serializeForTransport → 传输层回调。
 *
 * **职责**：创建 OpenClaw 回复分发器，在 deliver 时统一序列化为 envelope/legacy/plain wire 字符串。
 *
 * **关键导出**：`createReplyHandler`
 */

import { serializeForTransport } from "../pipeline/serialize-payload.js";
import type { ReplyBridgeParams, ReplyBridgeResult } from "./types.js";

/** 重新导出 ReplyBridgeResult / Re-export result type */
export type { ReplyBridgeResult } from "./types.js";

/**
 * 创建 OpenClaw 回复分发器，出站时统一序列化载荷 / Create reply dispatcher with wire serialization.
 *
 * @param params - Runtime、通道身份、deliver 回调、outboundFormat、replyRoute
 * @returns dispatcher 与 replyOptions（供 dispatchReplyFromConfig 使用）
 */
export function createReplyHandler(params: ReplyBridgeParams): ReplyBridgeResult {
  const { runtime, channel, accountId, peerId, deliver, outboundFormat, replyRoute, agentId } =
    params;

  const dispatcher = runtime.channel.reply.createReplyDispatcherWithTyping({
    deliver: async (payload: { text: string }) => {
      const wire = serializeForTransport({
        channel,
        accountId,
        userId: peerId,
        text: payload.text,
        agentId,
        format: outboundFormat ?? "envelope",
        replyRoute,
      });
      await deliver({ text: payload.text, wire });
    },
  });

  return {
    dispatcher,
    replyOptions: {},
  };
}
