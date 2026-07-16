/**
 * STOMP wire-helpers 单元测试：幂等缓存。
 * payload 模式映射已迁移到 message-sdk/transport，不再在此测试。
 */
import { describe, expect, it } from "vitest";

import { getStompTcpClaimableDedupe } from "../src/shared/wire-helpers.js";
import { resolvePayloadMode } from "@partme.ai/openclaw-message-sdk/transport";

describe("resolvePayloadMode (shared)", () => {
  it("maps jsonTextOrPlain to message-sdk mode", () => {
    expect(resolvePayloadMode("jsonTextOrPlain")).toBe("jsonTextOrPlain");
  });
});

describe("getStompTcpClaimableDedupe", () => {
  it("returns a singleton cache instance", () => {
    const a = getStompTcpClaimableDedupe();
    const b = getStompTcpClaimableDedupe();
    expect(a).toBe(b);
  });

  it("dedupes only after a claim is committed", async () => {
    const cache = getStompTcpClaimableDedupe();
    const key = `stomp-unit-key-${Date.now()}`;
    await expect(cache.claim(key)).resolves.toMatchObject({ kind: "claimed" });
    await cache.commit(key);
    await expect(cache.claim(key)).resolves.toMatchObject({ kind: "duplicate" });
  });

  it("allows a failed claim to be retried after release", async () => {
    const cache = getStompTcpClaimableDedupe();
    const key = `stomp-unit-release-${Date.now()}`;
    await expect(cache.claim(key)).resolves.toMatchObject({ kind: "claimed" });
    cache.release(key);
    await expect(cache.claim(key)).resolves.toMatchObject({ kind: "claimed" });
    cache.release(key);
  });
});
