import { afterEach, describe, expect, it, vi } from "vitest";
import { RednodeClient, signRednodeRequest } from "../src/agent/xhs-api.js";
import type { RednodePluginConfig } from "../src/types.js";

const config: RednodePluginConfig = {
  enabled: true, appKey: "xhs", appSecret: "9a539709cafc1efc9ef05838be468a28", environment: "production",
  apiBaseUrl: "https://ark.xiaohongshu.com",
  operations: [
    { name: "items", method: "GET", apiPath: "/ark/open_api/v1/items" },
    { name: "availability", method: "PUT", apiPath: "/ark/open_api/v1/item/{item_id}/availability" },
  ],
  requestTimeoutMs: 1000, maxRequestBytes: 1024, maxResponseBytes: 1024, maxRequestsPerMinute: 10, ownerOnly: false,
};

afterEach(() => vi.unstubAllGlobals());

describe("RednodeClient", () => {
  it("reproduces the signature published in the official RED example", () => {
    expect(signRednodeRequest("/ark/open_api/v1/items", {
      status: "0", page_no: "1", page_size: "50", timestamp: "1469902537", "app-key": "xhs",
    }, config.appSecret)).toBe("72be6fad4dd0e5104dbdebbcdadb2a06");
  });

  it("uses Ark headers, signed query and path templates", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} })));
    vi.stubGlobal("fetch", fetchMock);
    await new RednodeClient(config).invoke({ operation: "availability", pathParams: { item_id: "item 1" }, body: { available: false } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://ark.xiaohongshu.com/ark/open_api/v1/item/item%201/availability");
    expect(init?.method).toBe("PUT");
    expect((init?.headers as Record<string, string>)["app-key"]).toBe("xhs");
    expect((init?.headers as Record<string, string>).sign).toMatch(/^[a-f0-9]{32}$/);
    expect(init?.body).toBe(JSON.stringify({ available: false }));
  });

  it("rejects unknown operations, missing path values and business errors", async () => {
    const client = new RednodeClient(config);
    await expect(client.invoke({ operation: "unknown" })).rejects.toThrow("disallowed");
    await expect(client.invoke({ operation: "availability" })).rejects.toThrow("item_id");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, error_code: -1, error_msg: "denied" }))));
    await expect(client.invoke({ operation: "items" })).rejects.toThrow("denied");
  });
});
