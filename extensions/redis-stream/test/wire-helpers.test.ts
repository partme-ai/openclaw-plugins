/**
 * Redis Stream wire-helpers 单元测试。
 */
import { describe, expect, it } from "vitest";

import {
  getRedisStreamIdempotencyCache,
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

describe("getRedisStreamIdempotencyCache", () => {
  it("returns singleton and dedupes keys", () => {
    const cache = getRedisStreamIdempotencyCache();
    expect(cache).toBe(getRedisStreamIdempotencyCache());
    expect(cache.remember("redis-stream-key-1")).toBe(false);
    expect(cache.remember("redis-stream-key-1")).toBe(true);
  });
});
