import { describe, expect, it } from "vitest";
import {
  resolveTrustedQrRedirectBaseUrl,
  validateTrustedLoginBaseUrl,
  validateWeixinApiBaseUrl,
  validateWeixinCdnBaseUrl,
  validateWeixinCdnUploadUrl,
} from "../../src/api/endpoint-policy.js";

describe("Weixin credential endpoint policy", () => {
  it("accepts only official API/CDN defaults without an explicit custom trust flag", () => {
    expect(validateWeixinApiBaseUrl("https://ilinkai.weixin.qq.com")).toBe("https://ilinkai.weixin.qq.com");
    expect(validateWeixinCdnBaseUrl("https://novac2c.cdn.weixin.qq.com/c2c")).toBe("https://novac2c.cdn.weixin.qq.com/c2c");
    expect(() => validateWeixinApiBaseUrl("https://proxy.example.com")).toThrow("allowCustomApiBaseUrl=true");
    expect(() => validateWeixinCdnBaseUrl("https://cdn.example.com/c2c")).toThrow("allowCustomCdnBaseUrl=true");
  });

  it("allows an explicitly trusted HTTPS proxy and loopback HTTP only for isolated tests", () => {
    expect(validateWeixinApiBaseUrl("https://proxy.example.com", true)).toBe("https://proxy.example.com");
    expect(validateWeixinApiBaseUrl("http://127.0.0.1:19095", true)).toBe("http://127.0.0.1:19095");
    expect(() => validateWeixinApiBaseUrl("http://127.0.0.1:19095")).toThrow("allowCustomApiBaseUrl=true");
  });

  it("rejects credential URLs with embedded credentials or path confusion", () => {
    expect(() => validateWeixinApiBaseUrl("https://user:pass@ilinkai.weixin.qq.com")).toThrow("credentials");
    expect(() => validateWeixinApiBaseUrl("https://ilinkai.weixin.qq.com/evil")).toThrow("without a path");
  });

  it("accepts only Tencent-controlled QR redirects and official login base URLs", () => {
    expect(resolveTrustedQrRedirectBaseUrl("shard.ilink.weixin.qq.com")).toBe("https://shard.ilink.weixin.qq.com");
    expect(() => resolveTrustedQrRedirectBaseUrl("attacker.example.com")).toThrow("not an official");
    expect(validateTrustedLoginBaseUrl(undefined)).toBe("https://ilinkai.weixin.qq.com");
    expect(() => validateTrustedLoginBaseUrl("https://attacker.example.com")).toThrow("official iLink host");
  });

  it("binds server-supplied CDN upload URLs to the configured origin and upload path", () => {
    expect(
      validateWeixinCdnUploadUrl(
        "https://cdn.example/c2c/upload?encrypted_query_param=x",
        "https://cdn.example/c2c",
      ),
    ).toBe("https://cdn.example/c2c/upload?encrypted_query_param=x");
    expect(() =>
      validateWeixinCdnUploadUrl(
        "https://attacker.example/c2c/upload?encrypted_query_param=x",
        "https://cdn.example/c2c",
      ),
    ).toThrow("configured CDN origin");
    expect(() =>
      validateWeixinCdnUploadUrl("https://cdn.example/other", "https://cdn.example/c2c"),
    ).toThrow("configured CDN upload path");
  });
});
