/**
 * normalize.test.ts — 入站 payload 解析、策略链与 UnifiedMessage 归一化。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import { describe, expect, it } from "vitest";
import {
  CHANNEL_CLASS_WIRE,
  CHANNEL_CLASS_TRANSCRIPT,
  isWireChannelClass,
  isTranscriptChannelClass,
} from "../core/channel-class.js";
import { normalizeIngress } from "./normalize.js";

describe("normalizeIngress", () => {
  it("builds a UnifiedMessage from channel-neutral ingress fields", () => {
    const unified = normalizeIngress({
      channel: "gotify",
      accountId: "default",
      peerId: "42",
      text: "hello",
      metadata: { id: 1, appid: 5 },
    });

    expect(unified.text).toBe("hello");
    expect(unified.source.channel).toBe("gotify");
    expect(unified.source.userId).toBe("42");
  });

  it("accepts userId as the canonical peer field", () => {
    const unified = normalizeIngress({
      channel: "mqtt",
      accountId: "default",
      userId: "device-7",
      text: "ping",
    });

    expect(unified.text).toBe("ping");
    expect(unified.source.accountId).toBe("default");
    expect(unified.source.userId).toBe("device-7");
  });

  it("rejects missing peer identity", () => {
    expect(() =>
      normalizeIngress({
        channel: "mqtt",
        accountId: "default",
        text: "ping",
      }),
    ).toThrow(/userId or peerId/);
  });
});

describe("ChannelClass constants", () => {
  it("identifies wire vs transcript", () => {
    expect(isWireChannelClass(CHANNEL_CLASS_WIRE)).toBe(true);
    expect(isTranscriptChannelClass(CHANNEL_CLASS_TRANSCRIPT)).toBe(true);
    expect(isWireChannelClass(CHANNEL_CLASS_TRANSCRIPT)).toBe(false);
  });
});
