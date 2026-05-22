/**
 * 出站桥接：Agent deliver → serializeForTransport → 传输层回调。
 */

import { serializeForTransport } from "../pipeline/serialize-payload.js";
import type { ReplyBridgeParams, ReplyBridgeResult } from "./types.js";

/**
 * 重新导出该模块的公共类型，方便调用方从 barrel 或实现文件按需导入。
 */
export type { ReplyBridgeResult } from "./types.js";

/**
 * 创建 OpenClaw 回复分发器，出站时统一序列化载荷。
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
