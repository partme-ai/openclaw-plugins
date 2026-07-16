import { describe, expect, it } from "vitest";
import { resolveMeituanConfig } from "../src/config.js";

const operation = { name: "receipt_query", apiPath: "/api/receipt/query", businessId: 7 };

describe("resolveMeituanConfig", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(resolveMeituanConfig({}, {})).toBeNull();
  });

  it("reads credentials from canonical environment variables", () => {
    const config = resolveMeituanConfig(
      { enabled: true, operations: [operation] },
      { MEITUAN_DEVELOPER_ID: "123", MEITUAN_SIGN_KEY: "key", MEITUAN_APP_AUTH_TOKEN: "token" },
    );
    expect(config).toEqual(expect.objectContaining({
      developerId: "123",
      signKey: "key",
      appAuthToken: "token",
      apiBaseUrl: "https://api-open-cater.meituan.com",
      ownerOnly: true,
    }));
    expect(config?.operations[0]?.requiresAuth).toBe(true);
  });

  it("rejects unsafe endpoints, traversal and duplicate operation names", () => {
    const base = { enabled: true, developerId: "123", signKey: "key" };
    expect(() => resolveMeituanConfig({ ...base, apiBaseUrl: "http://example.com", operations: [operation] }, {})).toThrow("HTTPS");
    expect(() => resolveMeituanConfig({ ...base, operations: [{ ...operation, apiPath: "/api/../secret" }] }, {})).toThrow("traversal");
    expect(() => resolveMeituanConfig({ ...base, operations: [operation, operation] }, {})).toThrow("duplicated");
  });
});
