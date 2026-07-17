import { describe, expect, it, vi } from "vitest";
import { createMeituanTool } from "../src/tools/tools.js";
import type { MeituanPluginConfig } from "../src/types.js";

const config: MeituanPluginConfig = {
  enabled: true,
  developerId: "123",
  signKey: "secret",
  appAuthToken: "token",
  accounts: [],
  requireAccountBinding: false,
  accountBindingMatched: true,
  apiBaseUrl: "https://api-open-cater.meituan.com",
  version: "2",
  operations: [
    {
      name: "query",
      apiPath: "/query",
      businessId: 7,
      requiresAuth: true,
      riskLevel: "read",
      successCodes: ["OP_SUCCESS"],
    },
    {
      name: "refund",
      apiPath: "/refund",
      businessId: 8,
      requiresAuth: true,
      riskLevel: "write",
      successCodes: ["OP_SUCCESS"],
      idempotencyBizField: "orderId",
    },
  ],
  requestTimeoutMs: 1000,
  maxRequestBytes: 1024,
  maxResponseBytes: 1024,
  maxToolResultBytes: 1024,
  maxRequestsPerMinute: 10,
  maxConcurrentRequests: 8,
  readRetryMaxAttempts: 2,
  retryInitialDelayMs: 0,
  retryMaxDelayMs: 0,
  retryJitterRatio: 0,
  requireWriteIdempotency: true,
  idempotencyTtlMs: 60_000,
  maxIdempotencyEntries: 100,
  allowCustomApiBaseUrl: false,
  ownerOnly: true,
};

describe("createMeituanTool", () => {
  it("exposes only configured operation names", () => {
    const tool = createMeituanTool({ senderIsOwner: true } as never, config, {
      invoke: vi.fn(),
      getOperation: (name: string) =>
        config.operations.find((operation) => operation.name === name),
    } as never);
    expect(tool.name).toBe("meituan_openapi_invoke");
    expect(
      (tool.parameters.properties as Record<string, any>).operation.enum,
    ).toEqual(["query", "refund"]);
  });

  it("enforces ownerOnly before invoking the client", async () => {
    const invoke = vi.fn();
    const tool = createMeituanTool({ senderIsOwner: false } as never, config, {
      invoke,
      getOperation: vi.fn(),
    } as never);
    const response = await tool.execute("call", {
      operation: "query",
      biz: {},
    });
    expect(JSON.parse(response.content[0]!.text).error).toContain("owner");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects operations outside the allowlist", async () => {
    const invoke = vi.fn();
    const tool = createMeituanTool({ senderIsOwner: true } as never, config, {
      invoke,
      getOperation: (name: string) =>
        config.operations.find((operation) => operation.name === name),
    } as never);
    const response = await tool.execute("call", {
      operation: "delete_all",
      biz: {},
    });
    expect(JSON.parse(response.content[0]!.text).success).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation for write-risk operations", async () => {
    const invoke = vi.fn();
    const tool = createMeituanTool({ senderIsOwner: true } as never, config, {
      invoke,
      getOperation: (name: string) =>
        config.operations.find((operation) => operation.name === name),
    } as never);

    const denied = await tool.execute("call", {
      operation: "refund",
      biz: { orderId: "1" },
    });
    expect(JSON.parse(denied.content[0]!.text).error).toContain("confirm=true");
    expect(invoke).not.toHaveBeenCalled();

    await tool.execute("call", {
      operation: "refund",
      biz: { orderId: "1" },
      confirm: true,
    });
    expect(invoke).toHaveBeenCalledWith("refund", { orderId: "1" });
  });

  it("prevents an oversized business response from entering the Agent context", async () => {
    const tool = createMeituanTool({ senderIsOwner: true } as never, config, {
      invoke: vi.fn(async () => ({ code: "OP_SUCCESS", data: "门店".repeat(2_000) })),
      getOperation: (name: string) =>
        config.operations.find((operation) => operation.name === name),
    } as never);
    const response = await tool.execute("call", { operation: "query", biz: {} });
    expect(JSON.parse(response.content[0]!.text)).toEqual({
      success: false,
      error: "Meituan tool result exceeded maxToolResultBytes",
    });
  });

  it("sanitizes and bounds unexpected thrown values", async () => {
    const tool = createMeituanTool({ senderIsOwner: true } as never, config, {
      invoke: vi.fn(async () => { throw `bad\n${"x".repeat(1_000)}`; }),
      getOperation: (name: string) =>
        config.operations.find((operation) => operation.name === name),
    } as never);
    const response = await tool.execute("call", { operation: "query", biz: {} });
    const error = JSON.parse(response.content[0]!.text).error as string;
    expect(error).toBe("Meituan tool execution failed");
  });

  it("redacts credentials again at the Agent-visible Tool boundary", async () => {
    const tool = createMeituanTool({ senderIsOwner: true } as never, config, {
      invoke: vi.fn(async () => {
        throw new Error(`appAuthToken=${config.appAuthToken} signKey=${config.signKey} DeveloperId=${config.developerId}\nnext`);
      }),
      getOperation: (name: string) =>
        config.operations.find((operation) => operation.name === name),
    } as never);
    const response = await tool.execute("call", { operation: "query", biz: {} });
    const error = JSON.parse(response.content[0]!.text).error as string;
    expect(error).toContain("[REDACTED]");
    expect(error).not.toMatch(/\btoken\b|\bsecret\b|\b123\b|\n/u);
  });

  it("fails closed before network access when the trusted account has no credential binding", async () => {
    const invoke = vi.fn();
    const boundConfig = {
      ...config,
      appAuthToken: undefined,
      accounts: [{ accountId: "shop-a", appAuthToken: "token-a" }],
      requireAccountBinding: true,
      accountBindingMatched: false,
    };
    const tool = createMeituanTool({ senderIsOwner: true, agentAccountId: "shop-b" } as never, boundConfig, {
      invoke,
      getOperation: (name: string) =>
        boundConfig.operations.find((operation) => operation.name === name),
    } as never);
    const response = await tool.execute("call", { operation: "query", biz: {} });
    expect(JSON.parse(response.content[0]!.text).error).toContain("credential binding");
    expect(invoke).not.toHaveBeenCalled();
  });
});
