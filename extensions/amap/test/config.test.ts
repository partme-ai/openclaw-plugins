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
    expect(() => resolveAmapConfig({ enabled: true, key: "k", retryAttempts: 4 }, {})).toThrow("retryAttempts");
  });
});
