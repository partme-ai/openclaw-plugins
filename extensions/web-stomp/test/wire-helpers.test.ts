/**
 * Web STOMP wire-helpers 单元测试：幂等缓存。
 * payload 模式映射已迁移到 message-sdk/transport。
 */
import { describe, expect, it } from "vitest";

import { getWebStompIdempotencyCache } from "../src/shared/wire-helpers.js";
import { resolvePayloadMode } from "@partme.ai/openclaw-message-sdk/transport";

describe("resolvePayloadMode (shared)", () => {
  it("maps jsonTextOrPlain", () => {
    expect(resolvePayloadMode("jsonTextOrPlain")).toBe("jsonTextOrPlain");
  });
});

describe("getWebStompIdempotencyCache", () => {
  it("returns singleton cache", () => {
    expect(getWebStompIdempotencyCache()).toBe(getWebStompIdempotencyCache());
  });

  it("dedupes repeated keys", () => {
    const cache = getWebStompIdempotencyCache();
    expect(cache.remember("web-stomp-key-1")).toBe(false);
    expect(cache.remember("web-stomp-key-1")).toBe(true);
  });
});
