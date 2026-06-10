import { describe, expect, it } from "vitest";

import {
  parseClientFrame,
  serializeConnectedFrame,
  serializeReplyFrame,
} from "../src/protocol.js";

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
});

describe("serialize frames", () => {
  it("serializes connected and reply", () => {
    expect(JSON.parse(serializeConnectedFrame("cid-1"))).toMatchObject({
      type: "connected",
      connectionId: "cid-1",
    });
    expect(JSON.parse(serializeReplyFrame("hi", { sessionKey: "sk" }))).toMatchObject({
      type: "reply",
      text: "hi",
      sessionKey: "sk",
    });
  });
});
