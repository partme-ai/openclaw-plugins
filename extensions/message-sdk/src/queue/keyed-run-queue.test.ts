/**
 * keyed-run-queue.test.ts — 消息队列、按 key 串行运行队列与入站防抖缓冲。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import { describe, expect, it, vi } from "vitest";
import { createKeyedRunQueue, KeyedRunQueueInactiveError } from "./keyed-run-queue.js";

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
});
