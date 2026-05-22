/**
 * pipeline.test.ts — 传输 payload parse/serialize 以及回复内容拆分管线。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import { describe, it, expect } from "vitest";
import { buildMessage } from "../core/message.js";
import { parseEnvelope, serializeEnvelope, buildEnvelope } from "../core/envelope.js";
import { parseTransportPayload } from "./parse-payload.js";
import { serializeForTransport } from "./serialize-payload.js";
import { createIdempotencyCache } from "../dedup/idempotency-cache.js";

describe("MessageEnvelope", () => {
  it("round-trips envelope v1", () => {
    const msg = buildMessage({
      channel: "mqtt",
      accountId: "default",
      userId: "device-1",
      text: "hello",
    });
    const env = buildEnvelope(msg, { correlationId: "c-1", replyRoute: { topic: "reply/x" } });
    const raw = serializeEnvelope(env);
    const parsed = parseEnvelope(raw);
    expect(parsed?.version).toBe("1");
    expect(parsed?.message.text).toBe("hello");
    expect(parsed?.headers?.correlationId).toBe("c-1");
    expect(parsed?.headers?.replyRoute?.topic).toBe("reply/x");
  });
});

describe("parseTransportPayload", () => {
  it("parses envelope json", () => {
    const msg = buildMessage({ channel: "mqtt", accountId: "a", userId: "u", text: "hi" });
    const raw = serializeEnvelope(buildEnvelope(msg));
    const r = parseTransportPayload(raw, "jsonTextOrPlain");
    expect(r.text).toBe("hi");
    expect(r.unified?.source.channel).toBe("mqtt");
  });

  it("falls back to legacy text json", () => {
    const r = parseTransportPayload(JSON.stringify({ text: "legacy" }), "jsonTextOrPlain");
    expect(r.text).toBe("legacy");
  });

  it("plain mode returns raw", () => {
    expect(parseTransportPayload("raw", "plain").text).toBe("raw");
  });
});

describe("serializeForTransport", () => {
  it("defaults to envelope format", () => {
    const wire = serializeForTransport({
      channel: "rabbitmq",
      accountId: "default",
      userId: "peer",
      text: "reply",
    });
    const parsed = parseEnvelope(wire);
    expect(parsed?.message.text).toBe("reply");
    expect(parsed?.message.direction).toBe("outbound");
  });

  it("legacyJsonText mode", () => {
    const wire = serializeForTransport({
      channel: "mqtt",
      accountId: "a",
      userId: "u",
      text: "x",
      format: "legacyJsonText",
    });
    expect(JSON.parse(wire)).toEqual({ text: "x" });
  });
});

describe("wire envelope v1 snapshot", () => {
  it("matches stable envelope shape", () => {
    const wire = serializeForTransport({
      channel: "mqtt",
      accountId: "default",
      userId: "device-1",
      text: "ping",
      replyRoute: { topic: "reply/device-1" },
    });
    const parsed = parseEnvelope(wire);
    expect(parsed?.version).toBe("1");
    expect(parsed?.message.text).toBe("ping");
    expect(parsed?.message.direction).toBe("outbound");
    expect(parsed?.headers?.replyRoute).toEqual({ topic: "reply/device-1" });
    expect(JSON.parse(wire)).toMatchObject({
      version: "1",
      message: {
        source: { channel: "mqtt", accountId: "default", userId: "device-1" },
        text: "ping",
        direction: "outbound",
      },
      headers: { replyRoute: { topic: "reply/device-1" } },
    });
  });
});

describe("createIdempotencyCache", () => {
  it("dedupes within ttl", () => {
    const cache = createIdempotencyCache({ ttlMs: 60_000, maxEntries: 10 });
    expect(cache.remember("k1")).toBe(false);
    expect(cache.has("k1")).toBe(true);
    expect(cache.remember("k1")).toBe(true);
  });
});
