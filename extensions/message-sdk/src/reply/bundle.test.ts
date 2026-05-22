import { describe, expect, it, vi } from "vitest";
import { createReplyDispatcherBundle } from "./bundle.js";

describe("createReplyDispatcherBundle", () => {
  it("returns deliver with lifecycle hooks wired", async () => {
    const onTypingIdle = vi.fn();
    const onCleanup = vi.fn();
    const onError = vi.fn();
    const deliver = vi.fn();

    const bundle = createReplyDispatcherBundle({
      deliver,
      lifecycle: { onTypingIdle, onCleanup, onError },
      replyOptions: { disableBlockStreaming: false },
    });

    await bundle.dispatcherOptions.deliver({ text: "hello" });
    expect(deliver).toHaveBeenCalledWith({ text: "hello" });

    const err = new Error("fail");
    await bundle.dispatcherOptions.onError?.(err);
    expect(onError).toHaveBeenCalledWith(err);
    expect(onTypingIdle).toHaveBeenCalledTimes(1);

    await bundle.dispatcherOptions.onIdle?.();
    expect(onTypingIdle).toHaveBeenCalledTimes(2);

    bundle.dispatcherOptions.onCleanup?.();
    expect(onCleanup).toHaveBeenCalledTimes(1);
    expect(bundle.replyOptions).toEqual({ disableBlockStreaming: false });
  });

  it("defaults replyOptions to empty object", () => {
    const bundle = createReplyDispatcherBundle({ deliver: vi.fn() });
    expect(bundle.replyOptions).toEqual({});
  });
});
