/**
 * claimable-dedupe.test.ts — 入站消息幂等、持久化去重与并发 claim/release 保护。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import { describe, expect, it, vi } from "vitest";
import { createClaimableDedupe } from "./claimable-dedupe.js";

describe("createClaimableDedupe", () => {
  it("claims once, reports inflight, then reports duplicate after commit", async () => {
    const dedupe = createClaimableDedupe({ ttlMs: 60_000, memoryMaxSize: 100 });

    expect(await dedupe.claim("msg-1")).toEqual({ kind: "claimed", key: "msg-1" });
    expect(await dedupe.claim("msg-1")).toEqual({ kind: "inflight", key: "msg-1" });

    await dedupe.commit("msg-1");

    expect(await dedupe.claim("msg-1")).toEqual({ kind: "duplicate", key: "msg-1" });
    expect(await dedupe.hasRecent("msg-1")).toBe(true);
  });

  it("releases retryable claims so they can be claimed again", async () => {
    const dedupe = createClaimableDedupe({ ttlMs: 60_000, memoryMaxSize: 100 });

    expect((await dedupe.claim("msg-1")).kind).toBe("claimed");
    dedupe.release("msg-1", { error: new Error("retry later") });

    expect((await dedupe.claim("msg-1")).kind).toBe("claimed");
  });

  it("expires committed and inflight records by TTL", async () => {
    const dedupe = createClaimableDedupe({ ttlMs: 1000, memoryMaxSize: 100 });

    expect((await dedupe.claim("msg-1", { now: 1000 })).kind).toBe("claimed");
    expect((await dedupe.claim("msg-1", { now: 1500 })).kind).toBe("inflight");
    expect((await dedupe.claim("msg-1", { now: 2500 })).kind).toBe("claimed");

    await dedupe.commit("msg-1", { now: 2500 });
    expect((await dedupe.claim("msg-1", { now: 2600 })).kind).toBe("duplicate");
    expect((await dedupe.claim("msg-1", { now: 3600 })).kind).toBe("claimed");
  });

  it("checks persistent storage before claiming", async () => {
    const persistent = {
      checkAndRecord: vi.fn(async () => true),
      hasRecent: vi.fn(async () => true),
      warmup: vi.fn(async () => 0),
      clearMemory: vi.fn(),
      memorySize: vi.fn(() => 0),
    };
    const dedupe = createClaimableDedupe({
      ttlMs: 60_000,
      memoryMaxSize: 100,
      persistent,
      namespace: "webhook",
    });

    expect(await dedupe.claim("msg-1")).toEqual({ kind: "duplicate", key: "msg-1" });
    expect(persistent.hasRecent).toHaveBeenCalledWith("msg-1", {
      namespace: "webhook",
      now: expect.any(Number),
      onDiskError: undefined,
    });
  });
});
