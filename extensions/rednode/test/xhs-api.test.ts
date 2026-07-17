import { afterEach, describe, expect, it, vi } from "vitest";
import { RednodeClient, signRednodeRequest } from "../src/agent/xhs-api.js";
import type { RednodePluginConfig } from "../src/types.js";

const config: RednodePluginConfig = {
  enabled: true,
  appKey: "xhs",
  appSecret: "9a539709cafc1efc9ef05838be468a28",
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
  ownerOnly: false,
};

afterEach(() => vi.unstubAllGlobals());

describe("RednodeClient", () => {
  it("reproduces the signature published in the official RED example", () => {
    expect(
      signRednodeRequest(
        "/ark/open_api/v1/items",
        {
          status: "0",
          page_no: "1",
          page_size: "50",
          timestamp: "1469902537",
          "app-key": "xhs",
        },
        config.appSecret,
      ),
    ).toBe("72be6fad4dd0e5104dbdebbcdadb2a06");
  });

  it("uses Ark headers, signed query and path templates", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, data: {} })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await new RednodeClient(config).invoke({
      operation: "availability",
      pathParams: { item_id: "item 1" },
      body: { available: false },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://ark.xiaohongshu.com/ark/open_api/v1/item/item%201/availability",
    );
    expect(init?.method).toBe("PUT");
    expect((init?.headers as Record<string, string>)["app-key"]).toBe("xhs");
    expect((init?.headers as Record<string, string>).sign).toMatch(
      /^[a-f0-9]{32}$/,
    );
    expect(init?.body).toBe(JSON.stringify({ available: false }));
    expect(init?.redirect).toBe("manual");
  });

  it("rejects unknown operations, missing path values and business errors", async () => {
    const client = new RednodeClient(config);
    await expect(client.invoke({ operation: "unknown" })).rejects.toThrow(
      "disallowed",
    );
    await expect(client.invoke({ operation: "availability" })).rejects.toThrow(
      "item_id",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              error_code: -1,
              error_msg: "denied",
            }),
          ),
      ),
    );
    await expect(client.invoke({ operation: "items" })).rejects.toThrow(
      "denied",
    );
  });

  it("requires the official boolean success envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: {} }))));
    await expect(new RednodeClient(config).invoke({ operation: "items" }))
      .rejects.toThrow("boolean success");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: "true", data: {} }))));
    await expect(new RednodeClient(config).invoke({ operation: "items" }))
      .rejects.toThrow("boolean success");
  });

  it("retries only idempotent GET requests on network and documented 500/502 failures", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(new Response("temporary", { status: 502 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { ok: true } })),
      );
    const sleep = vi.fn(async () => undefined);
    const client = new RednodeClient(config, {
      fetch: fetchMock,
      sleep,
      random: () => 0.5,
      now: () => 1_469_902_537_000,
    });

    await expect(client.invoke({ operation: "items" })).resolves.toEqual({
      success: true,
      data: { ok: true },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
  });

  it("never retries POST or PUT operations without a server idempotency key", async () => {
    const fetchMock = vi.fn(
      async () => new Response("temporary", { status: 502 }),
    );
    const sleep = vi.fn(async () => undefined);
    const client = new RednodeClient(config, { fetch: fetchMock, sleep });

    await expect(
      client.invoke({
        operation: "availability",
        pathParams: { item_id: "item-1" },
        body: { available: false },
      }),
    ).rejects.toThrow("HTTP 502");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("bounds the complete request URL and sanitizes external business errors", async () => {
    const smallRequestConfig = { ...config, maxRequestBytes: 256 };
    const client = new RednodeClient(smallRequestConfig);
    await expect(
      client.invoke({
        operation: "items",
        query: { value: "x".repeat(512) },
      }),
    ).rejects.toThrow("request URL exceeded");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              error_code: "bad",
              error_msg: `unsafe\n\u0000${"x".repeat(500)}`,
            }),
          ),
      ),
    );
    await expect(
      new RednodeClient(config).invoke({ operation: "items" }),
    ).rejects.toSatisfy(
      (error: Error) =>
        !error.message.includes("\n") && error.message.length <= 340,
    );
  });

  it("rejects non-finite and control-character path or query values", async () => {
    const client = new RednodeClient(config);
    await expect(client.invoke({
      operation: "availability",
      pathParams: { item_id: Number.POSITIVE_INFINITY },
      body: {},
    })).rejects.toThrow("item_id");
    await expect(client.invoke({
      operation: "items",
      query: { page_no: Number.NaN },
    })).rejects.toThrow("page_no");
    await expect(client.invoke({
      operation: "items",
      query: { status: "bad\nvalue" },
    })).rejects.toThrow("too long");
  });

  it("redacts configured credentials from network and business errors", async () => {
    const networkClient = new RednodeClient(config, {
      fetch: vi.fn(async () => {
        throw new Error(`failed https://alice:pass@proxy.test ${config.appKey} ${config.appSecret} app-secret=other-secret sign=deadbeef Bearer bearer-1`);
      }),
      sleep: vi.fn(async () => undefined),
    });
    await expect(networkClient.invoke({ operation: "availability", pathParams: { item_id: "1" }, body: {} }))
      .rejects.toSatisfy((error: Error) =>
        error.message.includes("[REDACTED]") &&
        !error.message.match(/alice:pass|other-secret|deadbeef|bearer-1/u) &&
        !error.message.includes(config.appSecret),
      );

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: false,
      error_msg: `denied ${config.appKey} ${config.appSecret}`,
    }))));
    await expect(new RednodeClient(config).invoke({ operation: "items" }))
      .rejects.toSatisfy((error: Error) =>
        !error.message.includes(config.appKey) && !error.message.includes(config.appSecret),
      );
  });

  it("cancels a chunked response as soon as the configured byte limit is exceeded", async () => {
    let cancelled = false;
    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(800));
        controller.enqueue(new Uint8Array(800));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchMock = vi.fn(async () => new Response(oversizedBody));
    const client = new RednodeClient(config, { fetch: fetchMock });

    await expect(client.invoke({ operation: "items" })).rejects.toThrow(
      "response exceeded",
    );
    expect(cancelled).toBe(true);
  });

  it("fails fast at the concurrency cap and exposes only sanitized runtime counters", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = vi.fn(async () => {
      await blocked;
      return new Response(JSON.stringify({ success: true, data: {} }));
    });
    const client = new RednodeClient(
      { ...config, maxConcurrentRequests: 1 },
      { fetch: fetchMock },
    );

    const first = client.invoke({ operation: "items" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await expect(client.invoke({ operation: "items" })).rejects.toThrow(
      "concurrent request limit",
    );
    expect(client.status()).toEqual(expect.objectContaining({
      activeRequests: 1,
      attemptsTotal: 1,
      concurrencyRejectedTotal: 1,
    }));

    release();
    await expect(first).resolves.toEqual({ success: true, data: {} });
    expect(client.status()).toEqual(expect.objectContaining({
      activeRequests: 0,
      successfulInvocationsTotal: 1,
      failedInvocationsTotal: 0,
      lastError: null,
    }));
  });
});
