import { describe, expect, it, vi } from "vitest";
import { createDeferredDeliveryAck } from "./deferred-delivery-ack.js";

function mockDelivery() {
  let settled = false;
  const ack = vi.fn(() => {
    settled = true;
  });
  const nack = vi.fn(() => {
    settled = true;
  });
  return {
    get settled() {
      return settled;
    },
    ack,
    nack,
  };
}

describe("createDeferredDeliveryAck", () => {
  it("acks after dispatch when reply not required", () => {
    const delivery = mockDelivery();
    const ctrl = createDeferredDeliveryAck({ delivery, requireReply: false });
    ctrl.finalizeAfterDispatch();
    expect(delivery.ack).toHaveBeenCalledTimes(1);
    expect(delivery.nack).not.toHaveBeenCalled();
  });

  it("nacks when reply required but never published", () => {
    const delivery = mockDelivery();
    const ctrl = createDeferredDeliveryAck({
      delivery,
      requireReply: true,
      requeueOnMissingReply: false,
    });
    ctrl.finalizeAfterDispatch();
    expect(delivery.nack).toHaveBeenCalledWith({ requeue: false, reason: "no_reply_published" });
    expect(delivery.ack).not.toHaveBeenCalled();
  });

  it("acks after dispatch when reply was published", async () => {
    const delivery = mockDelivery();
    const ctrl = createDeferredDeliveryAck({ delivery, requireReply: true });
    const deliver = ctrl.wrapReplyDeliver(async () => {});
    await deliver({ wire: "{}" });
    ctrl.finalizeAfterDispatch();
    expect(delivery.ack).toHaveBeenCalledTimes(1);
  });

  it("ackImmediate settles without waiting for reply", () => {
    const delivery = mockDelivery();
    const ctrl = createDeferredDeliveryAck({ delivery, requireReply: true });
    ctrl.ackImmediate();
    expect(delivery.ack).toHaveBeenCalledTimes(1);
    ctrl.finalizeAfterDispatch();
    expect(delivery.ack).toHaveBeenCalledTimes(1);
  });
});
