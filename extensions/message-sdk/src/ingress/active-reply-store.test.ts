/**
 * active-reply-store 单元测试
 */
import { describe, expect, it, vi } from "vitest";

import { ACTIVE_REPLY_LIMITS, ActiveReplyStore } from "./active-reply-store.js";

describe("ActiveReplyStore", () => {
  it("store 忽略空 response_url", () => {
    const store = new ActiveReplyStore();
    store.store("s1", "  ");
    expect(store.getUrl("s1")).toBeUndefined();
  });

  it("store + getUrl + getProxyUrl 往返", () => {
    const store = new ActiveReplyStore();
    store.store("s1", "https://example.com/reply", "http://proxy");
    expect(store.getUrl("s1")).toBe("https://example.com/reply");
    expect(store.getProxyUrl("s1")).toBe("http://proxy");
  });

  it("policy=once 时第二次 use 抛错", async () => {
    const store = new ActiveReplyStore("once");
    store.store("s1", "https://example.com/reply");
    const fn = vi.fn().mockResolvedValue(undefined);

    await store.use("s1", fn);
    await expect(store.use("s1", fn)).rejects.toThrow(/already used/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("policy=multi 允许多次 use", async () => {
    const store = new ActiveReplyStore("multi");
    store.store("s1", "https://example.com/reply");
    const fn = vi.fn().mockResolvedValue(undefined);

    await store.use("s1", fn);
    await store.use("s1", fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("use 失败时记录 lastError 并向上抛出", async () => {
    const store = new ActiveReplyStore();
    store.store("s1", "https://example.com/reply");

    await expect(
      store.use("s1", async () => {
        throw new Error("network down");
      }),
    ).rejects.toThrow("network down");
  });

  it("prune 清理过期记录", () => {
    vi.useFakeTimers();
    try {
      const store = new ActiveReplyStore();
      store.store("s1", "https://example.com/reply");
      vi.advanceTimersByTime(ACTIVE_REPLY_LIMITS.ACTIVE_REPLY_TTL_MS + 1);
      store.prune();
      expect(store.getUrl("s1")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
