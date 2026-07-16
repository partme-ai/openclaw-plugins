import { afterEach, describe, expect, it, vi } from "vitest";
import { AmapClient } from "../src/amap/amap-api.js";
import type { AmapPluginConfig } from "../src/types.js";

const config: AmapPluginConfig = {
  enabled: true, key: "secret-key", apiBaseUrl: "https://restapi.amap.com", requestTimeoutMs: 1000,
  retryAttempts: 0, maxResponseBytes: 1024, maxRequestsPerMinute: 2, ownerOnly: false,
};

afterEach(() => vi.unstubAllGlobals());

describe("AmapClient", () => {
  it("uses v5 paths and never exposes the key in the returned payload", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "1", pois: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await new AmapClient(config).get("/v5/place/text", { keywords: "咖啡" });
    expect(response.status).toBe("1");
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe("/v5/place/text");
    expect(url.searchParams.get("key")).toBe("secret-key");
    expect(JSON.stringify(response)).not.toContain("secret-key");
  });

  it("rejects HTTP-200 business failures and oversized responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "0", info: "INVALID_USER_KEY", infocode: "10001" }))));
    await expect(new AmapClient(config).get("/v5/place/detail", { id: "x" })).rejects.toThrow("INVALID_USER_KEY");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(2048))));
    await expect(new AmapClient(config).get("/v5/place/detail", { id: "x" })).rejects.toThrow("maxResponseBytes");
  });

  it("enforces the local quota and path allowlist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "1" }))));
    const client = new AmapClient({ ...config, maxRequestsPerMinute: 1 });
    await client.get("/v5/place/detail", { id: "x" });
    await expect(client.get("/v5/place/detail", { id: "y" })).rejects.toThrow("rate limit");
    await expect(client.get("/v3/ip", {})).rejects.toThrow("Unsupported");
  });
});
