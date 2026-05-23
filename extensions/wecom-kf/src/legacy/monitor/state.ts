import {
  StreamSessionStore,
  StreamSessionMonitor,
  STREAM_SESSION_LIMITS,
  type BasePendingInbound,
} from "@partme.ai/openclaw-message-sdk/queue";
import {
  ActiveReplyStore,
  ACTIVE_REPLY_LIMITS,
} from "@partme.ai/openclaw-message-sdk/ingress";

import type { WecomBotInboundMessage as WecomInboundMessage } from "../../types/index.js";
import type { StreamState, PendingInbound, ActiveReplyState, WecomWebhookTarget } from "./types.js";

export type { ActiveReplyState };

export const LIMITS = {
  ...STREAM_SESSION_LIMITS,
  ACTIVE_REPLY_TTL_MS: ACTIVE_REPLY_LIMITS.ACTIVE_REPLY_TTL_MS,
  STREAM_MAX_BYTES: 20_480,
  REQUEST_TIMEOUT_MS: 15_000,
};

/**
 * WeCom KF 流状态存储（SDK StreamSessionStore 薄封装）。
 */
export class StreamStore extends StreamSessionStore<
  WecomWebhookTarget,
  WecomInboundMessage,
  StreamState
> {
  constructor() {
    super({
      createStreamState: ({ streamId, msgid, conversationKey, batchKey }) => ({
        streamId,
        msgid,
        conversationKey,
        batchKey,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        started: false,
        finished: false,
        content: "",
      }),
    });
  }

  override setFlushHandler(handler: (pending: PendingInbound) => void): void {
    super.setFlushHandler(handler as (pending: BasePendingInbound<WecomWebhookTarget, WecomInboundMessage>) => void);
  }
}

export { ActiveReplyStore };

class MonitorState extends StreamSessionMonitor<
  WecomWebhookTarget,
  WecomInboundMessage,
  StreamState
> {
  constructor() {
    super({ streamStore: new StreamStore(), activeReplyPolicy: "multi" });
  }
}

export const monitorState = new MonitorState();
