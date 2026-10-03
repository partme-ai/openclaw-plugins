/**
 * 回复投递回执分类：在 broker ACK 和去重提交之前区分成功、无回复、可重试及不确定结算。
 */
export type ReplyDispatchReceipt = {
  counts: Record<"tool" | "block" | "final", {
    delivered: number;
    deliveredNotVisible: number;
    cancelled: number;
    failedBeforeSend: number;
    failedAfterSend: number;
  }>;
  anyVisibleDelivered: boolean;
  hasPendingDelivery?: true;
};

/** Inbound turn disposition. Ambiguous delivery must never replay the whole turn. */
export type DeliveryOutcome = { kind: "delivered" | "no-reply" | "retryable" | "ambiguous" | "cancelled" };
export type DeliveryTerminal = "visible" | "silent" | "empty" | "pending" | "failed";

/** A channel must retain broker custody or report this error when settlement is uncertain. */
export class UnsettledDeliveryError extends Error {
  constructor(public readonly kind: DeliveryOutcome["kind"]) {
    super(`Channel delivery is ${kind}`);
    this.name = "UnsettledDeliveryError";
  }
}

/** Require explicit final settlement before ACK, accepted response, or dedupe commit. */
export function requireSettledDelivery(outcome: DeliveryOutcome | undefined): void {
  if (outcome?.kind === "delivered" || outcome?.kind === "no-reply") return;
  throw new UnsettledDeliveryError(outcome?.kind ?? "ambiguous");
}

/** Classify all reply kinds before ACK and dedupe commit. Missing evidence stays ambiguous. */
export function classifyDeliveryOutcome(
  receipt: ReplyDispatchReceipt | undefined,
  terminal: DeliveryTerminal,
): DeliveryOutcome {
  if (!receipt || terminal === "pending" || receipt.hasPendingDelivery) return { kind: "ambiguous" };
  const total = Object.values(receipt.counts).reduce((sum, part) => ({
    delivered: sum.delivered + part.delivered,
    deliveredNotVisible: sum.deliveredNotVisible + part.deliveredNotVisible,
    cancelled: sum.cancelled + part.cancelled,
    failedBeforeSend: sum.failedBeforeSend + part.failedBeforeSend,
    failedAfterSend: sum.failedAfterSend + part.failedAfterSend,
  }), { delivered: 0, deliveredNotVisible: 0, cancelled: 0, failedBeforeSend: 0, failedAfterSend: 0 });
  if (total.failedAfterSend > 0 || (total.cancelled > 0 && total.delivered > 0) || (total.failedBeforeSend > 0 &&
    (receipt.anyVisibleDelivered || total.delivered > 0 || total.deliveredNotVisible > 0))) {
    return { kind: "ambiguous" };
  }
  if (total.failedBeforeSend > 0) return { kind: "retryable" };
  if (terminal === "failed") return { kind: "ambiguous" };
  if (total.cancelled > 0 && total.delivered === 0 && total.deliveredNotVisible === 0) {
    return { kind: "cancelled" };
  }
  if (terminal === "silent" || terminal === "empty") {
    return receipt.anyVisibleDelivered || total.delivered > 0 ? { kind: "ambiguous" } : { kind: "no-reply" };
  }
  if (terminal === "visible" && total.delivered > 0) return { kind: "delivered" };
  return { kind: "ambiguous" };
}
