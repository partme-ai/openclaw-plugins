/**
 * Redis Stream wire-helpers 单元测试。
 */
import { describe, expect, it } from "vitest";

import {
  getRedisStreamClaimableDedupe,
  mapRedisStreamWirePayloadMode,
} from "../src/shared/wire-helpers.js";

describe("mapRedisStreamWirePayloadMode", () => {
  it("maps jsonTextOrPlain", () => {
    expect(mapRedisStreamWirePayloadMode("jsonTextOrPlain")).toBe("jsonTextOrPlain");
  });

  it("maps plain", () => {
    expect(mapRedisStreamWirePayloadMode("plain")).toBe("plain");
  });
});

describe("getRedisStreamClaimableDedupe", () => {
  it("returns singleton and only dedupes committed keys", async () => {
    const options = { enabled: true, ttlMs: 60_000, maxEntries: 100 };
    const cache = getRedisStreamClaimableDedupe(options)!;
    cache.clearMemory();
    expect(cache).toBe(getRedisStreamClaimableDedupe(options));
    expect((await cache.claim("redis-stream-key-1")).kind).toBe("claimed");
    cache.release("redis-stream-key-1");
    expect((await cache.claim("redis-stream-key-1")).kind).toBe("claimed");
    await cache.commit("redis-stream-key-1");
    expect((await cache.claim("redis-stream-key-1")).kind).toBe("duplicate");
  });
});
