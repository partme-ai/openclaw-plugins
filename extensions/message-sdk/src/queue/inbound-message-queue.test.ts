import { describe, expect, it, vi } from "vitest";

import { buildTextMessage } from "../core/index.js";
import { createIdempotencyCache } from "../dedup/idempotency-cache.js";
import { InboundMessageQueue } from "./inbound-message-queue.js";

function message(text: string) {
  return buildTextMessage("test", "default", "user", text);
}

describe("InboundMessageQueue", () => {
  it("does not poison an idempotency key when the queue is full", async () => {
    const queue = new InboundMessageQueue({
      maxSize: 1,
      idempotency: createIdempotencyCache({ ttlMs: 60_000, maxEntries: 10 }),
    });

    await expect(queue.push({ message: message("first"), idempotencyKey: "first" }))
      .resolves.toBe(true);
    await expect(queue.push({ message: message("second"), idempotencyKey: "second" }))
      .resolves.toBe(false);

    expect(queue.pop()?.message.text).toBe("first");
    await expect(queue.push({ message: message("second"), idempotencyKey: "second" }))
      .resolves.toBe(true);
  });

  it("distinguishes duplicate messages from capacity overflow", async () => {
    const onOverflow = vi.fn();
    const queue = new InboundMessageQueue({
      maxSize: 2,
      onOverflow,
      idempotency: createIdempotencyCache({ ttlMs: 60_000, maxEntries: 10 }),
    });

    await expect(
      queue.pushDetailed({ message: message("first"), idempotencyKey: "same" }),
    ).resolves.toBe("accepted");
    await expect(
      queue.pushDetailed({ message: message("duplicate"), idempotencyKey: "same" }),
    ).resolves.toBe("duplicate");
    await expect(
      queue.pushDetailed({ message: message("second"), idempotencyKey: "second" }),
    ).resolves.toBe("accepted");
    await expect(
      queue.pushDetailed({ message: message("overflow"), idempotencyKey: "third" }),
    ).resolves.toBe("full");
    expect(onOverflow).toHaveBeenCalledWith(expect.objectContaining({ size: 2, maxSize: 2 }));
  });

  it("rolls back the queue item and idempotency reservation when onPush fails", async () => {
    const onPush = vi.fn()
      .mockRejectedValueOnce(new Error("dispatch failed"))
      .mockResolvedValueOnce(undefined);
    const queue = new InboundMessageQueue({
      onPush,
      idempotency: createIdempotencyCache({ ttlMs: 60_000, maxEntries: 10 }),
    });
    const params = { message: message("retry"), idempotencyKey: "retry-1" };

    await expect(queue.push(params)).rejects.toThrow("dispatch failed");
    expect(queue.size).toBe(0);
    await expect(queue.push(params)).resolves.toBe(true);
    expect(queue.size).toBe(1);
    expect(onPush).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid capacity configuration", () => {
    expect(() => new InboundMessageQueue({ maxSize: 0 })).toThrow(/positive safe integer/);
    expect(() => new InboundMessageQueue({ maxSize: Number.NaN })).toThrow(/positive safe integer/);
  });
});
