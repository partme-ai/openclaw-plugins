import { describe, it, expect } from "vitest";
import { WeixinConfigSchema } from "../../src/config/config-schema.js";

describe("WeixinConfigSchema", () => {
  it("rejects non-HTTPS API and CDN endpoints", () => {
    expect(() => WeixinConfigSchema.parse({ baseUrl: "http://example.com" })).toThrow("HTTPS");
    expect(() => WeixinConfigSchema.parse({ cdnBaseUrl: "http://example.com" })).toThrow("HTTPS");
  });
  it("parses minimal config with defaults", () => {
    const result = WeixinConfigSchema.parse({});
    expect(result.baseUrl).toBe("https://ilinkai.weixin.qq.com");
    expect(result.cdnBaseUrl).toBe("https://novac2c.cdn.weixin.qq.com/c2c");
  });

  it("accepts custom baseUrl and cdnBaseUrl only with explicit trust flags", () => {
    expect(() => WeixinConfigSchema.parse({ baseUrl: "https://custom.api.com" })).toThrow("allowCustomApiBaseUrl=true");
    const result = WeixinConfigSchema.parse({
      baseUrl: "https://custom.api.com",
      cdnBaseUrl: "https://custom.cdn.com",
      allowCustomApiBaseUrl: true,
      allowCustomCdnBaseUrl: true,
    });
    expect(result.baseUrl).toBe("https://custom.api.com");
    expect(result.cdnBaseUrl).toBe("https://custom.cdn.com");
  });

  it("accepts optional name and enabled fields", () => {
    const result = WeixinConfigSchema.parse({
      name: "my-bot",
      enabled: false,
    });
    expect(result.name).toBe("my-bot");
    expect(result.enabled).toBe(false);
  });

  it("parses and bounds the static allowFrom list", () => {
    const result = WeixinConfigSchema.parse({ allowFrom: [" user-a ", "user-b"] });
    expect(result.allowFrom).toEqual(["user-a", "user-b"]);
    expect(() => WeixinConfigSchema.parse({ allowFrom: ["x".repeat(257)] })).toThrow();
  });

  it("accepts accounts map", () => {
    const result = WeixinConfigSchema.parse({
      accounts: {
        "acc1": { name: "Bot 1", enabled: true },
        "acc2": { name: "Bot 2" },
      },
    });
    expect(result.accounts?.acc1?.name).toBe("Bot 1");
    expect(result.accounts?.acc2?.name).toBe("Bot 2");
  });

  it("rejects invalid types", () => {
    expect(() => WeixinConfigSchema.parse({ enabled: "yes" })).toThrow();
    expect(() => WeixinConfigSchema.parse({ unknownOption: true })).toThrow();
    expect(() => WeixinConfigSchema.parse({ accounts: { acc1: { unknownOption: true } } })).toThrow();
  });
});
