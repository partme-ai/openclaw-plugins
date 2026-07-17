import { describe, expect, it } from "vitest";
import { bindMeituanAccount, resolveMeituanConfig } from "../src/config.js";

const operation = {
  name: "receipt_query",
  apiPath: "/api/receipt/query",
  businessId: 7,
  idempotencyBizField: "requestId",
};

describe("resolveMeituanConfig", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(resolveMeituanConfig({}, {})).toBeNull();
    expect(() => resolveMeituanConfig([] as never, {})).toThrow("object");
    expect(() => resolveMeituanConfig({ enabled: "true" } as never, {})).toThrow("boolean");
  });

  it("reads credentials from canonical environment variables", () => {
    const config = resolveMeituanConfig(
      { enabled: true, operations: [operation] },
      {
        MEITUAN_DEVELOPER_ID: "123",
        MEITUAN_SIGN_KEY: "key",
        MEITUAN_APP_AUTH_TOKEN: "token",
      },
    );
    expect(config).toEqual(
      expect.objectContaining({
        developerId: "123",
        signKey: "key",
        appAuthToken: "token",
        apiBaseUrl: "https://api-open-cater.meituan.com",
        ownerOnly: true,
      }),
    );
    expect(config?.operations[0]?.requiresAuth).toBe(true);
    expect(config?.operations[0]).toEqual(
      expect.objectContaining({
        riskLevel: "write",
        successCodes: ["OP_SUCCESS"],
        idempotencyBizField: "requestId",
      }),
    );
    expect(config).toEqual(
      expect.objectContaining({
        maxConcurrentRequests: 8,
        readRetryMaxAttempts: 2,
        retryInitialDelayMs: 250,
        retryMaxDelayMs: 2_000,
        retryJitterRatio: 0.2,
        requireWriteIdempotency: true,
        idempotencyTtlMs: 86_400_000,
        maxIdempotencyEntries: 10_000,
      }),
    );
  });

  it("rejects unsafe endpoints, traversal and duplicate operation names", () => {
    const base = { enabled: true, developerId: "123", signKey: "key" };
    expect(() =>
      resolveMeituanConfig(
        { ...base, apiBaseUrl: "http://example.com", operations: [operation] },
        {},
      ),
    ).toThrow("HTTPS");
    expect(() =>
      resolveMeituanConfig(
        { ...base, operations: [{ ...operation, apiPath: "/api/../secret" }] },
        {},
      ),
    ).toThrow("traversal");
    expect(() =>
      resolveMeituanConfig({ ...base, operations: [operation, operation] }, {}),
    ).toThrow("duplicated");
  });

  it("fails closed on unknown fields and protects non-official remote origins", () => {
    const base = {
      enabled: true,
      developerId: "123",
      signKey: "key",
      operations: [operation],
    };
    expect(() =>
      resolveMeituanConfig({ ...base, requstTimeoutMs: 1000 }, {}),
    ).toThrow("unknown field");
    expect(() =>
      resolveMeituanConfig({ ...base, ownerOnly: "false" } as never, {}),
    ).toThrow("boolean");
    expect(() =>
      resolveMeituanConfig({ ...base, allowCustomApiBaseUrl: "true" } as never, {}),
    ).toThrow("boolean");
    expect(() =>
      resolveMeituanConfig(
        {
          ...base,
          operations: [{ ...operation, riskLevl: "read" }],
        },
        {},
      ),
    ).toThrow("unknown field");
    expect(() =>
      resolveMeituanConfig(
        {
          ...base,
          apiBaseUrl: "https://proxy.example.com",
        },
        {},
      ),
    ).toThrow("allowCustomApiBaseUrl=true");
    expect(
      resolveMeituanConfig(
        {
          ...base,
          apiBaseUrl: "https://proxy.example.com",
          allowCustomApiBaseUrl: true,
        },
        {},
      )?.apiBaseUrl,
    ).toBe("https://proxy.example.com");
  });

  it("validates operation risk levels, success codes and protocol version", () => {
    const base = { enabled: true, developerId: "123", signKey: "key" };
    expect(() =>
      resolveMeituanConfig(
        {
          ...base,
          operations: [{ ...operation, riskLevel: "dangerous" }],
        },
        {},
      ),
    ).toThrow("riskLevel");
    expect(() =>
      resolveMeituanConfig(
        {
          ...base,
          operations: [{ ...operation, successCodes: [] }],
        },
        {},
      ),
    ).toThrow("successCodes");
    expect(() =>
      resolveMeituanConfig(
        {
          ...base,
          version: "2\nunsafe",
          operations: [operation],
        },
        {},
      ),
    ).toThrow("version");
    expect(() =>
      resolveMeituanConfig(
        {
          ...base,
          operations: [{ ...operation, requiresAuth: "false" }],
        } as never,
        {},
      ),
    ).toThrow("boolean");
  });

  it("requires a top-level idempotency field for writes by default", () => {
    const base = { enabled: true, developerId: "123", signKey: "key" };
    const withoutIdempotency = {
      name: "refund",
      apiPath: "/api/refund",
      businessId: 8,
      riskLevel: "write",
    };
    expect(() =>
      resolveMeituanConfig({ ...base, operations: [withoutIdempotency] }, {}),
    ).toThrow("requires idempotencyBizField");
    expect(() =>
      resolveMeituanConfig(
        {
          ...base,
          operations: [
            { ...operation, riskLevel: "read", idempotencyBizField: "requestId" },
          ],
        },
        {},
      ),
    ).toThrow("only valid for write");
    expect(
      resolveMeituanConfig(
        {
          ...base,
          requireWriteIdempotency: false,
          operations: [withoutIdempotency],
        },
        {},
      )?.operations[0]?.riskLevel,
    ).toBe("write");
  });

  it("validates retry, concurrency and idempotency capacity boundaries", () => {
    const base = {
      enabled: true,
      developerId: "123",
      signKey: "key",
      operations: [operation],
    };
    expect(() => resolveMeituanConfig({ ...base, maxConcurrentRequests: 0 }, {})).toThrow(
      "maxConcurrentRequests",
    );
    expect(() =>
      resolveMeituanConfig(
        { ...base, retryInitialDelayMs: 500, retryMaxDelayMs: 100 },
        {},
      ),
    ).toThrow("retryMaxDelayMs");
    expect(() => resolveMeituanConfig({ ...base, retryJitterRatio: 1.1 }, {})).toThrow(
      "retryJitterRatio",
    );
    expect(() => resolveMeituanConfig({ ...base, maxIdempotencyEntries: 0 }, {})).toThrow(
      "maxIdempotencyEntries",
    );
  });

  it("validates secret hygiene and derives a compatible Tool result limit", () => {
    const base = {
      enabled: true,
      developerId: "123",
      signKey: "key",
      operations: [operation],
    };
    expect(() => resolveMeituanConfig({ ...base, signKey: "bad\nkey" }, {})).toThrow();
    expect(() => resolveMeituanConfig({ ...base }, {
      MEITUAN_APP_AUTH_TOKEN: "bad\ntoken",
    })).toThrow("control characters");
    expect(resolveMeituanConfig({ ...base, maxResponseBytes: 65_536 }, {})?.maxToolResultBytes)
      .toBe(65_536);
    expect(() => resolveMeituanConfig({
      ...base,
      maxResponseBytes: 1_024,
      maxToolResultBytes: 2_048,
    }, {})).toThrow("must not exceed");
  });

  it("binds per-shop tokens only from trusted agentAccountId", () => {
    const config = resolveMeituanConfig({
      enabled: true,
      developerId: "123",
      signKey: "key",
      appAuthToken: "fallback-token",
      accounts: [
        { accountId: "shop-a", appAuthTokenEnv: "MEITUAN_SHOP_A_TOKEN" },
        { accountId: "shop-b", appAuthToken: "token-b" },
      ],
      operations: [operation],
    }, { MEITUAN_SHOP_A_TOKEN: "token-a" });
    expect(config?.requireAccountBinding).toBe(true);
    expect(bindMeituanAccount(config!, "shop-a").appAuthToken).toBe("token-a");
    expect(bindMeituanAccount(config!, "shop-b").appAuthToken).toBe("token-b");
    expect(bindMeituanAccount(config!, "shop-c").appAuthToken).toBeUndefined();
  });

  it("rejects duplicate or ambiguous account credential definitions", () => {
    const base = {
      enabled: true,
      developerId: "123",
      signKey: "key",
      operations: [operation],
    };
    expect(() => resolveMeituanConfig({
      ...base,
      accounts: [
        { accountId: "shop-a", appAuthToken: "a" },
        { accountId: "shop-a", appAuthToken: "b" },
      ],
    }, {})).toThrow("duplicated");
    expect(() => resolveMeituanConfig({
      ...base,
      accounts: [{ accountId: "shop-a", appAuthToken: "a", appAuthTokenEnv: "TOKEN_A" }],
    }, { TOKEN_A: "b" })).toThrow("only one");
  });
});
