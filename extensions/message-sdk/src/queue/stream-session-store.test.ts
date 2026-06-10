import { describe, expect, test, vi } from "vitest";

import { StreamSessionStore } from "./stream-session-store.js";

type TestMsg = { msgid?: string };
type TestTarget = { path: string };

describe("StreamSessionStore queue", () => {
  test("does not merge into active batch; flushes queued batch after active finishes", async () => {
    vi.useFakeTimers();
    try {
      const store = new StreamSessionStore<TestTarget, TestMsg>();
      const flushed: string[] = [];
      store.setFlushHandler((pending) => flushed.push(pending.streamId));

      const target = { path: "/test" };
      const conversationKey = "channel:default:U:C";

      const r1 = store.addPendingMessage({
        conversationKey,
        target,
        msg: { msgid: "M1" },
        msgContent: "1",
        nonce: "n",
        timestamp: "t",
        debounceMs: 10,
      });
      const r2 = store.addPendingMessage({
        conversationKey,
        target,
        msg: { msgid: "M2" },
        msgContent: "2",
        nonce: "n",
        timestamp: "t",
        debounceMs: 10,
      });

      expect(r1.status).toBe("active_new");
      expect(r2.status).toBe("queued_new");
      expect(r2.streamId).not.toBe(r1.streamId);

      const r3 = store.addPendingMessage({
        conversationKey,
        target,
        msg: { msgid: "M3" },
        msgContent: "3",
        nonce: "n",
        timestamp: "t",
        debounceMs: 10,
      });
      expect(r3.status).toBe("queued_merged");
      expect(r3.streamId).toBe(r2.streamId);

      await vi.advanceTimersByTimeAsync(11);
      expect(flushed).toEqual([r1.streamId]);

      await vi.advanceTimersByTimeAsync(11);
      expect(flushed).toEqual([r1.streamId]);

      store.onStreamFinished(r1.streamId);
      expect(flushed).toEqual([r1.streamId, r2.streamId]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("merges into active batch when it has not started yet (even after promotion)", async () => {
    vi.useFakeTimers();
    try {
      const store = new StreamSessionStore<TestTarget, TestMsg>();
      const flushed: string[] = [];
      store.setFlushHandler((pending) => flushed.push(pending.streamId));

      const target = { path: "/test" };
      const conversationKey = "channel:default:U:C2";

      const r1 = store.addPendingMessage({
        conversationKey,
        target,
        msg: { msgid: "M1" },
        msgContent: "1",
        nonce: "n",
        timestamp: "t",
        debounceMs: 10,
      });
      store.markStarted(r1.streamId);
      await vi.advanceTimersByTimeAsync(11);
      expect(flushed).toEqual([r1.streamId]);

      const r2 = store.addPendingMessage({
        conversationKey,
        target,
        msg: { msgid: "M2" },
        msgContent: "2",
        nonce: "n",
        timestamp: "t",
        debounceMs: 100,
      });
      expect(flushed).toEqual([r1.streamId]);

      store.onStreamFinished(r1.streamId);
      expect(flushed).toEqual([r1.streamId]);

      const r3 = store.addPendingMessage({
        conversationKey,
        target,
        msg: { msgid: "M3" },
        msgContent: "3",
        nonce: "n",
        timestamp: "t",
        debounceMs: 10,
      });
      expect(r3.streamId).toBe(r2.streamId);
      expect(r3.status).toBe("active_merged");
    } finally {
      vi.useRealTimers();
    }
  });

  test("clears conversation state when idle so next message becomes active", async () => {
    const store = new StreamSessionStore<TestTarget, TestMsg>();
    store.setFlushHandler(() => {});

    const target = { path: "/test" };
    const conversationKey = "channel:default:U:idle";

    const r1 = store.addPendingMessage({
      conversationKey,
      target,
      msg: { msgid: "M1" },
      msgContent: "1",
      nonce: "n",
      timestamp: "t",
      debounceMs: 10,
    });
    store.markStarted(r1.streamId);
    store.markFinished(r1.streamId);
    store.onStreamFinished(r1.streamId);

    const r2 = store.addPendingMessage({
      conversationKey,
      target,
      msg: { msgid: "M2" },
      msgContent: "2",
      nonce: "n",
      timestamp: "t",
      debounceMs: 10,
    });
    expect(r2.status).toBe("active_new");
    expect(r2.streamId).not.toBe(r1.streamId);
  });
});
