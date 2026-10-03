import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { serializeForTransport } from "../pipeline/serialize-payload.js";
import { parseTransportPayload } from "../pipeline/parse-payload.js";

const message = {
  schemaVersion: 1,
  messageId: "message-1",
  deliveryId: "delivery-1",
  parts: [
    { type: "text", text: "before" },
    { type: "media", mediaType: "image", url: "https://media.example.org/image.png" },
    { type: "text", text: "after" },
  ],
  replyTo: "parent-1",
  threadId: "thread-1",
};
const base = { channel: "mqtt", accountId: "default", userId: "peer", text: "legacy" };

describe("explicit structured-v1 wire contract", () => {
  it("preserves ordered parts and all correlation identities", () => {
    const wire = serializeForTransport({ ...base, format: "structured-v1", structured: message,
      authorizedMediaUrls: [message.parts[1].url],
    } as never);
    expect(JSON.parse(wire)).toEqual({ format: "structured-v1", ...message });
    expect(parseTransportPayload(wire, "structured-v1" as never)).toMatchObject({ structured: message });
  });

  it("does not infer authorization merely from a public-looking URL", () => {
    expect(() => serializeForTransport({ ...base, format: "structured-v1", structured: message } as never))
      .toThrow(/authoriz/i);
  });

  it.each(["/tmp/private.png", "file:///tmp/private.png", "https://media.example.org/image?token=secret", "https://user:secret@media.example.org/image", "https://media.example.org/image#secret"])("rejects non-transferable reference %s even when allowlisted", (url) => {
    expect(() => serializeForTransport({ ...base, format: "structured-v1",
      structured: { ...message, parts: [{ type: "media", mediaType: "image", url }] }, authorizedMediaUrls: [url],
    } as never)).toThrow();
  });

  it("rejects unknown schema versions instead of rendering the envelope as text", () => {
    expect(() => parseTransportPayload(JSON.stringify({ ...message, schemaVersion: 2 }), "structured-v1" as never))
      .toThrow(/version/i);
  });

  it("retains legacy consumer golden bytes including whitespace and escaping", () => {
    const text = ' hello\n"世界" ';
    expect(serializeForTransport({ ...base, text, format: "plainText" })).toBe(text);
    expect(serializeForTransport({ ...base, text, format: "legacyJsonText" })).toBe('{"text":" hello\\n\\"世界\\" "}');
    expect(parseTransportPayload('{"text":" hello "}')).toEqual({ text: " hello ", unified: null, correlationId: undefined, idempotencyKey: undefined });
  });
});

it("bounds aggregate text and attachment count before any download", () => {
  const decode = (parts: unknown[]) => parseTransportPayload(JSON.stringify({ ...message, parts }), "structured-v1" as never);
  expect(() => decode(Array.from({ length: 9 }, () => message.parts[1]))).toThrow(/limit/);
  expect(() => decode([{ type: "text", text: "世".repeat(400_000) }])).toThrow(/limit/);
});


it("keeps the legacy envelope's complete golden byte sequence", () => {
  const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
  const now = vi.spyOn(Date, "now").mockReturnValue(123);
  try {
    expect(serializeForTransport({ ...base, format: "envelope", replyRoute: { topic: "reply/topic" } })).toBe('{"version":"1","message":{"messageId":"mqtt-00000000-0000-4000-8000-000000000001","traceId":"00000000-0000-4000-8000-000000000001","timestamp":123,"source":{"channel":"mqtt","accountId":"default","userId":"peer","chatType":"direct"},"contentType":"text","text":"legacy","media":[],"direction":"outbound"},"headers":{"replyRoute":{"topic":"reply/topic"}}}');
  } finally { uuid.mockRestore(); now.mockRestore(); }
});
