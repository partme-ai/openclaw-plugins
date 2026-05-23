/**
 * @module webhook/state
 *
 * Webhook 模式**全局状态**管理（StreamStore + ActiveReplyStore 单例）。
 *
 * **职责**：
 * - 维护 stream 生命周期、防抖队列、response_url 绑定
 * - 定期 prune 过期 stream / activeReply
 *
 * **与 message-sdk 关系**：
 * - `StreamSessionStore` / `StreamSessionMonitor`（queue 子模块）
 * - `ActiveReplyStore`（ingress 子模块，policy=`multi` 允许多次主动推送）
 * - 本文件仅做 WeCom 类型参数化与 `createStreamState` 工厂
 *
 * **关键导出**：`monitorState`（全局单例）、`StreamStore`、`WebhookMonitorState`
 */

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

import type {
  StreamState,
  PendingInbound,
  ActiveReplyState,
  WecomWebhookTarget,
  WebhookInboundMessage,
} from "./types.js";

export type { ActiveReplyState };

/** WeCom 侧 LIMITS 常量（合并 SDK 默认值与 Webhook 专属项）。 */
export const LIMITS = {
  ...STREAM_SESSION_LIMITS,
  ACTIVE_REPLY_TTL_MS: ACTIVE_REPLY_LIMITS.ACTIVE_REPLY_TTL_MS,
  STREAM_MAX_BYTES: 20_480,
  REQUEST_TIMEOUT_MS: 15_000,
};

/**
 * WeCom Webhook 流状态存储（SDK StreamSessionStore 薄封装）。
 */
export class StreamStore extends StreamSessionStore<
  WecomWebhookTarget,
  WebhookInboundMessage,
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

  /**
   * 类型收窄：flush 回调使用 WeCom {@link PendingInbound}。
   *
   * @param handler - 防抖窗口结束时的 flush 处理函数
   */
  override setFlushHandler(handler: (pending: PendingInbound) => void): void {
    super.setFlushHandler(handler as (pending: BasePendingInbound<WecomWebhookTarget, WebhookInboundMessage>) => void);
  }
}

export { ActiveReplyStore };

/**
 * Webhook 全局监控状态容器（单例）。
 */
export class WebhookMonitorState extends StreamSessionMonitor<
  WecomWebhookTarget,
  WebhookInboundMessage,
  StreamState
> {
  constructor() {
    super({ streamStore: new StreamStore(), activeReplyPolicy: "multi" });
  }
}

/** Webhook 全局监控状态单例（所有账号共享 StreamStore / ActiveReplyStore）。 */
export const monitorState = new WebhookMonitorState();
