import { describe, expect, it } from "vitest";
import { classifyDeliveryOutcome, requireSettledDelivery, type ReplyDispatchReceipt } from "./delivery-outcome.js";

const counts = (overrides: Partial<ReplyDispatchReceipt["counts"]["final"]> = {}) => ({
  delivered: 0, deliveredNotVisible: 0, cancelled: 0,
  failedBeforeSend: 0, failedAfterSend: 0, ...overrides,
});
const receipt = (final: Partial<ReplyDispatchReceipt["counts"]["final"]>, pending = false): ReplyDispatchReceipt => ({
  counts: { tool: counts(), block: counts(), final: counts(final) },
  anyVisibleDelivered: Boolean(final.delivered || final.failedAfterSend),
  ...(pending ? { hasPendingDelivery: true } : {}),
});

describe("delivery settlement", () => {
  it("rejects missing and uncertain outcomes before a channel commits its dedupe key", () => {
    expect(() => requireSettledDelivery(undefined)).toThrow("ambiguous");
    expect(() => requireSettledDelivery({ kind: "ambiguous" })).toThrow("ambiguous");
    expect(() => requireSettledDelivery({ kind: "retryable" })).toThrow("retryable");
    expect(() => requireSettledDelivery({ kind: "no-reply" })).not.toThrow();
  });
  it.each([
    [receipt({ delivered: 1 }), "visible", "delivered"],
    [receipt({}), "silent", "no-reply"],
    [receipt({}), "empty", "no-reply"],
    [receipt({ delivered: 1 }), "silent", "ambiguous"],
    [receipt({ delivered: 1 }), "empty", "ambiguous"],
    [receipt({ cancelled: 1 }), "visible", "cancelled"],
    [receipt({ failedBeforeSend: 1 }), "visible", "retryable"],
    [receipt({ delivered: 1, failedBeforeSend: 1 }), "visible", "ambiguous"],
    [receipt({ failedAfterSend: 1 }), "visible", "ambiguous"],
    [receipt({ delivered: 1 }), "visible", "ambiguous", true],
    [undefined, "visible", "ambiguous"],
  ] as const)("classifies receipt %j terminal %s as %s", (value, terminal, expected, pending) => {
    expect(classifyDeliveryOutcome(pending ? { ...value!, hasPendingDelivery: true } : value, terminal).kind).toBe(expected);
  });
});
