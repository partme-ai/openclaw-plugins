/**
 * STOMP wire-helpers 单元测试：幂等缓存。
 * payload 模式映射已迁移到 message-sdk/transport，不再在此测试。
 */
import { describe, expect, it } from "vitest";

import { getStompTcpIdempotencyCache } from "../src/shared/wire-helpers.js";
import { resolvePayloadMode } from "@partme.ai/openclaw-message-sdk/transport";

describe("resolvePayloadMode (shared)", () => {
  it("maps jsonTextOrPlain to message-sdk mode", () => {
    expect(resolvePayloadMode("jsonTextOrPlain")).toBe("jsonTextOrPlain");
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
