import { describe, expect, it } from "vitest";
import { resolveRednodeConfig } from "../src/config.js";

const operation = {
  name: "items",
  method: "GET",
  apiPath: "/ark/open_api/v1/items",
};

describe("resolveRednodeConfig", () => {
  it("is disabled by default and reads canonical env credentials", () => {
    expect(resolveRednodeConfig({}, {})).toBeNull();
    const config = resolveRednodeConfig(
      { enabled: true, operations: [operation] },
      { XHS_APP_KEY: "app", XHS_APP_SECRET: "secret" },
    );
    expect(config).toEqual(
      expect.objectContaining({
        apiBaseUrl: "https://ark.xiaohongshu.com",
        ownerOnly: true,
      }),
    );
  });

  it("rejects non-object roots and string-shaped security booleans", () => {
    expect(() => resolveRednodeConfig([] as never, {})).toThrow("must be an object");
    const base = {
      enabled: true,
      appKey: "a",
      appSecret: "s",
      operations: [operation],
    };
    expect(() =>
      resolveRednodeConfig({ ...base, ownerOnly: "false" as never }, {}),
    ).toThrow("ownerOnly must be a boolean");
    expect(() =>
      resolveRednodeConfig(
        { ...base, allowCustomApiBaseUrl: "true" as never },
        {},
      ),
    ).toThrow("allowCustomApiBaseUrl must be a boolean");
    expect(() =>
      resolveRednodeConfig({ enabled: "true" as never }, {}),
    ).toThrow("enabled must be a boolean");
  });

  it("uses the official sandbox only when selected", () => {
    const config = resolveRednodeConfig(
      {
        enabled: true,
        appKey: "a",
        appSecret: "s",
        environment: "sandbox",
        operations: [operation],
      },
      {},
    );
    expect(config?.apiBaseUrl).toBe("http://flssandbox.xiaohongshu.com");
  });

  it("rejects unsafe paths and base URLs", () => {
    const base = { enabled: true, appKey: "a", appSecret: "s" };
    expect(() =>
      resolveRednodeConfig(
        { ...base, operations: [{ ...operation, apiPath: "/api/items" }] },
        {},
      ),
    ).toThrow("/ark/open_api/");
    expect(() =>
      resolveRednodeConfig(
        { ...base, apiBaseUrl: "http://example.com", operations: [operation] },
        {},
      ),
    ).toThrow("HTTPS");
  });

  it("fails closed on unknown fields and requires explicit trust for custom remote origins", () => {
    const base = {
      enabled: true,
      appKey: "a",
      appSecret: "s",
      operations: [operation],
    };
    expect(() =>
      resolveRednodeConfig({ ...base, requstTimeoutMs: 1000 }, {}),
    ).toThrow("unknown field");
    expect(() =>
      resolveRednodeConfig(
        {
          ...base,
          operations: [{ ...operation, methd: "GET" }],
        },
        {},
      ),
    ).toThrow("unknown field");
    expect(() =>
      resolveRednodeConfig(
        {
          ...base,
          apiBaseUrl: "https://proxy.example.com",
        },
        {},
      ),
    ).toThrow("allowCustomApiBaseUrl=true");
    expect(
      resolveRednodeConfig(
        {
          ...base,
          apiBaseUrl: "https://proxy.example.com",
          allowCustomApiBaseUrl: true,
        },
        {},
      )?.apiBaseUrl,
    ).toBe("https://proxy.example.com");
  });

  it("validates GET retry bounds and relationships", () => {
    const base = {
      enabled: true,
      appKey: "a",
      appSecret: "s",
      operations: [operation],
    };
    expect(() =>
      resolveRednodeConfig({ ...base, getRetryMaxAttempts: 0 }, {}),
    ).toThrow("getRetryMaxAttempts");
    expect(() =>
      resolveRednodeConfig({ ...base, retryJitterRatio: 2 }, {}),
    ).toThrow("retryJitterRatio");
    expect(() =>
      resolveRednodeConfig(
        {
          ...base,
          retryInitialDelayMs: 1000,
          retryMaxDelayMs: 500,
        },
        {},
      ),
    ).toThrow("retryMaxDelayMs");
  });

  it("validates credential hygiene and Tool result bounds", () => {
    const base = {
      enabled: true,
      appKey: "a",
      appSecret: "s",
      operations: [operation],
    };
    expect(() => resolveRednodeConfig({ ...base, appSecret: "bad\nsecret" }, {})).toThrow();
    expect(() => resolveRednodeConfig({
      enabled: true,
      appSecret: "s",
      operations: [operation],
    }, { XHS_APP_KEY: "bad\nkey" })).toThrow("control characters");
    expect(resolveRednodeConfig({ ...base, maxResponseBytes: 65_536 }, {})?.maxToolResultBytes)
      .toBe(65_536);
    expect(() => resolveRednodeConfig({
      ...base,
      maxResponseBytes: 1_024,
      maxToolResultBytes: 2_048,
    }, {})).toThrow("must not exceed");
  });
});
