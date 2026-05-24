/**
 * STOMP wire-helpers 单元测试：payload 模式映射与幂等缓存。
 */
import { describe, expect, it } from "vitest";

import {
  getStompTcpIdempotencyCache,
  mapStompTcpWirePayloadMode,
} from "../src/shared/wire-helpers.js";

describe("mapStompTcpWirePayloadMode", () => {
  it("maps jsonTextOrPlain to message-sdk mode", () => {
    expect(mapStompTcpWirePayloadMode("jsonTextOrPlain")).toBe("jsonTextOrPlain");
  });
});

describe("getStompTcpIdempotencyCache", () => {
  it("returns a singleton cache instance", () => {
    const a = getStompTcpIdempotencyCache();
    const b = getStompTcpIdempotencyCache();
    expect(a).toBe(b);
  });

  it("dedupes repeated keys", () => {
    const cache = getStompTcpIdempotencyCache();
    expect(cache.remember("stomp-unit-key-1")).toBe(false);
    expect(cache.remember("stomp-unit-key-1")).toBe(true);
  });

  it("accepts distinct keys independently", () => {
    const cache = getStompTcpIdempotencyCache();
    expect(cache.remember("stomp-unit-key-a")).toBe(false);
    expect(cache.remember("stomp-unit-key-b")).toBe(false);
  });
});
