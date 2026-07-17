import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";

import { wecomFetch } from "./http.js";

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  server.close();
  await once(server, "close");
  server = undefined;
});

async function listen(handler: Parameters<typeof createServer>[0]): Promise<string> {
  server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server has no TCP address");
  return `http://127.0.0.1:${address.port}`;
}

describe("wecomFetch 安全重试", () => {
  it("retrySafe 请求遇到 503 后按配置重试", async () => {
    let calls = 0;
    const baseUrl = await listen((_req, res) => {
      calls += 1;
      if (calls === 1) {
        res.writeHead(503).end("temporary");
        return;
      }
      res.writeHead(200).end("ok");
    });

    const response = await wecomFetch(`${baseUrl}/sync`, undefined, {
      timeoutMs: 2_000,
      retrySafe: true,
      retries: 1,
      retryDelayMs: 0,
    });

    expect(response.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("非幂等请求即使配置 retries 也不重试", async () => {
    let calls = 0;
    const baseUrl = await listen((_req, res) => {
      calls += 1;
      res.writeHead(503).end("temporary");
    });

    const response = await wecomFetch(`${baseUrl}/send`, { method: "POST" }, {
      timeoutMs: 2_000,
      retrySafe: false,
      retries: 3,
      retryDelayMs: 0,
    });

    expect(response.status).toBe(503);
    expect(calls).toBe(1);
  });
});
