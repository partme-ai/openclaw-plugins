import { describe, expect, it, vi } from "vitest";
import { WechatIpadInboundQueue } from "../src/dispatch/inbound-queue.js";

describe("WechatIpadInboundQueue", () => {
  it("serializes Agent tasks and rejects work beyond the configured pending bound", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const onError = vi.fn();
    const queue = new WechatIpadInboundQueue(1, onError);

    expect(queue.enqueue(async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
    })).toBe(true);
    expect(queue.enqueue(async () => {
      order.push("second");
    })).toBe(true);
    expect(queue.enqueue(async () => {
      order.push("overflow");
    })).toBe(false);

    releaseFirst();
    await vi.waitFor(() => expect(order).toEqual(["first:start", "first:end", "second"]));
    expect(onError).not.toHaveBeenCalled();
    expect(queue.getStatus()).toEqual({ running: false, pending: 0, closed: false });
  });

  it("contains task failures and drops queued work when closed", async () => {
    const onError = vi.fn();
    const completed = vi.fn();
    const queue = new WechatIpadInboundQueue(2, onError);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    queue.enqueue(async () => {
      await gate;
      throw new Error("agent failed");
    });
    queue.enqueue(async () => completed());
    queue.close();
    release();

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "agent failed" })));
    expect(completed).not.toHaveBeenCalled();
    expect(queue.enqueue(async () => completed())).toBe(false);
  });
});
