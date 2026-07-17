import { describe, expect, it } from "vitest";
import { resolveAmapConfig } from "../src/config.js";

describe("resolveAmapConfig", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(resolveAmapConfig({}, {})).toBeNull();
  });

  it("reads the key from the canonical environment variable", () => {
    expect(resolveAmapConfig({ enabled: true }, { AMAP_WEB_SERVICE_KEY: "env-key" })?.key).toBe("env-key");
  });

  it("rejects unsafe base URLs and invalid bounds", () => {
    expect(() => resolveAmapConfig({ enabled: true, key: "k", apiBaseUrl: "http://example.com" }, {})).toThrow("HTTPS");
    expect(() => resolveAmapConfig({ enabled: true, key: "k", apiBaseUrl: "https://metadata.internal" }, {})).toThrow("official");
    expect(() => resolveAmapConfig({ enabled: true, key: "k", apiBaseUrl: "https://restapi.amap.com:8443" }, {})).toThrow("custom port");
    expect(() => resolveAmapConfig({ enabled: true, key: "k", retryAttempts: 4 }, {})).toThrow("retryAttempts");
    expect(() => resolveAmapConfig({ enabled: true, key: "k", maxResponseBytes: 1024, maxToolResultBytes: 2048 }, {})).toThrow("must not exceed");
  });

  it("allows loopback HTTP only for isolated protocol tests", () => {
    expect(resolveAmapConfig({ enabled: true, key: "k", apiBaseUrl: "http://127.0.0.1:19092" }, {})?.apiBaseUrl)
      .toBe("http://127.0.0.1:19092");
  });

  it("拒绝未知字段、隐式布尔值和过长环境密钥", () => {
    expect(() => resolveAmapConfig({ enabled: true, key: "k", extra: true }, {})).toThrow("unknown field");
    expect(() => resolveAmapConfig({ enabled: "true" }, {})).toThrow("enabled");
    expect(() => resolveAmapConfig({ enabled: true }, { AMAP_WEB_SERVICE_KEY: "x".repeat(257) })).toThrow("256");
    expect(() => resolveAmapConfig({ enabled: true, key: "unsafe\nkey" }, {})).toThrow("control characters");
  });

  it("when response bytes are reduced, derives a compatible tool-result limit", () => {
    expect(resolveAmapConfig({ enabled: true, key: "k", maxResponseBytes: 65_536 }, {})?.maxToolResultBytes).toBe(65_536);
  });
});
