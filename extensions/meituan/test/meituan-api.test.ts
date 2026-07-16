import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { MeituanClient, signMeituanParams } from "../src/meituan/meituan-api.js";
import type { MeituanPluginConfig } from "../src/types.js";

const config: MeituanPluginConfig = {
  enabled: true,
  developerId: "123456",
  signKey: "sign-secret",
  appAuthToken: "auth-secret",
  apiBaseUrl: "https://api-open-cater.meituan.com",
  version: "2",
  operations: [{ name: "receipt_query", apiPath: "/receipt/query", businessId: 7, requiresAuth: true }],
  requestTimeoutMs: 1000,
  maxRequestBytes: 1024,
  maxResponseBytes: 1024,
  maxRequestsPerMinute: 2,
  ownerOnly: false,
};

afterEach(() => vi.unstubAllGlobals());

describe("MeituanClient", () => {
  it("matches the official SDK signing algorithm", () => {
    expect(signMeituanParams("key", { b: "2", a: "1", empty: "", sign: "ignored" }))
      .toBe("ac5aa52849092395d08bc91a1707ee1ef8af2631");
  });

  it("sends the official form fields and headers", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: "OP_SUCCESS", data: [] })));
    vi.stubGlobal("fetch", fetchMock);
    const response = await new MeituanClient(config).invoke("receipt_query", { date: "2026-07-16" });
    expect(response.code).toBe("OP_SUCCESS");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api-open-cater.meituan.com/receipt/query");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("businessId")).toBe("7");
    expect(body.get("developerId")).toBe("123456");
    expect(body.get("appAuthToken")).toBe("auth-secret");
    expect(body.get("biz")).toBe(JSON.stringify({ date: "2026-07-16" }));
    expect(body.get("sign")).toMatch(/^[a-f0-9]{40}$/);
    expect((init?.headers as Record<string, string>)["DeveloperId"]).toBe("123456");
  });

  it("completes a real local HTTP form round trip", async () => {
    let receivedBody = "";
    const server = createServer((request, response) => {
      request.setEncoding("utf8");
      request.on("data", (chunk) => { receivedBody += chunk; });
      request.on("end", () => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ code: "OP_SUCCESS", traceId: "local-e2e" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
      const client = new MeituanClient({ ...config, apiBaseUrl: `http://127.0.0.1:${address.port}` });
      const response = await client.invoke("receipt_query", { offset: 0 });
      expect(response).toEqual(expect.objectContaining({ code: "OP_SUCCESS", traceId: "local-e2e" }));
      const body = new URLSearchParams(receivedBody);
      expect(body.get("biz")).toBe(JSON.stringify({ offset: 0 }));
      expect(body.get("sign")).toMatch(/^[a-f0-9]{40}$/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("enforces operation, auth, payload and rate limits", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    const client = new MeituanClient({ ...config, maxRequestsPerMinute: 1 });
    await expect(client.invoke("unknown", {})).rejects.toThrow("disallowed");
    await expect(new MeituanClient({ ...config, appAuthToken: undefined }).invoke("receipt_query", {})).rejects.toThrow("appAuthToken");
    await expect(client.invoke("receipt_query", { value: "x".repeat(2000) })).rejects.toThrow("maxRequestBytes");
    await client.invoke("receipt_query", {});
    await expect(client.invoke("receipt_query", {})).rejects.toThrow("rate limit");
  });
});
