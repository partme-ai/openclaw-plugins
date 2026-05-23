/**
 * ttl-map-store 单元测试
 */
import { describe, expect, it } from "vitest";
import { createReqIdStore, createTtlMapStore } from "./ttl-map-store.js";

describe("createTtlMapStore", () => {
  it("set + get 往返", () => {
    const store = createTtlMapStore<string>();
    store.set("k1", "v1");
    expect(store.get("k1")).toBe("v1");
  });

  it("TTL 过期后 get 返回 undefined", async () => {
    const store = createTtlMapStore<string>({ ttlMs: 10 });
    store.set("ephemeral", "val");
    expect(store.get("ephemeral")).toBe("val");
    await new Promise((r) => setTimeout(r, 15));
    expect(store.get("ephemeral")).toBeUndefined();
  });

  it("容量超限淘汰最旧条目", () => {
    const store = createTtlMapStore<string>({ maxSize: 2 });
    store.set("1", "a");
    store.set("2", "b");
    store.set("3", "c");
    expect(store.size()).toBeLessThanOrEqual(2);
    expect(store.get("1")).toBeUndefined();
  });
});

describe("createReqIdStore", () => {
  it("set + get 往返", async () => {
    const store = createReqIdStore("test");
    store.set("chat1", "req-001");
    expect(await store.get("chat1")).toBe("req-001");
    expect(store.getSync("chat1")).toBe("req-001");
  });

  it("TTL 过期", async () => {
    const store = createReqIdStore("test", { ttlMs: 10 });
    store.set("ephemeral", "req");
    await new Promise((r) => setTimeout(r, 15));
    expect(await store.get("ephemeral")).toBeUndefined();
  });
});
