import { describe, expect, it } from "vitest";
import { resolveRednodeConfig } from "../src/config.js";

const operation = { name: "items", method: "GET", apiPath: "/ark/open_api/v1/items" };

describe("resolveRednodeConfig", () => {
  it("is disabled by default and reads canonical env credentials", () => {
    expect(resolveRednodeConfig({}, {})).toBeNull();
    const config = resolveRednodeConfig({ enabled: true, operations: [operation] }, { XHS_APP_KEY: "app", XHS_APP_SECRET: "secret" });
    expect(config).toEqual(expect.objectContaining({ apiBaseUrl: "https://ark.xiaohongshu.com", ownerOnly: true }));
  });

  it("uses the official sandbox only when selected", () => {
    const config = resolveRednodeConfig({ enabled: true, appKey: "a", appSecret: "s", environment: "sandbox", operations: [operation] }, {});
    expect(config?.apiBaseUrl).toBe("http://flssandbox.xiaohongshu.com");
  });

  it("rejects unsafe paths and base URLs", () => {
    const base = { enabled: true, appKey: "a", appSecret: "s" };
    expect(() => resolveRednodeConfig({ ...base, operations: [{ ...operation, apiPath: "/api/items" }] }, {})).toThrow("/ark/open_api/");
    expect(() => resolveRednodeConfig({ ...base, apiBaseUrl: "http://example.com", operations: [operation] }, {})).toThrow("HTTPS");
  });
});
