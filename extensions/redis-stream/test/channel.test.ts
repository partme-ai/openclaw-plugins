/**
 * Channel 插件集成测试。
 */
import { describe, it, expect } from "vitest";
import { redisStreamChannel } from "../src/channel.js";

describe("redisStreamChannel", () => {
  it("has correct channel id", () => {
    expect(redisStreamChannel.id).toBe("redis-stream");
  });

  it("declares direct chat type support", () => {
    expect(redisStreamChannel.capabilities.chatTypes).toContain("direct");
  });

  it("has config reload prefix", () => {
    expect(redisStreamChannel.reload?.configPrefixes).toContain("channels.redis-stream");
  });

  describe("config", () => {
    it("lists default account", () => {
      const accounts = redisStreamChannel.config.listAccountIds();
      expect(accounts).toEqual(["default"]);
    });

    it("resolves account as configured when url is present", () => {
      const result = redisStreamChannel.config.resolveAccount({
        channels: { "redis-stream": { url: "redis://localhost:6379" } },
      });
      expect(result.configured).toBe(true);
    });

    it("resolves account as not configured when url is missing", () => {
      const result = redisStreamChannel.config.resolveAccount({});
      expect(result.configured).toBe(false);
    });

    it("isConfigured returns true when url present", () => {
      expect(
        redisStreamChannel.config.isConfigured({
          channels: { "redis-stream": { url: "redis://localhost:6379" } },
        }),
      ).toBe(true);
    });

    it("isConfigured returns false without url", () => {
      expect(redisStreamChannel.config.isConfigured({})).toBe(false);
    });

    it("unconfiguredReason returns message without url", () => {
      const reason = redisStreamChannel.config.unconfiguredReason({});
      expect(reason).toContain("url");
    });

    it("unconfiguredReason returns null with url", () => {
      const reason = redisStreamChannel.config.unconfiguredReason({
        channels: { "redis-stream": { url: "redis://localhost:6379" } },
      });
      expect(reason).toBeNull();
    });
  });

  describe("threading", () => {
    it("resolves replyToMode as off", () => {
      const mode = redisStreamChannel.threading?.resolveReplyToMode?.();
      expect(mode).toBe("off");
    });
  });

  describe("groups", () => {
    it("does not require mention", () => {
      const required = redisStreamChannel.groups?.resolveRequireMention?.();
      expect(required).toBe(false);
    });
  });

  describe("status", () => {
    it("builds account snapshot", () => {
      const snapshot = redisStreamChannel.status.buildAccountSnapshot({
        channels: { "redis-stream": { url: "redis://localhost:6379" } },
      });
      expect(snapshot.accountId).toBe("default");
      expect(snapshot.configured).toBe(true);
      expect(snapshot.extra).toBeDefined();
      expect(snapshot.extra!.stats).toBeDefined();
      expect(snapshot.extra!.stats.connected).toBeDefined();
    });
  });
});
