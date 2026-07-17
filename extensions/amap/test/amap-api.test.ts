import { afterEach, describe, expect, it, vi } from "vitest";
import { AmapClient, signAmapRequest } from "../src/amap/amap-api.js";
import type { AmapPluginConfig } from "../src/types.js";

const config: AmapPluginConfig = {
  enabled: true, key: "secret-key", apiBaseUrl: "https://restapi.amap.com", requestTimeoutMs: 1000,
  retryAttempts: 0, maxResponseBytes: 1024, maxToolResultBytes: 1024, maxRequestsPerMinute: 2,
  maxConcurrentRequests: 8, ownerOnly: false,
};

afterEach(() => vi.unstubAllGlobals());

describe("AmapClient", () => {
  it("uses v5 paths and never exposes the key in the returned payload", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "1", infocode: "10000", pois: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await new AmapClient(config).get("/v5/place/text", { keywords: "咖啡" });
    expect(response.status).toBe("1");
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe("/v5/place/text");
    expect(url.searchParams.get("key")).toBe("secret-key");
    expect(JSON.stringify(response)).not.toContain("secret-key");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
  });

  it("matches the official digital-signature fixture and signs the complete query", async () => {
    expect(signAmapRequest({ a: "23", b: "12", d: "48", f: "8", c: "67" }, "bbbbb"))
      .toBe("a89e8c2266d888860c46672d77d069f3");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "1", infocode: "10000" })));
    vi.stubGlobal("fetch", fetchMock);
    await new AmapClient({ ...config, privateKey: "private" }).get("/v5/place/text", { keywords: "咖啡" });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    const queryWithoutSignature = Object.fromEntries(
      [...url.searchParams.entries()].filter(([name]) => name !== "sig"),
    );
    expect(url.searchParams.get("sig")).toBe(signAmapRequest(queryWithoutSignature, "private"));
    expect(url.searchParams.toString()).not.toContain("private");
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
      info: "api_key=secret-key private-key Authorization: Bearer leaked-token\nhttps://user:pass@example.test",
      infocode: "10001",
    }))));

    const rejection = new AmapClient({ ...config, privateKey: "private-key" })
      .get("/v5/place/detail", { id: "x" });
    await expect(rejection).rejects.toThrow(/api_key=\[REDACTED\]/u);
    await expect(rejection).rejects.not.toThrow(/secret-key|private-key|leaked-token|user:pass|\n/u);
  });

  it("treats redirects as failures instead of forwarding key and sig", async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/collect" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new AmapClient({ ...config, privateKey: "private" })
      .get("/v5/place/detail", { id: "x" })).rejects.toThrow("HTTP 302");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
  });

  it("rejects malformed envelopes instead of treating a missing status as success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ pois: [] }))));
    await expect(new AmapClient(config).get("/v5/place/text", { keywords: "咖啡" })).rejects.toThrow("rejected");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]))));
    await expect(new AmapClient(config).get("/v5/place/text", { keywords: "咖啡" })).rejects.toThrow("envelope");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "1" }))));
    await expect(new AmapClient(config).get("/v5/place/text", { keywords: "咖啡" })).rejects.toThrow("success envelope");
  });

  it("retries transient business errors but not daily quota failures", async () => {
    const transientFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "0", info: "SERVER_IS_BUSY", infocode: "10016" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "1", infocode: "10000", pois: [] })));
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

  it("does not immediately retry the official minute-ban code", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: "0", info: "ACCESS_TOO_FREQUENT", infocode: "10004",
    })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new AmapClient({ ...config, retryAttempts: 2 }).get("/v5/place/text", { keywords: "咖啡" }))
      .rejects.toThrow("ACCESS_TOO_FREQUENT");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails fast at the concurrency cap and exposes only process-local low-sensitivity status", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => {
      await blocked;
      return new Response(JSON.stringify({ status: "1", infocode: "10000" }));
    }));
    const client = new AmapClient({ ...config, maxConcurrentRequests: 1 });
    const first = client.get("/v5/place/detail", { id: "first" });
    await vi.waitFor(() => expect(client.status().activeRequests).toBe(1));
    await expect(client.get("/v5/place/detail", { id: "second" })).rejects.toThrow("concurrent");
    expect(client.status()).toMatchObject({
      activeRequests: 1,
      maxConcurrentRequests: 1,
      concurrencyRejectedTotal: 1,
      attemptsTotal: 1,
    });
    expect(JSON.stringify(client.status())).not.toMatch(/secret-key|first|second/u);
    release();
    await first;
    expect(client.status()).toMatchObject({ activeRequests: 0, successfulInvocationsTotal: 1 });
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
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "1", infocode: "10000" }))));
    const client = new AmapClient({ ...config, maxRequestsPerMinute: 1 });
    await client.get("/v5/place/detail", { id: "x" });
    await expect(client.get("/v5/place/detail", { id: "y" })).rejects.toThrow("rate limit");
    await expect(client.get("/v3/ip", {})).rejects.toThrow("Unsupported");
  });
});
