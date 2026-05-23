import { afterEach, describe, expect, it } from "vitest";

import {
  KF_SEND_LIMITS,
  checkKfSendAllowed,
  onKfCustomerInbound,
  recordKfOutboundSend,
  resetKfSendGuardForTests,
} from "./kf-send-guard.js";

afterEach(() => {
  resetKfSendGuardForTests();
});

describe("kf-send-guard", () => {
  it("未入站时拒绝 send_msg", () => {
    const result = checkKfSendAllowed({ openKfId: "wk1", externalUserId: "u1" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("no_customer_inbound");
    }
  });

  it("超过 5 条回复后拒绝", () => {
    onKfCustomerInbound({ openKfId: "wk1", externalUserId: "u1", sendTimeMs: Date.now() });
    for (let i = 0; i < KF_SEND_LIMITS.MAX_REPLIES_PER_CUSTOMER_MSG; i++) {
      recordKfOutboundSend({ openKfId: "wk1", externalUserId: "u1" });
    }
    const result = checkKfSendAllowed({ openKfId: "wk1", externalUserId: "u1" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("reply_count_exceeded");
    }
  });

  it("超过 48 小时窗口后拒绝", () => {
    const now = Date.now();
    onKfCustomerInbound({
      openKfId: "wk1",
      externalUserId: "u1",
      sendTimeMs: now - KF_SEND_LIMITS.REPLY_WINDOW_MS - 1,
    });
    const result = checkKfSendAllowed({
      openKfId: "wk1",
      externalUserId: "u1",
      nowMs: now,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("reply_window_expired");
    }
  });
});
