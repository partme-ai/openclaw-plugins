import { describe, expect, it, vi } from "vitest";
import { createMeituanTool } from "../src/tools/tools.js";
import type { MeituanPluginConfig } from "../src/types.js";

const config: MeituanPluginConfig = {
  enabled: true,
  developerId: "123",
  signKey: "secret",
  appAuthToken: "token",
  apiBaseUrl: "https://api-open-cater.meituan.com",
  version: "2",
  operations: [{ name: "query", apiPath: "/query", businessId: 7, requiresAuth: true }],
  requestTimeoutMs: 1000,
  maxRequestBytes: 1024,
  maxResponseBytes: 1024,
  maxRequestsPerMinute: 10,
  ownerOnly: true,
};

describe("createMeituanTool", () => {
  it("exposes only configured operation names", () => {
    const tool = createMeituanTool({ senderIsOwner: true } as never, config, { invoke: vi.fn() } as never);
    expect(tool.name).toBe("meituan_openapi_invoke");
    expect((tool.parameters.properties as Record<string, any>).operation.enum).toEqual(["query"]);
  });

  it("enforces ownerOnly before invoking the client", async () => {
    const invoke = vi.fn();
    const tool = createMeituanTool({ senderIsOwner: false } as never, config, { invoke } as never);
    const response = await tool.execute("call", { operation: "query", biz: {} });
    expect(JSON.parse(response.content[0]!.text).error).toContain("owner");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects operations outside the allowlist", async () => {
    const invoke = vi.fn();
    const tool = createMeituanTool({ senderIsOwner: true } as never, config, { invoke } as never);
    const response = await tool.execute("call", { operation: "delete_all", biz: {} });
    expect(JSON.parse(response.content[0]!.text).success).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});
