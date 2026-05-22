import { describe, expect, it } from "vitest";
import { createIdempotencyCache } from "../dedup/idempotency-cache.js";
import { normalizeWireIngress } from "./wire-ingress.js";

describe("normalizeWireIngress", () => {
  it("parses plain text", () => {
    const r = normalizeWireIngress({
      rawPayload: "hello",
      mode: "plain",
      channel: "mqtt",
    });
    expect(r.text).toBe("hello");
    expect(r.accepted).toBe(true);
  });

  it("dedupes duplicate keys", () => {
    const cache = createIdempotencyCache({ ttlMs: 60_000, maxEntries: 10 });
    const p = {
      rawPayload: "x",
      mode: "plain" as const,
      channel: "mqtt",
      idempotencyKey: "k1",
      idempotency: cache,
    };
    expect(normalizeWireIngress(p).accepted).toBe(true);
    expect(normalizeWireIngress(p).accepted).toBe(false);
    expect(normalizeWireIngress(p).duplicate).toBe(true);
  });
});
