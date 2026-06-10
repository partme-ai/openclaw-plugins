/**
 * @module ingress/deferred-delivery-ack
 *
 * Wire/MQ 入站 deferred ack 辅助：在传输层 ack/nack 与 reply deliver 之间建立显式契约。
 *
 * **职责**：跟踪 reply 是否已成功 publish，在 dispatch 完成后统一 ack，或在失败时 nack。
 * 供 RabbitMQ 等需要「回复发布成功后再 ack」的通道插件复用。
 *
 * **关键导出**：`createDeferredDeliveryAck`、`IngressDeliveryControls`
 */

/** 传输层提供的入站投递处置接口（ack / nack）。 */
export type IngressDeliveryControls = {
  /** 是否已 ack 或 nack */
  readonly settled: boolean;
  /** 确认消息已成功处理 */
  ack: () => void;
  /** 拒绝消息，可选 requeue */
  nack: (options?: { requeue?: boolean; reason?: string }) => void;
};

/** createDeferredDeliveryAck 配置项。 */
export type CreateDeferredDeliveryAckOptions = {
  /** 传输层 delivery 句柄 */
  delivery: IngressDeliveryControls;
  /** 是否要求至少一次成功 reply publish 后才 ack */
  requireReply: boolean;
  /** requireReply 且未 publish 时的默认 requeue 策略 */
  requeueOnMissingReply?: boolean;
};

/**
 * 创建 deferred ack 控制器，协调 reply deliver 与最终 ack/nack。
 *
 * @param options - delivery 句柄与 reply 要求
 * @returns 包装 deliver、标记 publish、finalize 的工具对象
 */
export function createDeferredDeliveryAck(options: CreateDeferredDeliveryAckOptions) {
  let replyPublished = false;

  return {
    /** 标记至少一次 reply 已成功 publish */
    markReplyPublished(): void {
      replyPublished = true;
    },

    /** 是否已有成功 reply publish */
    wasReplyPublished(): boolean {
      return replyPublished;
    },

    /** 立即 ack（幂等短路等无需 reply 的场景） */
    ackImmediate(): void {
      if (!options.delivery.settled) {
        options.delivery.ack();
      }
    },

    /** 失败时 nack */
    nackOnFailure(requeue?: boolean, reason?: string): void {
      if (!options.delivery.settled) {
        options.delivery.nack({ requeue, reason });
      }
    },

    /**
     * 包装 reply deliver：publish 成功后标记 replyPublished（不在此处 ack，等 finalize）。
     *
     * @param deliver - 原始 deliver 回调
     * @returns 包装后的 deliver
     */
    wrapReplyDeliver(
      deliver: (payload: { wire: string; text?: string; runId?: string }) => void | Promise<void>,
    ): (payload: { wire: string; text?: string; runId?: string }) => Promise<void> {
      return async (payload) => {
        await deliver(payload);
        replyPublished = true;
      };
    },

    /**
     * dispatch 完成后根据 requireReply 决定 ack 或 nack。
     *
     * @returns 是否已 settle delivery
     */
    finalizeAfterDispatch(): boolean {
      if (options.delivery.settled) {
        return true;
      }
      if (options.requireReply) {
        if (replyPublished) {
          options.delivery.ack();
          return true;
        }
        options.delivery.nack({
          requeue: options.requeueOnMissingReply ?? true,
          reason: "no_reply_published",
        });
        return true;
      }
      options.delivery.ack();
      return true;
    },
  };
}
