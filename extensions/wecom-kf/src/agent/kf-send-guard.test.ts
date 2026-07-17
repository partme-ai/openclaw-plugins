import { afterEach, describe, expect, it } from "vitest";

import {
  KF_SEND_LIMITS,
  checkKfSendAllowed,
  initKfSendGuardStore,
  onKfCustomerInbound,
  peekKfSendGuardState,
  recordKfOutboundSend,
  reserveKfOutboundSend,
  rollbackKfSendReservation,
  resetKfSendGuardForTests,
} from "./kf-send-guard.js";

afterEach(async () => {
  await resetKfSendGuardForTests();
});

describe("kf-send-guard", () => {
  it("未入站时拒绝 send_msg", async () => {
    await initKfSendGuardStore();
    const result = await checkKfSendAllowed({ openKfId: "wk1", externalUserId: "u1" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("no_customer_inbound");
    }
  });

  it("超过 5 条回复后拒绝", async () => {
    await initKfSendGuardStore();
    await onKfCustomerInbound({ openKfId: "wk1", externalUserId: "u1", sendTimeMs: Date.now() });
    for (let i = 0; i < KF_SEND_LIMITS.MAX_REPLIES_PER_CUSTOMER_MSG; i++) {
      await recordKfOutboundSend({ openKfId: "wk1", externalUserId: "u1" });
    }
    const result = await checkKfSendAllowed({ openKfId: "wk1", externalUserId: "u1" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("reply_count_exceeded");
    }
  });

  it("超过 48 小时窗口后拒绝", async () => {
    await initKfSendGuardStore();
    const now = Date.now();
    await onKfCustomerInbound({
      openKfId: "wk1",
      externalUserId: "u1",
      sendTimeMs: now - KF_SEND_LIMITS.REPLY_WINDOW_MS - 1,
    });
    const result = await checkKfSendAllowed({
      openKfId: "wk1",
      externalUserId: "u1",
      nowMs: now,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("reply_window_expired");
    }
  });

  it("并发预占也不会突破单条客户消息 5 条上限", async () => {
    await onKfCustomerInbound({ openKfId: "wk1", externalUserId: "u1", msgId: "msg-1" });

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        reserveKfOutboundSend({ openKfId: "wk1", externalUserId: "u1" }),
      ),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(
      KF_SEND_LIMITS.MAX_REPLIES_PER_CUSTOMER_MSG,
    );
    expect((await peekKfSendGuardState("wk1", "u1"))?.replyCount).toBe(
      KF_SEND_LIMITS.MAX_REPLIES_PER_CUSTOMER_MSG,
    );
  });

  it("发送失败可回滚额度，但不会误减新一轮客户消息计数", async () => {
    await onKfCustomerInbound({ openKfId: "wk1", externalUserId: "u1", msgId: "old" });
    const reserved = await reserveKfOutboundSend({ openKfId: "wk1", externalUserId: "u1" });
    expect(reserved.allowed).toBe(true);
    if (!reserved.allowed) return;

    await rollbackKfSendReservation(reserved.reservation);
    expect((await peekKfSendGuardState("wk1", "u1"))?.replyCount).toBe(0);

    const staleReservation = await reserveKfOutboundSend({ openKfId: "wk1", externalUserId: "u1" });
    expect(staleReservation.allowed).toBe(true);
    if (!staleReservation.allowed) return;
    await onKfCustomerInbound({ openKfId: "wk1", externalUserId: "u1", msgId: "new" });
    await reserveKfOutboundSend({ openKfId: "wk1", externalUserId: "u1" });
    await rollbackKfSendReservation(staleReservation.reservation);
    expect((await peekKfSendGuardState("wk1", "u1"))?.replyCount).toBe(1);
  });
});
