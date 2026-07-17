import { describe, expect, it } from "vitest";

import {
  WEBSOCKET_PROTOCOL_VERSION,
  parseClientFrame,
  serializeConnectedFrame,
  serializeEnvelopeReplyFrame,
  serializeReplyFrame,
} from "../src/transport/protocol.js";

describe("parseClientFrame", () => {
  it("parses message JSON frame with peerId", () => {
    const result = parseClientFrame(
      JSON.stringify({ type: "message", text: "hello", peerId: "user-1" }),
    );
    expect(result).toEqual({
      text: "hello",
      agentId: undefined,
      messageId: undefined,
      peerId: "user-1",
    });
  });

  it("parses message JSON frame", () => {
    const result = parseClientFrame(
      JSON.stringify({ type: "message", text: "hello", agentId: "a1" }),
    );
    expect(result).toEqual({ text: "hello", agentId: "a1", messageId: undefined });
  });

  it("accepts plain text as message body", () => {
    expect(parseClientFrame("plain hello")).toEqual({ text: "plain hello" });
  });

  it("returns ping for ping frame", () => {
    expect(parseClientFrame(JSON.stringify({ type: "ping" }))).toBe("ping");
  });

  it("rejects oversized or control-character routing identifiers", () => {
    expect(parseClientFrame(JSON.stringify({ type: "message", text: "hello", peerId: "x".repeat(257) }))).toBeNull();
    expect(parseClientFrame(JSON.stringify({ type: "message", text: "hello", messageId: "bad\nvalue" }))).toBeNull();
  });
});

describe("serialize frames", () => {
  it("serializes connected and reply", () => {
    expect(JSON.parse(serializeConnectedFrame("cid-1"))).toMatchObject({
      version: WEBSOCKET_PROTOCOL_VERSION,
      type: "connected",
      connectionId: "cid-1",
    });
    expect(JSON.parse(serializeReplyFrame("hi", { sessionKey: "sk" }))).toMatchObject({
      type: "reply",
      text: "hi",
      sessionKey: "sk",
      version: WEBSOCKET_PROTOCOL_VERSION,
    });
  });

  it("rejects an explicitly unsupported protocol version", () => {
    expect(parseClientFrame(JSON.stringify({ version: "2", type: "message", text: "hello" }))).toBeNull();
  });

  it("wraps a message-sdk envelope as a versioned reply frame", () => {
    expect(JSON.parse(serializeEnvelopeReplyFrame(JSON.stringify({ message: { text: "hi" } }), { messageId: "m-1" }))).toMatchObject({
      version: "1",
      type: "reply",
      messageId: "m-1",
      message: { text: "hi" },
    });
  });
});
