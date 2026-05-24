/**
 * Web STOMP wire-helpers 单元测试。
 */
import { describe, expect, it } from "vitest";

import {
  getWebStompIdempotencyCache,
  mapWebStompWirePayloadMode,
} from "../src/shared/wire-helpers.js";

describe("mapWebStompWirePayloadMode", () => {
  it("maps jsonTextOrPlain", () => {
    expect(mapWebStompWirePayloadMode("jsonTextOrPlain")).toBe("jsonTextOrPlain");
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
