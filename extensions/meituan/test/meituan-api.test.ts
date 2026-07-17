import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import {
  MeituanClient,
  signMeituanParams,
} from "../src/meituan/meituan-api.js";
import type { MeituanPluginConfig } from "../src/types.js";

const config: MeituanPluginConfig = {
  enabled: true,
  developerId: "123456",
  signKey: "sign-secret",
  appAuthToken: "auth-secret",
  accounts: [],
  requireAccountBinding: false,
  accountBindingMatched: true,
  apiBaseUrl: "https://api-open-cater.meituan.com",
  version: "2",
  operations: [
    {
      name: "receipt_query",
      apiPath: "/receipt/query",
      businessId: 7,
      requiresAuth: true,
      riskLevel: "read",
      successCodes: ["OP_SUCCESS"],
    },
  ],
  requestTimeoutMs: 1000,
  maxRequestBytes: 1024,
  maxResponseBytes: 1024,
  maxToolResultBytes: 1024,
  maxRequestsPerMinute: 2,
  maxConcurrentRequests: 8,
  readRetryMaxAttempts: 2,
  retryInitialDelayMs: 0,
  retryMaxDelayMs: 0,
  retryJitterRatio: 0,
  requireWriteIdempotency: true,
  idempotencyTtlMs: 60_000,
  maxIdempotencyEntries: 100,
  allowCustomApiBaseUrl: false,
  ownerOnly: false,
};

afterEach(() => vi.unstubAllGlobals());

describe("MeituanClient", () => {
  it("matches the official SDK signing algorithm", () => {
    expect(
      signMeituanParams("key", { b: "2", a: "1", empty: "", sign: "ignored" }),
    ).toBe("ac5aa52849092395d08bc91a1707ee1ef8af2631");
  });

  it("sends the official form fields and headers", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "OP_SUCCESS", data: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await new MeituanClient(config).invoke("receipt_query", {
      date: "2026-07-16",
    });
    expect(response.code).toBe("OP_SUCCESS");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api-open-cater.meituan.com/receipt/query",
    );
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("businessId")).toBe("7");
    expect(body.get("developerId")).toBe("123456");
    expect(body.get("appAuthToken")).toBe("auth-secret");
    expect(body.get("biz")).toBe(JSON.stringify({ date: "2026-07-16" }));
    expect(body.get("sign")).toMatch(/^[a-f0-9]{40}$/);
    expect((init?.headers as Record<string, string>)["DeveloperId"]).toBe(
      "123456",
    );
    expect(init?.redirect).toBe("manual");
  });

  it("completes a real local HTTP form round trip", async () => {
    let receivedBody = "";
    const server = createServer((request, response) => {
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        receivedBody += chunk;
      });
      request.on("end", () => {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({ code: "OP_SUCCESS", traceId: "local-e2e" }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("test server did not bind a TCP port");
      const client = new MeituanClient({
        ...config,
        apiBaseUrl: `http://127.0.0.1:${address.port}`,
      });
      const response = await client.invoke("receipt_query", { offset: 0 });
      expect(response).toEqual(
        expect.objectContaining({ code: "OP_SUCCESS", traceId: "local-e2e" }),
      );
      const body = new URLSearchParams(receivedBody);
      expect(body.get("biz")).toBe(JSON.stringify({ offset: 0 }));
      expect(body.get("sign")).toMatch(/^[a-f0-9]{40}$/);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("enforces operation, auth, payload and rate limits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: "OP_SUCCESS" }))),
    );
    const client = new MeituanClient({ ...config, maxRequestsPerMinute: 1 });
    await expect(client.invoke("unknown", {})).rejects.toThrow("disallowed");
    await expect(
      new MeituanClient({ ...config, appAuthToken: undefined }).invoke(
        "receipt_query",
        {},
      ),
    ).rejects.toThrow("appAuthToken");
    await expect(
      client.invoke("receipt_query", { value: "x".repeat(2000) }),
    ).rejects.toThrow("maxRequestBytes");
    await client.invoke("receipt_query", {});
    await expect(client.invoke("receipt_query", {})).rejects.toThrow(
      "rate limit",
    );
  });

  it("validates the standard business code and sanitizes platform errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "TOKEN_EXPIRED",
              message: `expired\n${config.appAuthToken}\u0000${"x".repeat(500)}`,
            }),
          ),
      ),
    );

    try {
      await new MeituanClient(config).invoke("receipt_query", {});
      throw new Error("expected invoke to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain("rejected");
      expect(message).toContain("[REDACTED]");
      expect(message).not.toContain(config.appAuthToken);
      expect(message).not.toContain("\n");
      expect(message.length).toBeLessThanOrEqual(340);
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
    await expect(
      new MeituanClient(config).invoke("receipt_query", {}),
    ).rejects.toThrow("missing a string code");
  });

  it("checks the complete encoded form size and retries only read transport failures", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("temporary failure");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new MeituanClient(config).invoke("receipt_query", {}),
    ).rejects.toThrow("temporary failure");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const oversized = {
      ...config,
      appAuthToken: "t".repeat(500),
      maxRequestBytes: 256,
    };
    await expect(
      new MeituanClient(oversized).invoke("receipt_query", {}),
    ).rejects.toThrow("complete form payload");
  });

  it("retries temporary read HTTP statuses but never retries a write operation", async () => {
    const readFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "OP_SUCCESS" })),
      );
    const readClient = new MeituanClient(config, {
      fetch: readFetch,
      sleep: async () => undefined,
    });
    await expect(readClient.invoke("receipt_query", {})).resolves.toEqual({
      code: "OP_SUCCESS",
    });
    expect(readFetch).toHaveBeenCalledTimes(2);

    const writeOperation = {
      ...config.operations[0]!,
      name: "refund",
      riskLevel: "write" as const,
      idempotencyBizField: "orderId",
    };
    const writeFetch = vi.fn(async () => new Response("busy", { status: 503 }));
    const writeClient = new MeituanClient(
      { ...config, operations: [writeOperation] },
      { fetch: writeFetch },
    );
    await expect(writeClient.invoke("refund", { orderId: "order-1" })).rejects.toThrow(
      "HTTP 503",
    );
    expect(writeFetch).toHaveBeenCalledTimes(1);
  });

  it("suppresses duplicate writes with a bounded TTL ledger", async () => {
    let now = 1_000;
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ code: "OP_SUCCESS" })),
    );
    const writeOperation = {
      ...config.operations[0]!,
      name: "refund",
      riskLevel: "write" as const,
      idempotencyBizField: "orderId",
    };
    const client = new MeituanClient(
      { ...config, operations: [writeOperation], maxIdempotencyEntries: 1 },
      { fetch: fetchMock, now: () => now },
    );
    await client.invoke("refund", { orderId: "order-1" });
    await expect(client.invoke("refund", { orderId: "order-1" })).rejects.toThrow(
      "duplicate write",
    );
    await expect(client.invoke("refund", { orderId: "order-2" })).rejects.toThrow(
      "ledger is full",
    );
    expect(client.status()).toEqual(
      expect.objectContaining({
        idempotencyEntries: 1,
        duplicateWriteRejectedTotal: 1,
      }),
    );

    now += 60_001;
    await client.invoke("refund", { orderId: "order-2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requires a valid write idempotency value and fails fast at the concurrency cap", async () => {
    const writeOperation = {
      ...config.operations[0]!,
      name: "refund",
      riskLevel: "write" as const,
      idempotencyBizField: "orderId",
    };
    const writeClient = new MeituanClient({ ...config, operations: [writeOperation] });
    await expect(writeClient.invoke("refund", {})).rejects.toThrow("biz.orderId");

    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await pending;
      return new Response(JSON.stringify({ code: "OP_SUCCESS" }));
    });
    const readClient = new MeituanClient(
      { ...config, maxConcurrentRequests: 1 },
      { fetch: fetchMock },
    );
    const first = readClient.invoke("receipt_query", {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await expect(readClient.invoke("receipt_query", {})).rejects.toThrow(
      "concurrent request limit",
    );
    expect(readClient.status()).toEqual(
      expect.objectContaining({ activeRequests: 1, concurrencyRejectedTotal: 1 }),
    );
    release?.();
    await first;
    expect(readClient.status().activeRequests).toBe(0);
  });

  it("does not expose credentials echoed by a proxy network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error(
        `proxy https://alice:pass@example.test appAuthToken=${config.appAuthToken} ` +
        `signKey=${config.signKey} DeveloperId=${config.developerId}\nAuthorization: Bearer bearer-1`,
      );
    }));
    const rejection = new MeituanClient(config).invoke("receipt_query", {});
    await expect(rejection).rejects.toThrow("[REDACTED]");
    await expect(rejection).rejects.not.toThrow(/alice:pass|auth-secret|sign-secret|123456|bearer-1|\n/u);
  });

  it("does not disclose appAuthToken to operations that do not require auth", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ code: "OP_SUCCESS" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const publicOperation = {
      ...config.operations[0]!,
      name: "public_query",
      requiresAuth: false,
    };
    await new MeituanClient({
      ...config,
      operations: [publicOperation],
    }).invoke("public_query", {});
    const body = new URLSearchParams(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.has("appAuthToken")).toBe(false);
  });

  it("does not consume platform quota for a locally rejected complete form", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ code: "OP_SUCCESS" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const publicOperation = { ...config.operations[0]!, name: "public_query", requiresAuth: false };
    const client = new MeituanClient({
      ...config,
      appAuthToken: "t".repeat(500),
      operations: [config.operations[0]!, publicOperation],
      maxRequestBytes: 256,
      maxRequestsPerMinute: 1,
    });
    await expect(client.invoke("receipt_query", {})).rejects.toThrow("complete form payload");
    await client.invoke("public_query", {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels a chunked response as soon as the hard size limit is exceeded", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(800));
        controller.enqueue(new Uint8Array(800));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    await expect(new MeituanClient(config).invoke("receipt_query", {})).rejects.toThrow(
      "maxResponseBytes",
    );
    expect(cancelled).toBe(true);
  });
});
