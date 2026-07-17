/**
 * keyed-run-queue.test.ts — 消息队列、按 key 串行运行队列与入站防抖缓冲。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import { describe, expect, it, vi } from "vitest";
import { AsyncTimeoutError } from "../util/async-timeout.js";
import {
  createKeyedRunQueue,
  KeyedRunQueueCapacityError,
  KeyedRunQueueInactiveError,
} from "./keyed-run-queue.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe("createKeyedRunQueue", () => {
  it("serializes tasks with the same key", async () => {
    const queue = createKeyedRunQueue();
    const first = deferred<string>();
    const order: string[] = [];

    const firstRun = queue.enqueue("chat-1", async () => {
      order.push("first:start");
      const value = await first.promise;
      order.push("first:end");
      return value;
    });
    const secondRun = queue.enqueue("chat-1", async () => {
      order.push("second:start");
      return "second";
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);

    first.resolve("first");

    await expect(firstRun).resolves.toBe("first");
    await expect(secondRun).resolves.toBe("second");
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("runs different keys concurrently", async () => {
    const queue = createKeyedRunQueue();
    const first = deferred<string>();
    const order: string[] = [];

    const a = queue.enqueue("a", async () => {
      order.push("a:start");
      return await first.promise;
    });
    const b = queue.enqueue("b", async () => {
      order.push("b:start");
      return "b";
    });

    await Promise.resolve();
    expect(order).toEqual(["a:start", "b:start"]);

    await expect(b).resolves.toBe("b");
    first.resolve("a");
    await expect(a).resolves.toBe("a");
  });

  it("reports errors and keeps the key queue moving", async () => {
    const onError = vi.fn();
    const queue = createKeyedRunQueue({ onError });
    const error = new Error("boom");

    const failed = queue.enqueue("chat-1", async () => {
      throw error;
    });
    const next = queue.enqueue("chat-1", async () => "next");

    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("next");
    expect(onError).toHaveBeenCalledWith(error, "chat-1");
  });

  it("rejects new work after deactivate", async () => {
    const queue = createKeyedRunQueue();

    queue.deactivate();

    await expect(queue.enqueue("chat-1", async () => "never")).rejects.toBeInstanceOf(
      KeyedRunQueueInactiveError,
    );
  });

  it("has returns true while a key is active and false after drain", async () => {
    const queue = createKeyedRunQueue();
    const gate = deferred<void>();

    expect(queue.has("chat-1")).toBe(false);

    const run = queue.enqueue("chat-1", async () => {
      await gate.promise;
      return "done";
    });

    await Promise.resolve();
    expect(queue.has("chat-1")).toBe(true);
    expect(queue.pendingKeys()).toContain("chat-1");

    gate.resolve(undefined);
    await run;

    await Promise.resolve();
    expect(queue.has("chat-1")).toBe(false);
  });

  it("snapshot reports depth and queued count", async () => {
    const queue = createKeyedRunQueue();
    const gate = deferred<void>();

    queue.enqueue("chat-1", async () => {
      await gate.promise;
    });
    queue.enqueue("chat-1", async () => undefined);
    queue.enqueue("chat-2", async () => undefined);

    await Promise.resolve();
    const snap = queue.snapshot();
    expect(snap.activeCount).toBe(2);
    expect(snap.pendingKeys).toContain("chat-1");
    expect(snap.pendingKeys).toContain("chat-2");
    expect(snap.keys["chat-1"]?.depth).toBe(2);
    expect(snap.queuedCount).toBeGreaterThanOrEqual(1);

    gate.resolve(undefined);
    await new Promise((r) => setTimeout(r, 5));
  });

  it("fires onWaitWarn when queued too long", async () => {
    vi.useFakeTimers();
    const onWaitWarn = vi.fn();
    const queue = createKeyedRunQueue({ waitWarnMs: 100, onWaitWarn });
    const gate = deferred<void>();

    queue.enqueue("chat-1", async () => {
      await gate.promise;
    });
    queue.enqueue("chat-1", async () => undefined);

    await vi.advanceTimersByTimeAsync(101);
    expect(onWaitWarn).toHaveBeenCalledWith(
      expect.objectContaining({ key: "chat-1", depth: 2 }),
    );

    gate.resolve(undefined);
    vi.useRealTimers();
  });

  it("times out the caller but waits for the real task before starting the next same-key task", async () => {
    vi.useFakeTimers();
    const firstGate = deferred<void>();
    const order: string[] = [];
    let firstSignal: AbortSignal | undefined;
    const queue = createKeyedRunQueue({ taskTimeoutMs: 100 });

    const first = queue.enqueue("chat-1", async ({ lifecycleSignal }) => {
      firstSignal = lifecycleSignal;
      order.push("first:start");
      await firstGate.promise;
      order.push("first:end");
      return "first";
    });
    const second = queue.enqueue("chat-1", async () => {
      order.push("second:start");
      return "second";
    });

    await Promise.resolve();
    const firstExpectation = expect(first).rejects.toBeInstanceOf(AsyncTimeoutError);
    await vi.advanceTimersByTimeAsync(101);
    await firstExpectation;
    expect(firstSignal?.aborted).toBe(true);
    expect(order).toEqual(["first:start"]);

    firstGate.resolve(undefined);
    await vi.runAllTimersAsync();
    await expect(second).resolves.toBe("second");
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
    vi.useRealTimers();
  });

  it("broadcasts cancellation to active work when deactivated", async () => {
    const queue = createKeyedRunQueue();
    const aborted = deferred<void>();

    const running = queue.enqueue("chat-1", async ({ lifecycleSignal }) => {
      lifecycleSignal?.addEventListener("abort", () => aborted.resolve(undefined), { once: true });
      await aborted.promise;
      return "stopped";
    });
    await Promise.resolve();

    const runningExpectation = expect(running).rejects.toMatchObject({ name: "AbortError" });
    queue.deactivate();

    await aborted.promise;
    await runningExpectation;
  });

  it("bounds the total pending tasks and reports overflow", async () => {
    const gate = deferred<void>();
    const onOverflow = vi.fn();
    const queue = createKeyedRunQueue({ maxPendingTasks: 1, onOverflow });
    const first = queue.enqueue("a", async () => {
      await gate.promise;
      return "done";
    });

    await expect(queue.enqueue("b", async () => "never")).rejects.toMatchObject({
      reason: "tasks",
    });
    expect(onOverflow).toHaveBeenCalledWith(
      expect.objectContaining({ key: "b", pendingTasks: 1, reason: "tasks" }),
    );

    gate.resolve(undefined);
    await first;
    await Promise.resolve();
    await expect(queue.enqueue("b", async () => "accepted")).resolves.toBe("accepted");
  });

  it("bounds distinct keys without blocking more work for an existing key", async () => {
    const gate = deferred<void>();
    const queue = createKeyedRunQueue({ maxKeys: 1 });
    const first = queue.enqueue("a", async () => {
      await gate.promise;
    });
    const sameKey = queue.enqueue("a", async () => "same-key");

    await expect(queue.enqueue("b", async () => "never")).rejects.toBeInstanceOf(
      KeyedRunQueueCapacityError,
    );
    gate.resolve(undefined);
    await first;
    await expect(sameKey).resolves.toBe("same-key");
  });

  it("does not let an observer failure mask the original task error", async () => {
    const original = new Error("task failed");
    const queue = createKeyedRunQueue({
      onError: async () => {
        throw new Error("observer failed");
      },
    });

    await expect(
      queue.enqueue("chat-1", async () => {
        throw original;
      }),
    ).rejects.toBe(original);
  });

  it("rejects invalid capacity configuration", () => {
    expect(() => createKeyedRunQueue({ maxPendingTasks: 0 })).toThrow(/maxPendingTasks/);
    expect(() => createKeyedRunQueue({ maxKeys: 1.5 })).toThrow(/maxKeys/);
  });
});
