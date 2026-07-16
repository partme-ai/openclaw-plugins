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
      const cfg = {
        channels: { "redis-stream": { url: "redis://localhost:6379" } },
      };
      const account = redisStreamChannel.config.resolveAccount(cfg);
      expect(
        redisStreamChannel.config.isConfigured?.(account, cfg),
      ).toBe(true);
    });

    it("passes the resolved account to the OpenClaw configuration contract", () => {
      const cfg = {
          channels: { "redis-stream": { url: "redis://localhost:6379" } },
      };
      const account = redisStreamChannel.config.resolveAccount(cfg);

      expect(account.config.url).toBe("redis://localhost:6379");
      expect(redisStreamChannel.config.isConfigured?.(account, cfg)).toBe(true);
    });

    it("isConfigured returns false without url", () => {
      const account = redisStreamChannel.config.resolveAccount({});
      expect(redisStreamChannel.config.isConfigured?.(account, {})).toBe(false);
    });

    it("unconfiguredReason returns message without url", () => {
      const account = redisStreamChannel.config.resolveAccount({});
      const reason = redisStreamChannel.config.unconfiguredReason?.(account, {});
      expect(reason).toContain("url");
    });

    it("does not use unconfiguredReason for configured accounts", () => {
      const cfg = {
        channels: { "redis-stream": { url: "redis://localhost:6379" } },
      };
      const account = redisStreamChannel.config.resolveAccount(cfg);
      expect(redisStreamChannel.config.isConfigured?.(account, cfg)).toBe(true);
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
    it("builds account snapshot", async () => {
      const cfg = {
        channels: { "redis-stream": { url: "redis://localhost:6379" } },
      };
      const account = redisStreamChannel.config.resolveAccount(cfg);
      const snapshot = await redisStreamChannel.status?.buildAccountSnapshot?.({
        account,
        cfg,
      });
      expect(snapshot).toBeDefined();
      expect(snapshot.accountId).toBe("default");
      expect(snapshot.configured).toBe(true);
      expect(snapshot.extra).toBeDefined();
      expect(snapshot.extra!.stats).toBeDefined();
      expect(snapshot.extra!.stats.connected).toBeDefined();
    });
  });
});
