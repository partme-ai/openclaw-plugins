/**
 * inbound-debounce-buffer.test.ts — 消息队列、按 key 串行运行队列与入站防抖缓冲。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createInboundDebounceBuffer } from "./inbound-debounce-buffer.js";

describe("createInboundDebounceBuffer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes debounced items by key", async () => {
    vi.useFakeTimers();
    const flushes: Array<{ key: string; text: string; count: number; reason: string }> = [];
    const buffer = createInboundDebounceBuffer<{ chatId: string; text: string }, string>({
      debounceMs: 100,
      resolveKey: (item) => item.chatId,
      coalesce: (items) => items.map((item) => item.text).join("\n"),
      onFlush: ({ key, value, items, reason }) => {
        flushes.push({ key, text: value, count: items.length, reason });
      },
    });

    await buffer.enqueue({ chatId: "chat-1", text: "hello" });
    await buffer.enqueue({ chatId: "chat-1", text: "again" });
    await buffer.enqueue({ chatId: "chat-2", text: "other" });

    expect(buffer.pendingSize()).toBe(3);

    await vi.advanceTimersByTimeAsync(100);

    expect(flushes).toEqual([
      { key: "chat-1", text: "hello\nagain", count: 2, reason: "timer" },
      { key: "chat-2", text: "other", count: 1, reason: "timer" },
    ]);
    expect(buffer.pendingSize()).toBe(0);
  });

  it("manual flush drains pending batches immediately", async () => {
    vi.useFakeTimers();
    const keys: string[] = [];
    const buffer = createInboundDebounceBuffer<{ chatId: string; text: string }>({
      debounceMs: 1000,
      resolveKey: (item) => item.chatId,
      onFlush: ({ key, reason }) => {
        keys.push(`${key}:${reason}`);
      },
    });

    await buffer.enqueue({ chatId: "chat-1", text: "hello" });
    await buffer.flush("chat-1");

    expect(keys).toEqual(["chat-1:manual"]);
    expect(buffer.pendingKeys()).toEqual([]);
  });

  it("maxBatchSize forces an immediate flush", async () => {
    vi.useFakeTimers();
    const flushes: string[] = [];
    const buffer = createInboundDebounceBuffer<{ chatId: string; text: string }, string>({
      debounceMs: 1000,
      maxBatchSize: 2,
      resolveKey: (item) => item.chatId,
      coalesce: (items) => items.map((item) => item.text).join(","),
      onFlush: ({ value, reason }) => {
        flushes.push(`${reason}:${value}`);
      },
    });

    await buffer.enqueue({ chatId: "chat-1", text: "a" });
    await buffer.enqueue({ chatId: "chat-1", text: "b" });

    expect(flushes).toEqual(["manual:a,b"]);
    expect(buffer.pendingSize()).toBe(0);
  });

  it("cancel drops pending items without flushing", async () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const buffer = createInboundDebounceBuffer<{ chatId: string; text: string }>({
      debounceMs: 100,
      resolveKey: (item) => item.chatId,
      onFlush,
    });

    await buffer.enqueue({ chatId: "chat-1", text: "hello" });
    buffer.cancel("chat-1");
    await vi.advanceTimersByTimeAsync(100);

    expect(onFlush).not.toHaveBeenCalled();
    expect(buffer.pendingSize()).toBe(0);
  });
});
