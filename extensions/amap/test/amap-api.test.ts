import { afterEach, describe, expect, it, vi } from "vitest";
import { AmapClient } from "../src/amap/amap-api.js";
import type { AmapPluginConfig } from "../src/types.js";

const config: AmapPluginConfig = {
  enabled: true, key: "secret-key", apiBaseUrl: "https://restapi.amap.com", requestTimeoutMs: 1000,
  retryAttempts: 0, maxResponseBytes: 1024, maxToolResultBytes: 1024, maxRequestsPerMinute: 2, ownerOnly: false,
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

  it("供应商错误即使回显请求凭据也必须脱敏", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      status: "0",
      info: "api_key=secret-key Authorization: Bearer leaked-token\nhttps://user:pass@example.test",
      infocode: "10001",
    }))));

    const rejection = new AmapClient(config).get("/v5/place/detail", { id: "x" });
    await expect(rejection).rejects.toThrow(/api_key=\[REDACTED\]/u);
    await expect(rejection).rejects.not.toThrow(/secret-key|leaked-token|user:pass|\n/u);
  });

  it("rejects malformed envelopes instead of treating a missing status as success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ pois: [] }))));
    await expect(new AmapClient(config).get("/v5/place/text", { keywords: "咖啡" })).rejects.toThrow("rejected");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]))));
    await expect(new AmapClient(config).get("/v5/place/text", { keywords: "咖啡" })).rejects.toThrow("envelope");
  });

  it("retries transient business errors but not daily quota failures", async () => {
    const transientFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "0", info: "SERVER_IS_BUSY", infocode: "10016" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "1", pois: [] })));
    vi.stubGlobal("fetch", transientFetch);
    await expect(new AmapClient({ ...config, retryAttempts: 1, maxRequestsPerMinute: 2 })
      .get("/v5/place/text", { keywords: "咖啡" })).resolves.toMatchObject({ status: "1" });
    expect(transientFetch).toHaveBeenCalledTimes(2);

    const quotaFetch = vi.fn(async () => new Response(JSON.stringify({ status: "0", info: "DAILY_QUERY_OVER_LIMIT", infocode: "10003" })));
    vi.stubGlobal("fetch", quotaFetch);
    await expect(new AmapClient({ ...config, retryAttempts: 1 }).get("/v5/place/text", { keywords: "咖啡" }))
      .rejects.toThrow("DAILY_QUERY_OVER_LIMIT");
    expect(quotaFetch).toHaveBeenCalledTimes(1);
  });

  it("counts every retry attempt against the local request quota", async () => {
    const fetchMock = vi.fn(async () => new Response("temporary", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new AmapClient({ ...config, retryAttempts: 1, maxRequestsPerMinute: 1 })
      .get("/v5/place/text", { keywords: "咖啡" })).rejects.toThrow("rate limit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("分块响应超过上限时立即取消 reader", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(800));
        controller.enqueue(new Uint8Array(800));
      },
      cancel() { cancelled = true; },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    await expect(new AmapClient(config).get("/v5/place/detail", { id: "x" })).rejects.toThrow("maxResponseBytes");
    expect(cancelled).toBe(true);
  });

  it("enforces the local quota and path allowlist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "1" }))));
    const client = new AmapClient({ ...config, maxRequestsPerMinute: 1 });
    await client.get("/v5/place/detail", { id: "x" });
    await expect(client.get("/v5/place/detail", { id: "y" })).rejects.toThrow("rate limit");
    await expect(client.get("/v3/ip", {})).rejects.toThrow("Unsupported");
  });
});
