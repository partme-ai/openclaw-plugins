/**
 * Web MQTT wire-helpers 单元测试：幂等缓存与幂等键。
 * payload 模式映射已迁移到 message-sdk/transport。
 */
import { describe, expect, it } from "vitest";

import {
  getWebMqttClaimableDedupe,
  resolveWebMqttInboundIdempotencyKey,
} from "../src/shared/wire-helpers.js";
import { resolvePayloadMode } from "@partme.ai/openclaw-message-sdk/transport";

describe("resolvePayloadMode (shared)", () => {
  it("maps jsonTextOrPlain", () => {
    expect(resolvePayloadMode("jsonTextOrPlain")).toBe("jsonTextOrPlain");
  });
});

describe("resolveWebMqttInboundIdempotencyKey", () => {
  it("does not use reusable MQTT packet messageId", () => {
    const key = resolveWebMqttInboundIdempotencyKey({
      clientId: "c1",
      topic: "devices/a/in",
      payload: Buffer.from("hello"),
      messageId: "msg-42",
    });
    expect(key).toBeUndefined();
  });

  it("does not dedupe repeated plain text by content", () => {
    const key = resolveWebMqttInboundIdempotencyKey({
      clientId: "c1",
      topic: "devices/a/in",
      payload: Buffer.from("hello"),
    });
    expect(key).toBeUndefined();
  });

  it("uses an explicit application idempotency key", () => {
    const key = resolveWebMqttInboundIdempotencyKey(
      {
        clientId: "c1",
        topic: "t",
        payload: Buffer.from("ignored"),
      },
      JSON.stringify({ text: "hello", idempotencyKey: "request-42" }),
    );
    expect(key).toBe("c1:t:request-42");
  });
});

describe("getWebMqttClaimableDedupe", () => {
  it("returns singleton and commits successful claims", async () => {
    const a = getWebMqttClaimableDedupe();
    const b = getWebMqttClaimableDedupe();
    expect(a).toBe(b);
    const key = `web-mqtt-dedup-${Date.now()}`;
    expect((await a.claim(key)).kind).toBe("claimed");
    await a.commit(key);
    expect((await a.claim(key)).kind).toBe("duplicate");
  });
});
