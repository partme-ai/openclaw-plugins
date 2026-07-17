import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createMockPluginApi } from "../../../test-utils/mock-plugin-api.js";
import { createManifestSmokeTests, pluginRootFromTestFile } from "../../../test-utils/plugin-manifest.js";
import plugin from "../src/index.js";

createManifestSmokeTests(pluginRootFromTestFile(import.meta.url), {
  expectedId: "meituan",
  requireChannels: false,
});

afterEach(() => vi.unstubAllGlobals());

describe("meituan plugin entry", () => {
  it("declares the registered tool contract", () => {
    const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));
    expect(manifest.contracts.tools).toEqual(["meituan_openapi_invoke"]);
  });

  it("registers one tool and no channel or route when enabled", () => {
    const registerHttpRoute = vi.fn();
    const registerChannel = vi.fn();
    const api = createMockPluginApi({ registerHttpRoute, registerChannel });
    (api as any).pluginConfig = {
      enabled: true,
      developerId: "123",
      signKey: "key",
      operations: [{ name: "query", apiPath: "/query", businessId: 1, requiresAuth: false }],
    };
    (api as any).logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    plugin.register(api as never);
    expect(api.registerTool).toHaveBeenCalledTimes(1);
    expect(registerChannel).not.toHaveBeenCalled();
    expect(registerHttpRoute).not.toHaveBeenCalled();
  });

  it("binds the runtime trusted agentAccountId to the matching shop token", async () => {
    const api = createMockPluginApi();
    (api as any).pluginConfig = {
      enabled: true,
      developerId: "123",
      signKey: "key",
      accounts: [
        { accountId: "shop-a", appAuthToken: "token-a" },
        { accountId: "shop-b", appAuthToken: "token-b" },
      ],
      operations: [{ name: "query", apiPath: "/query", businessId: 1, requiresAuth: true, riskLevel: "read" }],
    };
    (api as any).logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: "OP_SUCCESS" })));
    vi.stubGlobal("fetch", fetchMock);
    plugin.register(api as never);

    const factory = vi.mocked(api.registerTool).mock.calls[0]![0] as (ctx: unknown) => {
      execute: (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }>;
    };
    const tool = factory({ senderIsOwner: true, agentAccountId: "shop-b" });
    await tool.execute("call", { operation: "query", biz: {} });
    const form = new URLSearchParams(String(fetchMock.mock.calls[0]![1]?.body));
    expect(form.get("appAuthToken")).toBe("token-b");
    expect(form.toString()).not.toContain("token-a");
  });
});
