import { describe, expect, it } from "vitest";
import {
  CHANNEL_CLASS_WIRE,
  CHANNEL_CLASS_TRANSCRIPT,
  isWireChannelClass,
  isTranscriptChannelClass,
} from "../core/channel-class.js";
import { normalizeGotifyIngress, normalizeIngress } from "./normalize.js";

describe("normalizeGotifyIngress", () => {
  it("wraps gotifyStreamToUnified", () => {
    const unified = normalizeGotifyIngress({
      accountId: "default",
      peerId: "42",
      message: { id: 1, appid: 5, message: "hello" },
    });

    expect(unified.text).toBe("hello");
    expect(unified.source.channel).toBe("gotify");
    expect(unified.source.userId).toBe("42");
  });
});

describe("normalizeIngress", () => {
  it("routes gotify channel to normalizeGotifyIngress", () => {
    const unified = normalizeIngress({
      channel: "gotify",
      accountId: "default",
      peerId: "7",
      payload: { id: 2, message: "ping" },
    });

    expect(unified.text).toBe("ping");
    expect(unified.source.accountId).toBe("default");
  });
});

describe("ChannelClass constants", () => {
  it("identifies wire vs transcript", () => {
    expect(isWireChannelClass(CHANNEL_CLASS_WIRE)).toBe(true);
    expect(isTranscriptChannelClass(CHANNEL_CLASS_TRANSCRIPT)).toBe(true);
    expect(isWireChannelClass(CHANNEL_CLASS_TRANSCRIPT)).toBe(false);
  });
});
