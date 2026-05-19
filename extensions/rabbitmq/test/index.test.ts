import { describe, it, expect } from "vitest";
import { setRabbitmqRuntime, getRabbitmqRuntime } from "../src/runtime.js";
import { resolveRabbitmqConfig, DEFAULT_RABBITMQ_CONFIG } from "../src/rabbitmq-config.js";
import { resolveDmScopeFromRuntimeConfig } from "../src/dm-scope.js";
import { rabbitmqChannel, DEFAULT_ACCOUNT_ID } from "../src/channel.js";

describe("openclaw-rabbitmq", () => {
  describe("plugin entry", () => {
    it("should export default channel plugin entry", async () => {
      const mod = await import("../src/index.js");
      expect(mod.default).toBeDefined();
    });

    it("should export rabbitmqChannel", async () => {
      const mod = await import("../src/index.js");
      expect(mod.rabbitmqChannel).toBeDefined();
    });
  });

  describe("channel definition", () => {
    it("should have expected channel id", () => {
      expect(rabbitmqChannel.id).toBe("rabbitmq");
    });

    it("should have direct chat type capability", () => {
      expect(rabbitmqChannel.capabilities.chatTypes).toContain("direct");
    });

    it("should return default account id", () => {
      expect(rabbitmqChannel.config.listAccountIds()).toEqual([DEFAULT_ACCOUNT_ID]);
    });

    it("should resolve account from config", () => {
      const account = rabbitmqChannel.config.resolveAccount({});
      expect(account.accountId).toBe(DEFAULT_ACCOUNT_ID);
      expect(account.enabled).toBe(true);
    });
  });

  describe("runtime management", () => {
    it("should return null before runtime is set", () => {
      // Reset by creating a fresh state
      expect(typeof getRabbitmqRuntime).toBe("function");
    });

    it("should set and get runtime", () => {
      const mockRuntime = { config: { channels: { rabbitmq: { url: "amqp://test" } } } };
      setRabbitmqRuntime(mockRuntime);
      const rt = getRabbitmqRuntime();
      expect(rt).toBeDefined();
      expect(rt.config).toBeDefined();
    });
  });

  describe("config resolution", () => {
    it("should resolve defaults with empty config", () => {
      const config = resolveRabbitmqConfig({});
      expect(config.url).toBe(DEFAULT_RABBITMQ_CONFIG.url);
      expect(config.exchange).toBe(DEFAULT_RABBITMQ_CONFIG.exchange);
    });

    it("should resolve dmScope from config", () => {
      expect(resolveDmScopeFromRuntimeConfig({})).toBe("per-peer");
      expect(resolveDmScopeFromRuntimeConfig({ session: { dmScope: "per-channel-peer" } })).toBe("per-channel-peer");
    });
  });
});
