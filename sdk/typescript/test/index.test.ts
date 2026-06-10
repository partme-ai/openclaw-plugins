import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildEnvelope,
  buildMessage,
  parseEnvelope,
  parseTransportPayload,
  serializeEnvelope,
  serializeForTransport,
} from "../src/index.js";

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
    assert.equal(parsed?.version, "1");
    assert.equal(parsed?.message.text, "hello");
    assert.equal(parsed?.headers?.correlationId, "c-1");
    assert.equal(parsed?.headers?.replyRoute?.topic, "reply/x");
  });
});

describe("parseTransportPayload", () => {
  it("parses envelope json", () => {
    const msg = buildMessage({ channel: "mqtt", accountId: "a", userId: "u", text: "hi" });
    const raw = serializeEnvelope(buildEnvelope(msg));
    const r = parseTransportPayload(raw, "jsonTextOrPlain");
    assert.equal(r.text, "hi");
    assert.equal(r.unified?.source.channel, "mqtt");
  });

  it("falls back to legacy text json", () => {
    const r = parseTransportPayload(JSON.stringify({ text: "legacy" }), "jsonTextOrPlain");
    assert.equal(r.text, "legacy");
  });

  it("plain mode returns raw", () => {
    assert.equal(parseTransportPayload("raw", "plain").text, "raw");
  });

  it("jsonOnly returns empty on invalid json", () => {
    assert.equal(parseTransportPayload("not-json", "jsonOnly").text, "");
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
    assert.equal(parsed?.message.text, "reply");
    assert.equal(parsed?.message.direction, "outbound");
  });

  it("legacyJsonText mode", () => {
    const wire = serializeForTransport({
      channel: "mqtt",
      accountId: "a",
      userId: "u",
      text: "x",
      format: "legacyJsonText",
    });
    assert.deepEqual(JSON.parse(wire), { text: "x" });
  });

  it("plainText mode", () => {
    const wire = serializeForTransport({
      channel: "mqtt",
      accountId: "a",
      userId: "u",
      text: "plain",
      format: "plainText",
    });
    assert.equal(wire, "plain");
  });
});
