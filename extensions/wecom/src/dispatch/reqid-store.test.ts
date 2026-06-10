/**
 * reqid-store + timeout + voice-transcode 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPersistentReqIdStore } from "./reqid-store.ts";
import { withTimeout, TimeoutError as TimeoutErr } from "../shared/timeout.ts";
import { isWecomNativeVoiceFormat, needsTranscoding, WECOM_VOICE_FORMATS } from "../agent/voice-transcode.ts";

// ============================================================================
// createPersistentReqIdStore
// ============================================================================

describe("createPersistentReqIdStore", () => {
  let store: ReturnType<typeof createPersistentReqIdStore>;

  beforeEach(() => {
    store = createPersistentReqIdStore("test-account");
  });

  it("set + get 往返", async () => {
    store.set("chat1", "req-001");
    const result = await store.get("chat1");
    expect(result).toBe("req-001");
  });

  it("getSync 同步获取", () => {
    store.set("chat2", "req-002");
    expect(store.getSync("chat2")).toBe("req-002");
  });

  it("不存在的 key 返回 undefined", async () => {
    expect(await store.get("nonexistent")).toBeUndefined();
    expect(store.getSync("nonexistent")).toBeUndefined();
  });

  it("delete 删除条目", () => {
    store.set("chat3", "req-003");
    store.delete("chat3");
    expect(store.getSync("chat3")).toBeUndefined();
  });

  it("覆盖写入更新 reqId", async () => {
    store.set("chat4", "req-old");
    store.set("chat4", "req-new");
    expect(await store.get("chat4")).toBe("req-new");
  });

  it("memorySize 跟踪条目数", () => {
    expect(store.memorySize()).toBe(0);
    store.set("a", "1");
    store.set("b", "2");
    expect(store.memorySize()).toBe(2);
    store.delete("a");
    expect(store.memorySize()).toBe(1);
  });

  it("clearMemory 清空所有", () => {
    store.set("a", "1");
    store.set("b", "2");
    store.clearMemory();
    expect(store.memorySize()).toBe(0);
    expect(store.getSync("a")).toBeUndefined();
  });

  it("TTL 过期后 get 返回 undefined", async () => {
    const shortStore = createPersistentReqIdStore("test", { ttlMs: 10 });
    shortStore.set("ephemeral", "req-ephemeral");

    // 立即可获取
    expect(await shortStore.get("ephemeral")).toBe("req-ephemeral");

    // 等待 TTL 过期
    await new Promise((r) => setTimeout(r, 15));
    expect(await shortStore.get("ephemeral")).toBeUndefined();
  });

  it("TTL=0 表示永不过期", async () => {
    const eternal = createPersistentReqIdStore("test", { ttlMs: 0 });
    eternal.set("forever", "req-forever");
    await new Promise((r) => setTimeout(r, 10));
    expect(await eternal.get("forever")).toBe("req-forever");
  });

  it("内存超限时 LRU 淘汰", () => {
    const smallStore = createPersistentReqIdStore("test", { memoryMaxSize: 3 });
    smallStore.set("1", "a");
    smallStore.set("2", "b");
    smallStore.set("3", "c");
    smallStore.set("4", "d"); // 触发淘汰，最旧的 "1" 被移除
    expect(smallStore.memorySize()).toBeLessThanOrEqual(3);
    expect(smallStore.getSync("1")).toBeUndefined();
  });

  it("touch 机制保持活跃条目", () => {
    const smallStore = createPersistentReqIdStore("test", { memoryMaxSize: 3 });
    smallStore.set("1", "a");
    smallStore.set("2", "b");
    smallStore.set("3", "c");
    // touch "1" — 重新 set
    smallStore.set("1", "a");
    smallStore.set("4", "d"); // 淘汰最旧的 "2"
    expect(smallStore.getSync("1")).toBe("a");   // 被 touch，保留
    expect(smallStore.getSync("2")).toBeUndefined(); // 被淘汰
  });

  it("过期条目在 get 时自动删除", async () => {
    const shortStore = createPersistentReqIdStore("test", { ttlMs: 5 });
    shortStore.set("expiring", "val");
    await new Promise((r) => setTimeout(r, 10));
    expect(await shortStore.get("expiring")).toBeUndefined();
    expect(shortStore.memorySize()).toBe(0);
  });
});

// ============================================================================
// withTimeout / TimeoutError
// ============================================================================

describe("withTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("在超时前完成返回结果", async () => {
    const promise = withTimeout(Promise.resolve("done"), 1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(await promise).toBe("done");
  });

  it("超时后抛出 TimeoutError", async () => {
    const slow = new Promise((r) => setTimeout(r, 2000));
    const promise = withTimeout(slow, 1000, "太慢了");
    vi.advanceTimersByTime(1000);
    await expect(promise).rejects.toThrow("太慢了");
    await expect(promise).rejects.toBeInstanceOf(TimeoutErr);
  });

  it("timeoutMs <= 0 不启用超时", async () => {
    const slow = new Promise((r) => setTimeout(r, 10));
    const promise = withTimeout(slow, 0);
    vi.advanceTimersByTime(10);
    expect(await promise).toBeUndefined();
  });

  it("默认错误消息包含超时时间", async () => {
    const slow = new Promise((r) => setTimeout(r, 500));
    const promise = withTimeout(slow, 100);
    vi.advanceTimersByTime(100);
    await expect(promise).rejects.toThrow("100ms");
  });
});

describe("TimeoutError", () => {
  it("是 Error 子类", () => {
    const err = new TimeoutErr("test");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TimeoutError");
    expect(err.message).toBe("test");
  });
});

// ============================================================================
// isWecomNativeVoiceFormat / needsTranscoding
// ============================================================================

describe("isWecomNativeVoiceFormat", () => {
  it("AMR 是原生格式", () => {
    expect(isWecomNativeVoiceFormat("amr")).toBe(true);
    expect(isWecomNativeVoiceFormat("AMR")).toBe(true);
  });

  it("speex 是原生格式", () => {
    expect(isWecomNativeVoiceFormat("speex")).toBe(true);
    expect(isWecomNativeVoiceFormat("SPEEX")).toBe(true);
  });

  it("mp3 不是原生格式", () => {
    expect(isWecomNativeVoiceFormat("mp3")).toBe(false);
    expect(isWecomNativeVoiceFormat("wav")).toBe(false);
    expect(isWecomNativeVoiceFormat("ogg")).toBe(false);
  });
});

describe("needsTranscoding", () => {
  it("原生格式不需要转码", () => {
    expect(needsTranscoding("amr")).toBe(false);
  });

  it("非原生格式需要转码", () => {
    expect(needsTranscoding("mp3")).toBe(true);
    expect(needsTranscoding("wav")).toBe(true);
  });
});

describe("WECOM_VOICE_FORMATS", () => {
  it("包含 amr 和 speex", () => {
    expect(WECOM_VOICE_FORMATS).toContain("amr");
    expect(WECOM_VOICE_FORMATS).toContain("speex");
    expect(WECOM_VOICE_FORMATS).toHaveLength(2);
  });
});
