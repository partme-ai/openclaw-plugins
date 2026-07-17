/**
 * Web STOMP wire-helpers 单元测试：幂等缓存。
 * payload 模式映射已迁移到 message-sdk/transport。
 */
import { describe, expect, it } from "vitest";

import { getWebStompClaimableDedupe } from "../src/shared/wire-helpers.js";
import { resolvePayloadMode } from "@partme.ai/openclaw-message-sdk/transport";

describe("resolvePayloadMode (shared)", () => {
  it("maps jsonTextOrPlain", () => {
    expect(resolvePayloadMode("jsonTextOrPlain")).toBe("jsonTextOrPlain");
  });
});

describe("getWebStompClaimableDedupe", () => {
  it("returns singleton cache", () => {
    expect(getWebStompClaimableDedupe()).toBe(getWebStompClaimableDedupe());
  });

  it("commits successful claims and reports duplicates", async () => {
    const cache = getWebStompClaimableDedupe();
    const key = `web-stomp-key-${Date.now()}`;
    expect((await cache.claim(key)).kind).toBe("claimed");
    await cache.commit(key);
    expect((await cache.claim(key)).kind).toBe("duplicate");
  });
});
