/**
 * Web MQTT wire-helpers 单元测试。
 */
import { describe, expect, it } from "vitest";

import {
  getWebMqttIdempotencyCache,
  mapWebMqttWirePayloadMode,
  resolveWebMqttInboundIdempotencyKey,
} from "../src/shared/wire-helpers.js";

describe("mapWebMqttWirePayloadMode", () => {
  it("maps jsonTextOrPlain", () => {
    expect(mapWebMqttWirePayloadMode("jsonTextOrPlain")).toBe("jsonTextOrPlain");
  });
});

describe("resolveWebMqttInboundIdempotencyKey", () => {
  it("prefers MQTT messageId when present", () => {
    const key = resolveWebMqttInboundIdempotencyKey({
      clientId: "c1",
      topic: "devices/a/in",
      payload: Buffer.from("hello"),
      messageId: "msg-42",
    });
    expect(key).toBe("msg-42");
  });

  it("falls back to client+topic+payload fingerprint", () => {
    const key = resolveWebMqttInboundIdempotencyKey({
      clientId: "c1",
      topic: "devices/a/in",
      payload: Buffer.from("hello"),
    });
    expect(key).toBe("c1:devices/a/in:hello");
  });

  it("uses provided payloadText without re-decoding buffer", () => {
    const key = resolveWebMqttInboundIdempotencyKey(
      {
        clientId: "c1",
        topic: "t",
        payload: Buffer.from("ignored"),
      },
      "from-text",
    );
    expect(key).toBe("c1:t:from-text");
  });
});

describe("getWebMqttIdempotencyCache", () => {
  it("returns singleton and dedupes keys", () => {
    const a = getWebMqttIdempotencyCache();
    const b = getWebMqttIdempotencyCache();
    expect(a).toBe(b);
    expect(a.remember("web-mqtt-dedup-1")).toBe(false);
    expect(a.remember("web-mqtt-dedup-1")).toBe(true);
  });
});
