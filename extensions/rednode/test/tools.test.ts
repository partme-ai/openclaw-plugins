import { describe, expect, it, vi } from "vitest";
import { createRednodeTool } from "../src/tools/tools.js";
import type { RednodePluginConfig } from "../src/types.js";

const config: RednodePluginConfig = {
  enabled: true,
  appKey: "a",
  appSecret: "s",
  environment: "production",
  apiBaseUrl: "https://ark.xiaohongshu.com",
  operations: [
    { name: "items", method: "GET", apiPath: "/ark/open_api/v1/items" },
    {
      name: "availability",
      method: "PUT",
      apiPath: "/ark/open_api/v1/item/{item_id}/availability",
    },
  ],
  requestTimeoutMs: 1000,
  maxRequestBytes: 1024,
  maxResponseBytes: 1024,
  maxToolResultBytes: 1024,
  maxRequestsPerMinute: 10,
  maxConcurrentRequests: 2,
  getRetryMaxAttempts: 3,
  retryInitialDelayMs: 100,
  retryMaxDelayMs: 1000,
  retryJitterRatio: 0.2,
  allowCustomApiBaseUrl: false,
  ownerOnly: true,
};

describe("createRednodeTool", () => {
  it("exposes configured operations and enforces ownerOnly", async () => {
    const invoke = vi.fn();
    const tool = createRednodeTool({ senderIsOwner: false } as never, config, {
      invoke,
      getOperation: vi.fn(),
    } as never);
    expect(
      (tool.parameters.properties as Record<string, any>).operation.enum,
    ).toEqual(["items", "availability"]);
    const response = await tool.execute("call", { operation: "items" });
    expect(JSON.parse(response.content[0]!.text).error).toContain("owner");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation for write operations", async () => {
    const invoke = vi.fn();
    const client = {
      invoke,
      getOperation: (name: string) =>
        config.operations.find((item) => item.name === name),
    };
    const tool = createRednodeTool(
      { senderIsOwner: true } as never,
      config,
      client as never,
    );
    const response = await tool.execute("call", {
      operation: "availability",
      path_params: { item_id: "x" },
      body: { available: false },
    });
    expect(JSON.parse(response.content[0]!.text).error).toContain(
      "confirm=true",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("prevents oversized Ark responses from entering the Agent context", async () => {
    const tool = createRednodeTool({ senderIsOwner: true } as never, config, {
      invoke: vi.fn(async () => ({ success: true, data: "内容".repeat(2_000) })),
      getOperation: (name: string) => config.operations.find((item) => item.name === name),
    } as never);
    const response = await tool.execute("call", { operation: "items" });
    expect(JSON.parse(response.content[0]!.text)).toEqual({
      success: false,
      error: "Rednode tool result exceeded maxToolResultBytes",
    });
  });

  it("normalizes unexpected thrown values without echoing them", async () => {
    const tool = createRednodeTool({ senderIsOwner: true } as never, config, {
      invoke: vi.fn(async () => { throw `bad\n${"x".repeat(1_000)}`; }),
      getOperation: (name: string) => config.operations.find((item) => item.name === name),
    } as never);
    const response = await tool.execute("call", { operation: "items" });
    expect(JSON.parse(response.content[0]!.text).error).toBe("Rednode tool execution failed");
  });

  it("redacts credentials again at the final Agent Tool boundary", async () => {
    const tool = createRednodeTool({ senderIsOwner: true } as never, config, {
      invoke: vi.fn(async () => {
        throw new Error(`proxy https://alice:pass@example.test app-key=${config.appKey} app-secret=${config.appSecret} sign=deadbeef Bearer bearer-1`);
      }),
      getOperation: (name: string) => config.operations.find((item) => item.name === name),
    } as never);
    const response = await tool.execute("call", { operation: "items" });
    const error = JSON.parse(response.content[0]!.text).error as string;
    expect(error).toContain("[REDACTED]");
    expect(error).not.toMatch(/alice:pass|app-key=a|app-secret=s|deadbeef|bearer-1/u);
  });
});
